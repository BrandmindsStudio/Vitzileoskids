import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppContext, AuthUser } from "./env";

// --- Password hashing (PBKDF2-SHA256 via WebCrypto; Workers caps iterations at 100k) ---

export const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${b64(salt)}:${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = unb64(parts[2]);
  const expected = unb64(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(expected, actual);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// --- Sessions ---

const COOKIE_NAME = "session";
const SESSION_DAYS = 30;

async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(db: D1Database, userId: number, c: Context): Promise<void> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const id = await sha256hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires.toISOString())
    .run();
  // Opportunistic cleanup of expired sessions.
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(db: D1Database, c: Context): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const id = await sha256hex(token);
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export async function sessionUser(db: D1Database, c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const id = await sha256hex(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(id, new Date().toISOString())
    .first<AuthUser>();
  return row ?? null;
}

// --- Middleware ---

/** Requires a valid session; sets c.var.user. */
export async function requireAuth(c: Context<AppContext>, next: Next) {
  const user = await sessionUser(c.env.DB, c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
}

/** CSRF hardening: on mutations, if an Origin header is present it must match the request origin. */
export async function checkOrigin(c: Context<AppContext>, next: Next) {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "bad_origin" }, 403);
    }
  }
  await next();
}

// --- Login rate limiting ---

const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

export async function loginRateLimited(db: D1Database, identifier: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND attempted_at > ?")
    .bind(identifier, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_ATTEMPTS;
}

export async function recordFailedLogin(db: D1Database, identifier: string): Promise<void> {
  await db.prepare("INSERT INTO login_attempts (identifier) VALUES (?)").bind(identifier).run();
}

export async function clearLoginAttempts(db: D1Database, identifier: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE identifier = ?").bind(identifier).run();
}
