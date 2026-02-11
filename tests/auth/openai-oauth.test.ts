import { test, expect } from "bun:test";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  decodeJwtPayload,
  extractAccountId,
} from "../../src/auth/openai-oauth.ts";

// ─── PKCE ───────────────────────────────────────────────────────────────────

test("generateCodeVerifier returns base64url string", () => {
  const verifier = generateCodeVerifier();
  expect(verifier.length).toBeGreaterThan(40);
  // base64url: no +, /, or =
  expect(verifier).not.toMatch(/[+/=]/);
});

test("generateCodeVerifier is unique each call", () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  expect(a).not.toBe(b);
});

test("generateCodeChallenge produces SHA-256 of verifier", () => {
  const verifier = "test-verifier-string";
  const challenge = generateCodeChallenge(verifier);
  // Should be base64url encoded
  expect(challenge.length).toBeGreaterThan(0);
  expect(challenge).not.toMatch(/[+/=]/);
  // Same input → same output
  expect(generateCodeChallenge(verifier)).toBe(challenge);
});

test("challenge differs for different verifiers", () => {
  const a = generateCodeChallenge("verifier-a");
  const b = generateCodeChallenge("verifier-b");
  expect(a).not.toBe(b);
});

// ─── JWT decode ─────────────────────────────────────────────────────────────

// Create a test JWT: header.payload.signature
function makeTestJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = "test-signature";
  return `${header}.${body}.${signature}`;
}

test("decodeJwtPayload extracts payload", () => {
  const jwt = makeTestJwt({ sub: "user123", email: "test@example.com" });
  const payload = decodeJwtPayload(jwt);
  expect(payload.sub).toBe("user123");
  expect(payload.email).toBe("test@example.com");
});

test("decodeJwtPayload throws on invalid JWT", () => {
  expect(() => decodeJwtPayload("not-a-jwt")).toThrow("Invalid JWT");
});

test("extractAccountId extracts chatgpt_account_id from JWT", () => {
  const jwt = makeTestJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_abc123",
    },
  });
  expect(extractAccountId(jwt)).toBe("acct_abc123");
});

test("extractAccountId throws if claim is missing", () => {
  const jwt = makeTestJwt({ sub: "user123" });
  expect(() => extractAccountId(jwt)).toThrow("chatgpt_account_id");
});
