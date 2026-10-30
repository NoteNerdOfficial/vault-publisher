import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Most tests run in plain Node, and the ones that need a DOM ask for one at
 * the top of the file:
 *
 * ```
 * // @vitest-environment jsdom
 * ```
 *
 * Thirteen of them do -- link rewriting, heading ids, the Bases re-emitter,
 * the settle predicates, the overlay script -- and none of those modules
 * touch Obsidian's own `createDiv`/`createEl` extensions to HTMLElement,
 * which is what makes a plain jsdom enough. The other sixteen never had a
 * DOM in them, and were being handed one anyway: building and tearing down a
 * jsdom per file was most of this suite's running time, and a jsdom that
 * would not let a forked worker exit was most of its unreliability. Measured
 * over the same suite: time spent building environments more than halved,
 * and the run went from about thirteen seconds to under four.
 *
 * `obsidian` is aliased because the published package is types only -- the
 * implementation is inside the app, and esbuild marks it external. Without the
 * alias, importing any module whose graph reaches it fails to resolve.
 *
 * Tests sit next to the code they cover. esbuild bundles only the
 * `src/main.ts` entry, so nothing here can reach the shipped `main.js`.
 *
 * A cap on the workers was tried first, and then taken out. Left to itself,
 * Vitest runs one fork per core less one, and this suite used to fail at
 * teardown rather than in a test -- "Timeout terminating forks worker",
 * "Worker exited unexpectedly", sometimes a segfault, always with every
 * test passing. A failure after the results are in still fails the run, so
 * `npm run build` produced no bundle and the deploy copied a stale one,
 * which looks exactly like a change that did not work.
 *
 * Measured on a 16-core machine: 0 of 2 runs clean at the default, 1 of 3
 * at four workers, 1 of 3 at two. A cap only lengthened the odds, because
 * the pool was never the cause -- something was keeping a forked child from
 * exiting once it had run, and it was the jsdom above and the keep-alive
 * sockets `fetch` leaves behind in the server tests. With both of those
 * dealt with, the default pool is 2 of 3 clean and the suite is four times
 * faster, so there is no cap here to find.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./test/obsidian-stub.ts", import.meta.url)),
    },
  },
});
