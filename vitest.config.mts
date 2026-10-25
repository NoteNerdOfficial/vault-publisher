import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests run against jsdom because much of what is worth testing here operates
 * on a detached DOM: link rewriting, heading ids, the Bases re-emitter, the
 * settle predicates. None of those modules touch Obsidian's own
 * `createDiv`/`createEl` extensions to HTMLElement, which is what makes a
 * plain DOM enough.
 *
 * `obsidian` is aliased because the published package is types only -- the
 * implementation is inside the app, and esbuild marks it external. Without the
 * alias, importing any module whose graph reaches it fails to resolve.
 *
 * Tests sit next to the code they cover. esbuild bundles only the
 * `src/main.ts` entry, so nothing here can reach the shipped `main.js`.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./test/obsidian-stub.ts", import.meta.url)),
    },
  },
});
