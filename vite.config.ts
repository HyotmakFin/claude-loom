/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
  },
  envPrefix: ["VITE_"],
  build: {
    // WebKitGTK / WKWebView 基线
    target: "chrome130",
    minify: !process.env.LOOM_DEBUG,
    sourcemap: !!process.env.LOOM_DEBUG,
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
