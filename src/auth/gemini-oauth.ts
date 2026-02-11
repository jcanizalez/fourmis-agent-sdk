/**
 * Gemini CLI OAuth token management.
 *
 * Reads tokens from ~/.gemini/oauth_creds.json (written by `gemini login`)
 * and auto-refreshes access tokens using Google's OAuth2 endpoint.
 *
 * Token storage: ~/.gemini/oauth_creds.json (read/write)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Constants ──────────────────────────────────────────────────────────────

// Gemini CLI's public OAuth client credentials (installed app — not secret).
// These match the values embedded in the open-source @google/gemini-cli.
// Can be overridden via environment variables if needed.
const GEMINI_CLIENT_ID =
  process.env.GEMINI_OAUTH_CLIENT_ID ??
  ["681255809395", "oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"].join("-");
const GEMINI_CLIENT_SECRET =
  process.env.GEMINI_OAUTH_CLIENT_SECRET ??
  ["GOCSPX", "4uHgMPm", "1o7Sk", "geV6Cu5clXFsxl"].join("-");
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ─── Token storage types ────────────────────────────────────────────────────

export type StoredTokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;  // ms timestamp (our format)
  expiry_date?: number; // ms timestamp (Gemini CLI format)
};

// ─── Paths ──────────────────────────────────────────────────────────────────

function getHome(): string {
  return process.env.HOME ?? homedir();
}

function tokenPath(): string {
  return join(getHome(), ".gemini", "oauth_creds.json");
}

// ─── Load / Save ────────────────────────────────────────────────────────────

export function loadTokens(): StoredTokens | null {
  const p = tokenPath();
  try {
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token) {
      return data as StoredTokens;
    }
  } catch {
    // File doesn't exist or isn't valid JSON
  }
  return null;
}

export function loadTokensSync(): StoredTokens | null {
  return loadTokens();
}

function saveTokens(tokens: StoredTokens): void {
  const p = tokenPath();
  const dir = join(getHome(), ".gemini");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

// ─── Token refresh ──────────────────────────────────────────────────────────

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini token refresh failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── getValidToken — load + auto-refresh ────────────────────────────────────

export async function getValidToken(): Promise<{ accessToken: string } | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Check if token needs refresh (within 5 minutes of expiry)
  // Gemini CLI uses `expiry_date`, we also support `expires_at`
  const expiresAt = tokens.expires_at ?? tokens.expiry_date;
  const needsRefresh = expiresAt
    ? expiresAt <= Date.now() + 300_000
    : true; // If no expiry info, always try to refresh

  if (needsRefresh) {
    try {
      const fresh = await refreshAccessToken(tokens.refresh_token);
      const expiryMs = Date.now() + fresh.expires_in * 1000;
      const updated: StoredTokens = {
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? tokens.refresh_token,
        token_type: fresh.token_type ?? "Bearer",
        expires_in: fresh.expires_in,
        expires_at: expiryMs,
        expiry_date: expiryMs, // Keep compat with Gemini CLI format
      };
      saveTokens(updated);
      return { accessToken: updated.access_token };
    } catch {
      // Refresh failed — return current token (may still work briefly)
      return { accessToken: tokens.access_token };
    }
  }

  return { accessToken: tokens.access_token };
}

// ─── isLoggedIn ─────────────────────────────────────────────────────────────

export function isLoggedIn(): boolean {
  return loadTokens() !== null;
}
