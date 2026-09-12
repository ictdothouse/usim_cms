import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { getEntraAuthorizeUrl, verifyEntraIdToken, isPasswordLoginAllowed, isEntraStateValid } from "./entra.js";

test("isPasswordLoginAllowed: superadmin break-glass exempt, webmaster blocked, only when entraOnly is on", () => {
  assert.equal(isPasswordLoginAllowed("webmaster", false), true);
  assert.equal(isPasswordLoginAllowed("superadmin", false), true);
  assert.equal(isPasswordLoginAllowed("webmaster", true), false);
  assert.equal(isPasswordLoginAllowed("superadmin", true), true);
});

test("isEntraStateValid: rejects missing/mismatched nonce, accepts a matching one (login-CSRF guard)", () => {
  assert.equal(isEntraStateValid("nonce-abc", { entraState: true, entraNonce: "nonce-abc" }), true);
  assert.equal(isEntraStateValid(undefined, { entraState: true, entraNonce: "nonce-abc" }), false, "no cookie at all");
  assert.equal(isEntraStateValid("nonce-abc", { entraState: true, entraNonce: "different" }), false, "cookie doesn't match state's nonce");
  assert.equal(isEntraStateValid("nonce-abc", { entraNonce: "nonce-abc" }), false, "state missing entraState flag");
  assert.equal(isEntraStateValid("nonce-abc", null), false, "state didn't verify at all");
});

test("getEntraAuthorizeUrl builds the expected Microsoft authorize URL", () => {
  const url = new URL(getEntraAuthorizeUrl("tenant-123", "client-abc", "https://api.example/cb", "state-xyz"));
  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/tenant-123/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-abc");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.example/cb");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-xyz");
});

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signTestIdToken(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  kid: string,
  claims: Record<string, unknown>,
): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", kid }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = cryptoSign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64Url(signature)}`;
}

test("verifyEntraIdToken accepts a validly-signed, unexpired token and rejects a tampered one", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const tenantId = "tenant-test-1";
  const clientId = "client-test-1";
  const kid = "test-kid-1";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes("discovery/v2.0/keys")) {
      return new Response(JSON.stringify({ keys: [{ kid, kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  try {
    const now = Math.floor(Date.now() / 1000);
    const validToken = signTestIdToken(privateKey, kid, {
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      aud: clientId,
      exp: now + 3600,
      preferred_username: "webmaster@usim.edu.my",
    });
    const claims = await verifyEntraIdToken(validToken, tenantId, clientId);
    assert.equal(claims.email, "webmaster@usim.edu.my");

    const expiredToken = signTestIdToken(privateKey, kid, {
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      aud: clientId,
      exp: now - 3600,
      preferred_username: "webmaster@usim.edu.my",
    });
    await assert.rejects(() => verifyEntraIdToken(expiredToken, tenantId, clientId));

    const wrongAudToken = signTestIdToken(privateKey, kid, {
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      aud: "someone-else",
      exp: now + 3600,
      preferred_username: "webmaster@usim.edu.my",
    });
    await assert.rejects(() => verifyEntraIdToken(wrongAudToken, tenantId, clientId));

    const [h, p] = validToken.split(".");
    const tamperedSignature = `${h}.${p}.${base64Url("not-a-real-signature")}`;
    await assert.rejects(() => verifyEntraIdToken(tamperedSignature, tenantId, clientId));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
