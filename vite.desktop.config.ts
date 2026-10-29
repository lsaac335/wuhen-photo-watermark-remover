import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "desktop-web"),
  publicDir: false,
  plugins: [react()],
  base: "/",
  build: {
    outDir: resolve(__dirname, "desktop-app/wwwroot"),
    emptyOutDir: true,
    target: "chrome110",
    sourcemap: false,
  },
});
