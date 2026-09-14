// QA-ONLY Vite config — used exclusively by qa/visual-qa.mts to mount the
// REAL ExaminerDashboard + VenueHeader in headless Chromium with stubbed
// auth. Never used for production builds; prod files are untouched.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  configFile: false,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Array form, ordered: the exact-match stub MUST come before the "@"
    // prefix alias, otherwise "@" swallows it and the real Convex hook loads.
    alias: [
      {
        find: /^@\/hooks\/use-auth$/,
        replacement: path.resolve(here, "./use-auth-stub.ts"),
      },
      { find: "@", replacement: path.resolve(here, "../src") },
    ],
  },
  build: {
    outDir: path.resolve(here, "./dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(here, "./qa.html"),
    },
  },
  // Quiet the dev server; the harness talks to it over HTTP only.
  logLevel: "silent",
});
