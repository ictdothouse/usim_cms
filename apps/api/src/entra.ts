// Microsoft Entra ID SSO — OIDC Authorization Code flow, hand-rolled (no
// openid-client/jose dependency, per this project's "avoid heavy
// dependencies" constraint — same call already made for TOTP via
// node:crypto instead of otplib, see apps/api/CLAUDE.md's Auth hardening
// section). index.ts's entra/login and entra/callback routes are the only
// callers.
import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from "node:crypto";

const AUTHORIZE_PATH = "oauth2/v2.0/authorize";
const TOKEN_PATH = "oauth2/v2.0/token";
const JWKS_PATH = "discovery/v2.0/keys";

export function getEntraAuthorizeUrl(
  tenantId: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(`https://login.microsoftonline.com/${tenantId}/${AUTHORIZE_PATH}`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeEntraCode(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ idToken: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`entra token endpoint returned ${res.status}`);
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("entra token response missing id_token");
  return { idToken: data.id_token };
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

// Keyed by tenantId — a multi-tenant CMS could in principle talk to more
// than one Entra directory over its lifetime, even though today only one
// (USIM's own) is configured at a time. ~24h TTL: Microsoft's signing keys
// rotate rarely and predictably, no need to refetch every login.
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

async function getJwks(tenantId: string): Promise<Jwk[]> {
  const cached = jwksCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/${JWKS_PATH}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`entra jwks endpoint returned ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(tenantId, { keys: data.keys, fetchedAt: Date.now() });
  return data.keys;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export interface EntraClaims {
  email: string;
}

// The entraOnly break-glass rule, pulled out as a pure function so it has
// its own direct unit test — see index.ts's POST /api/auth/login, the one
// call site. superadmin is exempt (the person who flipped this toggle must
// still be able to get back in if Entra breaks); every other role must use
// Entra once entraOnly is on.
export function isPasswordLoginAllowed(role: "superadmin" | "webmaster", entraOnly: boolean): boolean {
  return !entraOnly || role === "superadmin";
}

// Login-CSRF guard: the signed `state` param alone only proves "our server
// minted this", not "the browser completing the callback is the same one
// that started the flow" — without this, an attacker can start their own
// Entra login, capture the resulting valid code+state pair, and hand that
// callback URL to a victim, logging the victim into the ATTACKER's Entra
// identity on the victim's own browser (classic OAuth login-CSRF). Binding a
// random nonce into both a short-lived HttpOnly cookie (set in entra/login,
// unreadable/unforgeable by a page on another origin) and the signed state
// closes that: a replayed callback URL carries a state whose nonce won't
// match whatever (if any) oauth-state cookie is sitting in the victim's own
// browser. Pulled out as a pure function so it has its own direct unit test,
// same convention as isPasswordLoginAllowed above.
export function isEntraStateValid(
  cookieNonce: string | undefined,
  statePayload: { entraState?: true; entraNonce?: string } | null,
): boolean {
  if (!statePayload?.entraState || !cookieNonce || !statePayload.entraNonce) return false;
  const a = Buffer.from(cookieNonce);
  const b = Buffer.from(statePayload.entraNonce);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Verifies an id_token's RS256 signature against Microsoft's own published
// JWKS (fetched fresh per tenantId, cached — see getJwks) and checks
// iss/aud/exp — the 3 claims that actually matter for "is this a genuine,
// unexpired token minted for OUR app registration by Microsoft". Returns the
// email claim (preferred_username, falling back to email) on success; throws
// on any verification failure so every caller can treat "no claims back" as
// "reject this login", never partially-trust a bad token.
export async function verifyEntraIdToken(idToken: string, tenantId: string, clientId: string): Promise<EntraClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as { kid?: string; alg?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("unexpected id_token header");

  const jwks = await getJwks(tenantId);
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("no matching JWKS key for id_token kid");

  const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = base64UrlDecode(signatureB64);
  if (!cryptoVerify("RSA-SHA256", signingInput, publicKey, signature)) {
    throw new Error("id_token signature verification failed");
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as {
    iss?: string;
    aud?: string;
    exp?: number;
    preferred_username?: string;
    email?: string;
  };
  const expectedIss = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  if (payload.iss !== expectedIss) throw new Error("id_token iss mismatch");
  if (payload.aud !== clientId) throw new Error("id_token aud mismatch");
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("id_token expired");

  const email = payload.preferred_username ?? payload.email;
  if (!email) throw new Error("id_token missing email claim");
  return { email };
}
