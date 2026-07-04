import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env";
import {
  verifyPassword,
  createSession,
  destroySession,
  sessionUser,
  loginRateLimited,
  recordFailedLogin,
  clearLoginAttempts,
} from "../auth";

export const auth = new Hono<AppContext>();

const LoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

auth.post("/login", async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const { email, password } = parsed.data;

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const identifiers = [`email:${email.toLowerCase()}`, `ip:${ip}`];
  for (const id of identifiers) {
    if (await loginRateLimited(c.env.DB, id)) {
      return c.json({ error: "rate_limited" }, 429);
    }
  }

  const user = await c.env.DB
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<{ id: number; email: string; name: string | null; password_hash: string }>();

  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    for (const id of identifiers) await recordFailedLogin(c.env.DB, id);
    return c.json({ error: "invalid_credentials" }, 401);
  }

  for (const id of identifiers) await clearLoginAttempts(c.env.DB, id);
  await createSession(c.env.DB, user.id, c);
  return c.json({ id: user.id, email: user.email, name: user.name });
});

auth.post("/logout", async (c) => {
  await destroySession(c.env.DB, c);
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const user = await sessionUser(c.env.DB, c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(user);
});
