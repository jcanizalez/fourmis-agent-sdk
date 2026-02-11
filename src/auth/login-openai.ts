#!/usr/bin/env bun
/**
 * CLI script to log in to OpenAI via ChatGPT subscription OAuth.
 *
 * Usage:
 *   bun src/auth/login-openai.ts              # auto-detect (tries browser, falls back to headless)
 *   bun src/auth/login-openai.ts --headless   # skip browser, paste callback URL manually (for VPS/SSH)
 */

import { login, isLoggedIn } from "./openai-oauth.ts";

const headless = process.argv.includes("--headless");

if (isLoggedIn()) {
  console.log("Already logged in. Re-authenticating...\n");
}

const result = await login({ headless });

if (result.success) {
  console.log(`\nLogged in successfully.`);
  console.log(`Account ID: ${result.accountId}`);
  console.log(`Tokens saved to ~/.fourmis/openai-auth.json`);
} else {
  console.error(`\nLogin failed: ${result.error}`);
  process.exit(1);
}
