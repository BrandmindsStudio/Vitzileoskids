import { Hono } from "hono";
import type { AppContext } from "../env";

export const photos = new Hono<AppContext>();

// Photos are served only through this authenticated route — the R2 bucket is never public.
photos.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB
    .prepare("SELECT r2_key FROM z_report_photos WHERE id = ?")
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) return c.json({ error: "not_found" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
