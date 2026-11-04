import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { DASHBOARD_HTML as html } from "./dashboard-html.js";

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
