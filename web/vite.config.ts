import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULTS } from "../server/src/config.js";
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __DEMO_CONFIG__: JSON.stringify(DEFAULTS) },
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  worker: { format: "es" },
});
