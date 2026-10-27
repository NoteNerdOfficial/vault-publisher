import { describe, expect, it } from "vitest";
import { PruneAdapter, pruneStale } from "./prune";

/**
 * A vault directory tree, flat.
 *
 * Keyed by path so a test reads as the set of files that exist, and `list`
 * derives directories from the keys the way the real adapter derives them
 * from disk. Removals are recorded in order, because the one thing a prune
 * must get right is removing files before the directories holding them.
 */
function fakeVault(paths: string[]): PruneAdapter & {
  paths: Set<string>;
  order: string[];
  fail?: (path: string) => string | undefined;
} {
  const vault = {
    paths: new Set(paths),
    order: [] as string[],
    fail: undefined as ((path: string) => string | undefined) | undefined,

    async exists(path: string) {
      return (
        vault.paths.has(path) ||
        [...vault.paths].some((p) => p.startsWith(`${path}/`))
      );
    },

    async list(path: string) {
      const files: string[] = [];
      const folders = new Set<string>();
      for (const candidate of vault.paths) {
        if (!candidate.startsWith(`${path}/`)) continue;
        const rest = candidate.slice(path.length + 1);
        const slash = rest.indexOf("/");
        if (slash === -1) files.push(candidate);
        else folders.add(`${path}/${rest.slice(0, slash)}`);
      }
      return { files, folders: [...folders] };
    },

    async remove(path: string) {
      const reason = vault.fail?.(path);
      if (reason) throw new Error(reason);
      vault.paths.delete(path);
      vault.order.push(path);
    },

    async rmdir(path: string) {
      const reason = vault.fail?.(path);
      if (reason) throw new Error(reason);
      vault.order.push(`${path}/`);
    },
  };
  return vault;
}

const ROOT = "_site-preview";

describe("pruning the preview", () => {
  it("removes what the build no longer writes and keeps what it does", async () => {
    const vault = fakeVault([
      `${ROOT}/index.html`,
      `${ROOT}/notes/kept.html`,
      `${ROOT}/notes/renamed-away.html`,
      `${ROOT}/assets/site.css`,
    ]);
    const kept = new Set([
      `${ROOT}/index.html`,
      `${ROOT}/notes/kept.html`,
      `${ROOT}/assets/site.css`,
    ]);

    const result = await pruneStale(vault, ROOT, kept);

    expect(result.removed).toEqual([`${ROOT}/notes/renamed-away.html`]);
    expect(result.failed).toEqual([]);
    expect(vault.paths).toEqual(kept);
  });

  // The whole point: a filter that matches nothing is not an instruction to
  // delete the site.
  it("refuses to run when the build produced nothing", async () => {
    const vault = fakeVault([`${ROOT}/index.html`, `${ROOT}/notes/a.html`]);

    const result = await pruneStale(vault, ROOT, new Set());

    expect(result.refused).toBe("the build produced no files");
    expect(result.removed).toEqual([]);
    expect(vault.paths.size).toBe(2);
  });

  it("takes a directory the build stopped writing into, with its contents", async () => {
    const vault = fakeVault([
      `${ROOT}/index.html`,
      `${ROOT}/old/deep/page.html`,
      `${ROOT}/old/page.html`,
    ]);

    const result = await pruneStale(vault, ROOT, new Set([`${ROOT}/index.html`]));

    expect(result.removed.sort()).toEqual([
      `${ROOT}/old/deep/page.html`,
      `${ROOT}/old/page.html`,
    ]);
    // One removal for the tree, not one per level: the nested directory goes
    // with its parent rather than being named separately.
    expect(result.emptied).toEqual([`${ROOT}/old`]);
    expect(vault.order).toContain(`${ROOT}/old/`);
    expect(vault.order).not.toContain(`${ROOT}/old/deep/`);
  });

  // The listing is the tempting check and the wrong one. A directory holding
  // nothing the build kept goes even if listing it still reports the files
  // we just removed, which is what a cached or lagging adapter does.
  it("removes a stale directory although the listing still shows its contents", async () => {
    const vault = fakeVault([`${ROOT}/kept.html`, `${ROOT}/old/page.html`]);
    const lagging: PruneAdapter = {
      ...vault,
      async list(path: string) {
        if (path === ROOT) {
          return { files: [`${ROOT}/kept.html`], folders: [`${ROOT}/old`] };
        }
        // Never catches up: always reports the file, removed or not.
        return { files: [`${ROOT}/old/page.html`], folders: [] };
      },
    };

    const result = await pruneStale(lagging, ROOT, new Set([`${ROOT}/kept.html`]));

    expect(result.emptied).toEqual([`${ROOT}/old`]);
    expect(result.failed).toEqual([]);
  });

  it("keeps a directory that still holds something the build wrote", async () => {
    const vault = fakeVault([
      `${ROOT}/notes/kept.html`,
      `${ROOT}/notes/stale.html`,
    ]);

    const result = await pruneStale(vault, ROOT, new Set([`${ROOT}/notes/kept.html`]));

    expect(result.removed).toEqual([`${ROOT}/notes/stale.html`]);
    expect(result.emptied).toEqual([]);
  });

  it("leaves the root in place even when everything under it goes", async () => {
    const vault = fakeVault([`${ROOT}/gone.html`, `${ROOT}/kept.html`]);

    const result = await pruneStale(vault, ROOT, new Set([`${ROOT}/kept.html`]));

    expect(result.emptied).toEqual([]);
    expect(result.removed).toEqual([`${ROOT}/gone.html`]);
  });

  it("does nothing when the preview folder is not there yet", async () => {
    const vault = fakeVault([]);

    const result = await pruneStale(vault, ROOT, new Set([`${ROOT}/index.html`]));

    expect(result).toEqual({ removed: [], emptied: [], failed: [] });
  });

  it("reports a file it cannot remove instead of failing the build", async () => {
    const vault = fakeVault([`${ROOT}/kept.html`, `${ROOT}/locked.html`]);
    vault.fail = (path) =>
      path.endsWith("locked.html") ? "EBUSY: resource busy" : undefined;

    const result = await pruneStale(vault, ROOT, new Set([`${ROOT}/kept.html`]));

    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([
      { path: `${ROOT}/locked.html`, reason: "EBUSY: resource busy" },
    ]);
  });

  // Paths come from our own build, but a prune is the wrong place to find out
  // that something upstream got a path wrong.
  it("ignores anything the listing reports outside the root", async () => {
    const vault = fakeVault([`${ROOT}/kept.html`]);
    const escaping: PruneAdapter = {
      ...vault,
      async list(path: string) {
        if (path !== ROOT) return { files: [], folders: [] };
        return {
          files: [`${ROOT}/kept.html`, "notes/a-real-note.md", "../outside.txt"],
          folders: [".obsidian"],
        };
      },
    };

    const result = await pruneStale(escaping, ROOT, new Set([`${ROOT}/kept.html`]));

    expect(result.removed).toEqual([]);
    expect(vault.order).toEqual([]);
  });
});
