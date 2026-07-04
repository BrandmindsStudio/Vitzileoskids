#!/usr/bin/env node
// Seeds the two users (owner + shop assistant) into D1.
// There is no signup page — this is the only way accounts are created.
//
// Usage:
//   node scripts/seed-users.mjs --remote owner@example.com OwnerPass 'Owner Name' assistant@example.com AssistantPass 'Assistant Name'
// or via env vars:
//   OWNER_EMAIL=... OWNER_PASSWORD=... ASSISTANT_EMAIL=... ASSISTANT_PASSWORD=... node scripts/seed-users.mjs --remote
//
// Pass --local instead of --remote to seed the local wrangler dev database.
// The PBKDF2 parameters must match src/worker/auth.ts (SHA-256, 100000 iterations).

import { webcrypto as crypto } from "node:crypto";
import { spawnSync } from "node:child_process";

const ITERATIONS = 100_000;
const DB_NAME = "vitzileos-zreport";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : "--local";
const positional = args.filter((a) => !a.startsWith("--"));

const users = [];
if (positional.length >= 4) {
  users.push({ email: positional[0], password: positional[1], name: positional[2] ?? "Owner" });
  users.push({ email: positional[3], password: positional[4], name: positional[5] ?? "Assistant" });
} else {
  const { OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME, ASSISTANT_EMAIL, ASSISTANT_PASSWORD, ASSISTANT_NAME } = process.env;
  if (!OWNER_EMAIL || !OWNER_PASSWORD || !ASSISTANT_EMAIL || !ASSISTANT_PASSWORD) {
    console.error("Provide 4-6 positional args or OWNER_EMAIL/OWNER_PASSWORD/ASSISTANT_EMAIL/ASSISTANT_PASSWORD env vars.");
    process.exit(1);
  }
  users.push({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: OWNER_NAME ?? "Owner" });
  users.push({ email: ASSISTANT_EMAIL, password: ASSISTANT_PASSWORD, name: ASSISTANT_NAME ?? "Assistant" });
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  return `pbkdf2:${ITERATIONS}:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const statements = [];
for (const u of users) {
  const hash = await hashPassword(u.password);
  statements.push(
    `INSERT INTO users (email, password_hash, name) VALUES (${sqlString(u.email.toLowerCase())}, ${sqlString(hash)}, ${sqlString(u.name)}) ` +
      `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name;`,
  );
}

const sql = statements.join(" ");
console.log(`Seeding ${users.length} users into ${DB_NAME} (${target})...`);
const result = spawnSync("npx", ["wrangler", "d1", "execute", DB_NAME, target, "--command", sql], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
