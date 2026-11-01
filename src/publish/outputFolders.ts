/**
 * Telling the build's own output apart from the vault's content.
 *
 * The plugin writes two folders *into the vault*: the preview site and the
 * reports. Both are build output, and neither is input -- but nothing used to
 * say so, because nothing had to. Note selection reads
 * `getMarkdownFiles()`, and for a long time the only Markdown the build wrote
 * was a report nobody published on purpose; the preview is HTML, which note
 * selection cannot see at all.
 *
 * Two things changed that. Publishing a vault's own HTML files made the
 * preview folder selectable input -- a build would have published its last
 * preview inside the next site, and again on every build after. And a vault
 * published whole turned out to publish `_vault-publisher/build-report.md`
 * and its neighbours as ordinary pages, which is nobody's intent: a site
 * whose pages include the report of the build that made it.
 *
 * So the rule lives here, once, and both selectors use it.
 *
 * **The exception is deliberate.** A scope that points *into* an output
 * folder is a person who typed that path, and refusing it would mean a build
 * that silently matched nothing. They get what they asked for; the rule is
 * for the folder nobody mentioned.
 */

/**
 * The folders the plugin writes into the vault.
 *
 * Duplicated from `main.ts`, which owns these names because it is what
 * writes to them, and passes them to the build. This copy is the fallback
 * for a caller that does not -- a poor thing to rely on and a fine thing to
 * fall back to, since the failure it prevents is a build consuming its own
 * output.
 */
export const DEFAULT_OUTPUT_FOLDERS = ["_vault-publisher", "_site-preview"];

/**
 * Whether a vault path is this build's own output rather than its input.
 *
 * `scope` is the folder being published, so that a scope aimed inside one of
 * these folders overrides the rule for everything under it.
 */
export function isBuildOutput(
  path: string,
  outputFolders: readonly string[] = DEFAULT_OUTPUT_FOLDERS,
  scope?: string | null,
): boolean {
  for (const folder of outputFolders) {
    if (!folder) continue;
    if (path !== folder && !path.startsWith(`${folder}/`)) continue;
    // Asked for by name, so not ours to refuse.
    if (scope && (scope === folder || scope.startsWith(`${folder}/`))) return false;
    return true;
  }
  return false;
}
