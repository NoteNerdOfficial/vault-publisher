/**
 * Removing what the build no longer produces.
 *
 * A build writes every file it makes and, without this, nothing ever deletes
 * one it has stopped making. Rename a note and its old page stays behind; the
 * stylesheet is rewritten on every build, so that leftover is then served
 * with current CSS against markup from whenever it was last rendered. It does
 * not look like a stale file, it looks like a broken one, which is the worst
 * way for this to fail.
 *
 * Publishing never had the problem: it uploads a complete tree, so a file
 * simply absent from it is gone. This gives the local preview the same
 * property by subtraction instead.
 *
 * Three rules, because this deletes things in someone's vault:
 *
 *   - **An empty build prunes nothing.** A filter that matches no notes, or a
 *     render that failed before writing, must not be read as "delete the
 *     site". The caller's own guard is a notice; this one is a refusal.
 *   - **Nothing outside the root is touched**, whatever a path claims. Paths
 *     come from our own build, but a traversal bug should not be able to
 *     reach the vault.
 *   - **A failure is reported, not thrown.** A file held open elsewhere is
 *     worth telling the user about and not worth failing a build over.
 *
 * One known gap: Obsidian's adapter does not list dotfiles, so an orphaned
 * `.something` is invisible here. The build writes exactly one, `.nojekyll`,
 * and it is never stale.
 */

/** The slice of Obsidian's DataAdapter this needs. */
export interface PruneAdapter {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface PruneResult {
  /** Paths removed, vault-relative. */
  removed: string[];
  /** Directories removed because the build kept nothing inside them. */
  emptied: string[];
  /** Paths that could not be removed, with the reason. */
  failed: { path: string; reason: string }[];
  /** Set when the prune declined to run at all. */
  refused?: string;
}

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Deletes every file under `root` that this build did not write.
 *
 * `kept` holds the paths the build produced, vault-relative and in the same
 * form `list` returns, which is what makes the comparison a set difference
 * rather than a guess about what a stale file looks like.
 */
export async function pruneStale(
  adapter: PruneAdapter,
  root: string,
  kept: ReadonlySet<string>,
): Promise<PruneResult> {
  const result: PruneResult = { removed: [], emptied: [], failed: [] };

  if (kept.size === 0) {
    result.refused = "the build produced no files";
    return result;
  }
  if (!(await adapter.exists(root))) return result;

  // Breadth-first, collecting directories so they can be emptied from the
  // leaves back up once their contents are gone.
  const directories: string[] = [];
  const queue = [root];

  while (queue.length) {
    const directory = queue.shift() as string;
    let listing;
    try {
      listing = await adapter.list(directory);
    } catch (error) {
      result.failed.push({ path: directory, reason: reasonFor(error) });
      continue;
    }

    for (const file of listing.files) {
      if (!within(root, file) || kept.has(file)) continue;
      try {
        await adapter.remove(file);
        result.removed.push(file);
      } catch (error) {
        result.failed.push({ path: file, reason: reasonFor(error) });
      }
    }

    for (const folder of listing.folders) {
      if (!within(root, folder)) continue;
      directories.push(folder);
      queue.push(folder);
    }
  }

  // A directory goes when the build kept nothing inside it, decided from
  // `kept` rather than by listing it again. The listing is the tempting
  // check and the wrong one: it answers a question about the directory at
  // the moment it is asked, which is not reliably after our own removals
  // landed, whereas `kept` is what the build actually wrote and cannot go
  // stale underneath us.
  //
  // Shallowest first, each removed with its contents in one call, so a tree
  // of stale directories costs one removal rather than one per level.
  const stale = directories
    .filter((directory) => !holdsSomethingKept(directory, kept))
    .sort((a, b) => depth(a) - depth(b));

  for (const directory of stale) {
    // Already gone with an ancestor.
    if (result.emptied.some((done) => directory.startsWith(`${done}/`))) continue;
    try {
      await adapter.rmdir(directory, true);
      result.emptied.push(directory);
    } catch (error) {
      result.failed.push({ path: directory, reason: reasonFor(error) });
    }
  }

  return result;
}

function holdsSomethingKept(directory: string, kept: ReadonlySet<string>): boolean {
  const prefix = `${directory}/`;
  for (const path of kept) if (path.startsWith(prefix)) return true;
  return false;
}

function depth(path: string): number {
  return path.split("/").length;
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
