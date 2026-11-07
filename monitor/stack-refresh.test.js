import assert from "node:assert/strict";
import test from "node:test";
import { isServiceUp, pullForStagingTest, refreshFloatingImage } from "./stack-refresh.js";

const healthy = { State: "running", Health: "healthy" };
const starting = { State: "running", Health: "starting" };

// Scripted docker/compose fakes. `calls` records every command in order so a
// test can assert what ran and, just as important, what never ran.
function run(key, opts = {}) {
  const service = { postgres: "db", redis: "redis", caddy: "proxy" }[key];
  const calls = [];
  const statuses = opts.statuses || [healthy];
  let polls = 0;
  const deps = {
    key,
    imageRef: `${key}:floating`,
    healthTimeoutMs: opts.healthTimeoutMs ?? 1000,
    pollIntervalMs: 1,
    logLine: () => {},
    execFile: (cmd, args, _options, cb) => {
      calls.push([cmd, ...args].join(" "));
      if (args[0] === "inspect") return opts.oldImage === null ? cb(new Error("no such object"), "", "") : cb(null, "sha256:old\n", "");
      if (args[0] === "image") return cb(null, `${opts.newImage || "sha256:new"}\n`, "");
      cb(null, "", "");
    },
    runCompose: (args, cb) => {
      calls.push(["compose", ...args].join(" "));
      if (args[0] === "ps") return cb(null, "cid1\n", "");
      if (args[0] === "pull") return opts.pullFails ? cb(new Error("pull denied"), "", "denied") : cb(null, "pulled", "");
      if (args.includes("-t") && opts.upFails) return cb(new Error("up failed"), "", "boom");
      cb(null, "", "Recreated");
    },
    getComposeStatus: (cb) => {
      calls.push("status");
      const status = statuses[Math.min(polls++, statuses.length - 1)];
      cb(null, [{ Service: "api", State: "running" }, { Service: service, ...status }]);
    },
    backup: (cb) => {
      calls.push("backup");
      cb(opts.backupFails !== true);
    },
  };
  return new Promise((resolve) => refreshFloatingImage(deps, (code) => resolve({ code, calls })));
}

const retag = (key) => `docker tag sha256:old ${key}:floating`;
const has = (calls, prefix) => calls.some((c) => c.startsWith(prefix));

test("unreadable old image aborts before pulling", async () => {
  const { code, calls } = await run("postgres", { oldImage: null });
  assert.equal(code, 1);
  assert.equal(has(calls, "compose pull"), false);
});

test("a failed pull exits 1 without touching the service", async () => {
  const { code, calls } = await run("postgres", { pullFails: true });
  assert.equal(code, 1);
  assert.equal(has(calls, "backup"), false);
  assert.equal(has(calls, "compose up"), false);
  assert.equal(has(calls, "docker tag"), false);
});

test("an unchanged image id skips the backup and the recreate", async () => {
  const { code, calls } = await run("postgres", { newImage: "sha256:old" });
  assert.equal(code, 0);
  assert.equal(has(calls, "backup"), false);
  assert.equal(has(calls, "compose up"), false);
});

test("a failed Postgres pre-backup re-tags the old image and never recreates", async () => {
  const { code, calls } = await run("postgres", { backupFails: true });
  assert.equal(code, 1);
  assert.ok(calls.includes(retag("postgres")));
  assert.equal(has(calls, "compose up"), false);
});

test("a failed recreate re-tags the old image and force-recreates it", async () => {
  const { code, calls } = await run("postgres", { upFails: true });
  assert.equal(code, 1);
  const tagAt = calls.indexOf(retag("postgres"));
  assert.ok(tagAt > calls.indexOf("compose up -d -t 30 db"));
  assert.equal(calls[tagAt + 1], "compose up -d --force-recreate db");
});

test("health check waits through 'starting' until 'healthy'", async () => {
  const { code, calls } = await run("postgres", { statuses: [starting, starting, healthy] });
  assert.equal(code, 0);
  assert.deepEqual(calls.slice(-5), ["backup", "compose up -d -t 30 db", "status", "status", "status"]);
  assert.equal(has(calls, "docker tag"), false);
});

test("never healthy before the deadline rolls back to the old image", async () => {
  const { code, calls } = await run("postgres", { statuses: [starting], healthTimeoutMs: 20 });
  assert.equal(code, 1);
  assert.ok(calls.filter((c) => c === "status").length >= 2);
  assert.deepEqual(calls.slice(-2), [retag("postgres"), "compose up -d --force-recreate db"]);
});

for (const key of ["redis", "caddy"]) {
  test(`${key} refresh skips the backup`, async () => {
    const { code, calls } = await run(key, { backupFails: true });
    assert.equal(code, 0);
    assert.equal(has(calls, "backup"), false);
    assert.ok(has(calls, "compose up -d -t 30"));
  });
}

function stagingTest({ previous = "sha256:old", pullFails = false, testOk = true, tagFails = false } = {}) {
  const calls = [];
  const execFile = (_cmd, args, _options, cb) => {
    calls.push(args.join(" "));
    if (args[0] === "image") return previous ? cb(null, `${previous}\n`, "") : cb(new Error("No such image"), "", "");
    if (args[0] === "pull" && pullFails) return cb(new Error("pull failed"), "", "denied");
    if (args[0] === "tag" && tagFails) return cb(new Error("tag failed"), "", "no space left");
    cb(null, "", "");
  };
  const test = (cb) => {
    calls.push("staging");
    cb(testOk, testOk ? "booted" : "crashed");
  };
  return new Promise((resolve) =>
    pullForStagingTest({ imageRef: "postgres:16-alpine", execFile, stagingTest: test }, (r) => resolve({ r, calls })));
}

test("Test re-tags the previous image after a pass or a failure", async () => {
  for (const testOk of [true, false]) {
    const { r, calls } = await stagingTest({ testOk });
    assert.equal(r.ok, testOk);
    assert.deepEqual(calls.slice(1), ["pull postgres:16-alpine", "staging", "tag sha256:old postgres:16-alpine"]);
  }
  const failedPull = await stagingTest({ pullFails: true });
  assert.equal(failedPull.r.pulled, false);
  assert.equal(failedPull.calls.includes("staging"), false);
});

test("Test leaves a ref alone when there was no local image before", async () => {
  const { r, calls } = await stagingTest({ previous: "" });
  assert.equal(r.ok, true);
  assert.equal(calls.some((c) => c.startsWith("tag")), false);
});

test("Test reports a re-tag it couldn't do", async () => {
  const { r } = await stagingTest({ tagFails: true });
  assert.equal(r.previousId, "sha256:old");
  assert.match(r.restoreError, /no space left/);
});

test("an unhealthy container never counts as up", () => {
  assert.equal(isServiceUp("running (unhealthy)"), false);
  assert.equal(isServiceUp("running (healthy)"), true);
});
