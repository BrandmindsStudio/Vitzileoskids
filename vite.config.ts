import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    // During `npm run dev`, proxy API calls to `wrangler dev` (port 8787)
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
