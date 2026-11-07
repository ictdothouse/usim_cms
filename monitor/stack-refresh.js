// Patch refresh for the floating-tag base tier (Postgres, Redis, Caddy): re-pull
// the same major tag, recreate the service on the new image and wait for its
// compose healthcheck. Any failure after the pull points the tag back at the
// previous image, so no later `docker compose up` (scripts/deploy.sh runs one
// for the base tier on every deploy) picks the unchecked image up. Docker and
// compose calls are injected so stack-refresh.test.js can drive every branch;
// server.js's applyStackUpdate owns deployState and the deploy log around it.
import { setTimeout } from "node:timers";

// docker-compose.yml only pins the MAJOR for these three (e.g. "16-alpine"),
// so re-pulling the same tag always gets the newest patch/minor already in
// that major — there's no separate patch pin to bump.
export const STACK_FLOATING_TARGETS = { postgres: "db", redis: "redis", caddy: "proxy" };

// docker compose ps reports an unhealthy container's State as "running
// (unhealthy)" — which the naive /healthy/i regex below would also match,
// since "unhealthy" contains "healthy" as a substring. Checked first so a
// container that's alive-but-failing its healthcheck (e.g. proxy's Caddy
// admin-API probe, see docker-compose.yml) is correctly reported down
// instead of silently passing as up.
export function isServiceUp(state) {
  return !/unhealthy/i.test(state || "") && /running|healthy|active/i.test(state || "");
}

// The Stack tab's Test: pull the candidate image, run stagingTest(cb(ok, note))
// against it, then point the tag back at the image it had before. `docker
// pull` moves the local tag, and scripts/deploy.sh's `docker compose up -d db`
// / `up -d pgbouncer redis proxy` recreate any base service whose tag no longer
// matches its container, so a Test alone would make the next "Pull latest &
// deploy" swap Postgres onto the new image with no pre-backup and no health
// rollback. A ref with no local image before the pull is one compose isn't
// using, so it's left as pulled.
// done({ pulled, ok, note, previousId, restoreError }).
export function pullForStagingTest({ imageRef, execFile, stagingTest }, done) {
  execFile("docker", ["image", "inspect", "--format", "{{.Id}}", imageRef], { timeout: 10_000 }, (inspErr, idOut) => {
    const previousId = inspErr ? "" : String(idOut || "").trim();
    const finish = (result) => {
      if (!previousId) return done(result);
      execFile("docker", ["tag", previousId, imageRef], { timeout: 10_000 }, (tagErr, _o, tagStderr) =>
        done({ ...result, previousId, restoreError: tagErr ? String(tagStderr || tagErr.message).trim() : "" }),
      );
    };
    execFile("docker", ["pull", imageRef], { timeout: 120_000 }, (pullErr, _out, stderr) => {
      if (pullErr) return finish({ pulled: false, ok: false, note: stderr || pullErr.message });
      stagingTest((ok, note) => finish({ pulled: true, ok, note }));
    });
  });
}

// deps: key (a STACK_FLOATING_TARGETS key), imageRef (that service's image:
// tag), execFile, runCompose, getComposeStatus, logLine, backup(cb(ok)) and
// optionally healthTimeoutMs/pollIntervalMs. done(0) = refreshed or already
// newest; done(1) = nothing changed, or rolled back to the previous image.
export function refreshFloatingImage(deps, done) {
  const { key, imageRef, execFile, runCompose, getComposeStatus, logLine, backup } = deps;
  const service = STACK_FLOATING_TARGETS[key];
  const healthTimeoutMs = deps.healthTimeoutMs ?? 90_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 3000;
  const docker = (args, cb) => execFile("docker", args, { timeout: 10_000 }, cb);

  runCompose(["ps", "-q", service], (_psErr, psOut) => {
    const cid = String(psOut || "").trim().split("\n")[0];
    docker(["inspect", "--format", "{{.Image}}", cid], (inspectErr, oldImageId) => {
      const oldImage = inspectErr ? "" : String(oldImageId || "").trim();
      if (!oldImage) {
        logLine(`couldn't read ${service}'s current image, so there'd be nothing to roll back to. Nothing was changed.`);
        return done(1);
      }
      // The pull moved the tag; point it back so no later restart picks up the new image unchecked.
      const retag = (cb) => docker(["tag", oldImage, imageRef], () => cb());
      const rollback = () =>
        retag(() =>
          runCompose(["up", "-d", "--force-recreate", service], (rbErr, rbOut, rbErrText) => {
            logLine(rbOut || rbErrText || (rbErr ? rbErr.message : "rollback recreate issued"));
            done(1);
          }),
        );

      // Same one-shot shape as selfHealRestart: if the recreated container isn't
      // healthy before the deadline, roll back once rather than retry.
      const waitHealthy = () => {
        const deadline = Date.now() + healthTimeoutMs;
        const tick = () => {
          getComposeStatus((err, services) => {
            const entry = !err && services ? services.find((s) => s.Service === service) : null;
            logLine(`health check (${service}): ${entry ? entry.State + (entry.Health ? ` (${entry.Health})` : "") : "(not found)"}`);
            // "running" comes before the compose healthcheck passes (Postgres is
            // running long before it accepts connections), so wait for "healthy".
            if (entry && isServiceUp(entry.State) && (!entry.Health || entry.Health === "healthy")) return done(0);
            if (Date.now() >= deadline) {
              logLine(`timed out waiting for ${service} to become healthy — rolling back to previous image (${oldImage})`);
              return rollback();
            }
            setTimeout(tick, pollIntervalMs);
          });
        };
        tick();
      };

      logLine(`previous image id: ${oldImage}`);
      logLine(`--- pulling ${imageRef} ---`);
      runCompose(["pull", service], (pullErr, pullOut, pullErrText) => {
        logLine(pullOut || pullErrText || "");
        if (pullErr) {
          logLine(`pull failed: ${pullErr.message}`);
          return done(1);
        }
        docker(["image", "inspect", "--format", "{{.Id}}", imageRef], (_e, newImageId) => {
          if (String(newImageId || "").trim() === oldImage) {
            logLine(`${imageRef} is already the newest patch. Nothing restarted.`);
            return done(0);
          }
          // Postgres gets a full dump first. Redis holds only cache and Caddy
          // only config the repo already has, so they skip it.
          const beforeRecreate = key === "postgres" ? backup : (cb) => cb(true);
          beforeRecreate((backedUp) => {
            if (!backedUp) return retag(() => done(1));
            logLine(`--- recreating ${service} ---`);
            // 30s instead of compose's 10s, so Postgres can finish a clean shutdown;
            // it must leave room inside runCompose's own 60s kill timeout.
            runCompose(["up", "-d", "-t", "30", service], (upErr, upOut, upErrText) => {
              logLine(upOut || upErrText || "");
              if (!upErr) return waitHealthy();
              logLine(`recreate failed: ${upErr.message}. Rolling back to ${oldImage}`);
              rollback();
            });
          });
        });
      });
    });
  });
}
