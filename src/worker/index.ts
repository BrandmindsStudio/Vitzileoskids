import { Hono } from "hono";
import type { AppContext } from "./env";
import { requireAuth, checkOrigin } from "./auth";
import { auth } from "./routes/auth";
import { reports } from "./routes/reports";
import { dashboard } from "./routes/dashboard";
import { photos } from "./routes/photos";
import { exportCsv } from "./routes/export";
import { settings } from "./routes/settings";

const app = new Hono<AppContext>();

// Same-site cookie + Origin check on all mutations.
app.use("/api/*", checkOrigin);

// Public: login/logout/me handle their own auth.
app.route("/api/auth", auth);

// Everything else requires a session.
app.use("/api/*", requireAuth);
app.route("/api/reports", reports);
app.route("/api/dashboard", dashboard);
app.route("/api/photos", photos);
app.route("/api/export", exportCsv);
app.route("/api/settings", settings);

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ error: "not_found" }, 404);
  }
  // Non-API paths are handled by the assets binding (SPA fallback) before the
  // Worker runs, so this is only reached in local edge cases.
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error("unhandled_error", err.message);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
