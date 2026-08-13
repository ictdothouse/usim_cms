import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaddyConfig, parseCertExpiry } from "./proxy-sync.js";

test("buildCaddyConfig includes one route per active tenant", () => {
  const config = buildCaddyConfig([
    { host: "dept-a.usim.edu.my", active: true },
    { host: "dept-b.usim.edu.my", active: true },
  ]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.ok(hosts.includes("dept-a.usim.edu.my"));
  assert.ok(hosts.includes("dept-b.usim.edu.my"));
});

test("buildCaddyConfig excludes an inactive tenant", () => {
  const config = buildCaddyConfig([{ host: "suspended.usim.edu.my", active: false }]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.ok(!hosts.includes("suspended.usim.edu.my"));
});

test("buildCaddyConfig always includes the static admin/api routes", () => {
  const config = buildCaddyConfig([]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.equal(hosts.length, 2); // admin domain + api domain, no tenants
});

test("parseCertExpiry rejects a malformed PEM", () => {
  // A deliberately truncated/invalid PEM body — exercises the same
  // rejection path apps/api's cert-upload route (Task 4) depends on to
  // reject a bad upload with 400. Swap in a real self-signed cert (e.g.
  // `openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem
  // -days 3650 -subj "/CN=test"`) later if asserting the parsed date
  // itself is wanted.
  const pem = "-----BEGIN CERTIFICATE-----\nnotacertificate\n-----END CERTIFICATE-----";
  assert.throws(() => parseCertExpiry(pem));
});
