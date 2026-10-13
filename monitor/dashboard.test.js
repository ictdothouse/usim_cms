import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(path.join(import.meta.dirname, "server.js"), "utf8");
const literal = source.match(/const DASHBOARD_HTML = (`[\s\S]*?`);\s*const server =/);
assert.ok(literal, "dashboard template exists");
const html = vm.runInNewContext(literal[1]);

test("dashboard script parses under the nonce-based CSP", () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, "dashboard has one local script");
  assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.equal(/\sonclick\s*=/.test(html), false);
});

test("sidebar destinations have matching panels", () => {
  const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((item) => item[1]);
  assert.ok(tabs.includes("security"));
  for (const tab of tabs) assert.ok(html.includes(`id="panel-${tab}"`), `${tab} has a panel`);
});
