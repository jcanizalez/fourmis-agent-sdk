/**
 * OpenAI Codex OAuth 2.0 + PKCE flow.
 *
 * Allows users with ChatGPT Plus/Pro subscriptions to use the Responses API
 * without an API key. Mirrors the auth flow from `codex login`.
 *
 * Token storage: ~/.fourmis/openai-auth.json
 * Fallback read: ~/.codex/auth.json (for users who already ran `codex login`)
 */

import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const CALLBACK_PORT = 1455;

// ─── Token storage ──────────────────────────────────────────────────────────

export type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms timestamp
  account_id: string;
};

function tokenDir(): string {
  return join(process.env.HOME ?? "/root", ".fourmis");
}

function tokenPath(): string {
  return join(tokenDir(), "openai-auth.json");
}

function codexFallbackPath(): string {
  return join(process.env.HOME ?? "/root", ".codex", "auth.json");
}

export function loadTokens(): StoredTokens | null {
  for (const p of [tokenPath(), codexFallbackPath()]) {
    try {
      const raw = readFileSync(p, "utf-8");
      const data = JSON.parse(raw);
      if (data.access_token && data.account_id) {
        return data as StoredTokens;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

function saveTokens(tokens: StoredTokens): void {
  const dir = tokenDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

// ─── PKCE helpers ───────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─── JWT decode (payload only, no verification) ─────────────────────────────

export function decodeJwtPayload(token: string): Record<string, any> {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT");
  const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
  return JSON.parse(payload);
}

export function extractAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload["https://api.openai.com/auth"];
  if (!authClaim?.chatgpt_account_id) {
    throw new Error("JWT missing chatgpt_account_id claim");
  }
  return authClaim.chatgpt_account_id;
}

// ─── Token exchange & refresh ───────────────────────────────────────────────

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── getValidToken — load + auto-refresh ────────────────────────────────────

export async function getValidToken(): Promise<{ accessToken: string; accountId: string } | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Refresh if within 5 minutes of expiry
  if (tokens.expires_at <= Date.now() + 300_000) {
    try {
      const fresh = await refreshAccessToken(tokens.refresh_token);
      const accountId = extractAccountId(fresh.access_token);
      const updated: StoredTokens = {
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? tokens.refresh_token,
        expires_at: Date.now() + fresh.expires_in * 1000,
        account_id: accountId,
      };
      saveTokens(updated);
      return { accessToken: updated.access_token, accountId };
    } catch {
      // Refresh failed — return current token (may still work briefly)
      return { accessToken: tokens.access_token, accountId: tokens.account_id };
    }
  }

  return { accessToken: tokens.access_token, accountId: tokens.account_id };
}

// ─── isLoggedIn ─────────────────────────────────────────────────────────────

export function isLoggedIn(): boolean {
  return loadTokens() !== null;
}

// ─── login — full OAuth flow ────────────────────────────────────────────────

/**
 * Log in via OAuth. Two modes:
 *
 * 1. **Local desktop** — starts a callback server on :1455, opens browser,
 *    waits for redirect automatically.
 *
 * 2. **Headless / VPS** — if the browser can't open (or `headless: true`),
 *    prints the auth URL and waits for the user to paste the callback URL
 *    from their browser's address bar. The redirect will fail on their local
 *    machine (localhost:1455 isn't reachable), but the full URL with `?code=`
 *    is visible in the address bar.
 */
export async function login(
  opts?: { headless?: boolean },
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  // Build authorization URL
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("audience", "https://api.openai.com/v1");

  const forceHeadless = opts?.headless ?? false;

  // Try local callback server first (desktop mode)
  if (!forceHeadless) {
    let serverWorked = false;
    try {
      const result = await loginWithServer(authUrl.toString(), state, codeVerifier);
      return result;
    } catch {
      // Server or browser failed — fall through to headless mode
    }
  }

  // Headless mode: print URL, read pasted callback URL from stdin
  return loginHeadless(authUrl.toString(), state, codeVerifier);
}

async function loginWithServer(
  authUrlStr: string,
  state: string,
  codeVerifier: string,
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  let authCode: string | null = null;
  let authError: string | null = null;
  let resolveCallback: () => void;
  const callbackPromise = new Promise<void>((resolve) => { resolveCallback = resolve; });

  const server = Bun.serve({
    port: CALLBACK_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/auth/callback") {
        const receivedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          authError = error;
        } else if (receivedState !== state) {
          authError = "State mismatch";
        } else if (code) {
          authCode = code;
        } else {
          authError = "No code received";
        }

        resolveCallback!();
        return new Response(
          "<html><body><h1>Authentication complete</h1><p>You can close this window.</p></body></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });

  // Try opening browser
  try {
    await openBrowser(authUrlStr);
  } catch {
    server.stop(true);
    throw new Error("Cannot open browser");
  }

  console.log("Waiting for authentication...");

  const timeout = setTimeout(() => {
    authError = "Timeout waiting for callback (120s)";
    resolveCallback!();
  }, 120_000);

  await callbackPromise;
  clearTimeout(timeout);
  server.stop(true);

  if (authError) {
    return { success: false, error: authError };
  }

  if (!authCode) {
    return { success: false, error: "No authorization code received" };
  }

  return finishLogin(authCode, codeVerifier);
}

async function loginHeadless(
  authUrlStr: string,
  state: string,
  codeVerifier: string,
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│  Headless login (VPS / SSH mode)                        │");
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log("\n1. Open this URL in your local browser:\n");
  console.log(`   ${authUrlStr}\n`);
  console.log("2. Log in with your ChatGPT account.");
  console.log("3. After login, your browser will try to redirect to");
  console.log("   localhost:1455 — this will FAIL (that's expected).");
  console.log("4. Copy the FULL URL from the browser's address bar");
  console.log("   (it starts with http://localhost:1455/auth/callback?code=...)");
  console.log("5. Paste it here and press Enter:\n");

  // Read from stdin
  process.stdout.write("> ");
  const pastedUrl = await readLine();

  if (!pastedUrl.trim()) {
    return { success: false, error: "No URL pasted" };
  }

  // Parse the callback URL
  try {
    const url = new URL(pastedUrl.trim());
    const code = url.searchParams.get("code");
    const receivedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return { success: false, error: `OAuth error: ${error}` };
    }

    if (receivedState !== state) {
      return { success: false, error: "State mismatch — did you use the right URL?" };
    }

    if (!code) {
      return { success: false, error: "No authorization code in URL" };
    }

    return finishLogin(code, codeVerifier);
  } catch (err: any) {
    return { success: false, error: `Invalid URL: ${err.message}` };
  }
}

async function finishLogin(
  authCode: string,
  codeVerifier: string,
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  try {
    const tokenResponse = await exchangeCode(authCode, codeVerifier);
    const accountId = extractAccountId(tokenResponse.access_token);
    const stored: StoredTokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      account_id: accountId,
    };
    saveTokens(stored);
    return { success: true, accountId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.pause();
        resolve(data.split("\n")[0]);
      }
    });
  });
}

// ─── Browser opener ─────────────────────────────────────────────────────────

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? ["open", url] :
    platform === "win32" ? ["cmd", "/c", "start", url] :
    ["xdg-open", url];

  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`Failed to open browser (exit code ${proc.exitCode})`);
  }
}
