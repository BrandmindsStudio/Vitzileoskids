import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env";

export const settings = new Hono<AppContext>();

const SettingsSchema = z.object({
  closed_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
});

settings.get("/", async (c) => {
  const row = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'closed_weekdays'")
    .first<{ value: string }>();
  let closed: number[] = [0];
  try {
    if (row?.value) closed = JSON.parse(row.value);
  } catch {
    // keep default
  }
  return c.json({ closed_weekdays: closed });
});

settings.put("/", async (c) => {
  const parsed = SettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  await c.env.DB
    .prepare("INSERT INTO settings (key, value) VALUES ('closed_weekdays', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(parsed.data.closed_weekdays))
    .run();
  return c.json({ ok: true });
});
