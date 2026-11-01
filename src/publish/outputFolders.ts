/**
 * The folders neither selector looks at, whatever the scope says.
 *
 * Two rules, and the same shape to both: a folder nobody meant to publish,
 * skipped before anything else is considered, with one exemption -- a scope
 * aimed inside such a folder is somebody naming the path, and refusing it
 * would mean a build that matched nothing and could not say why.
 *
 * The first rule is the build's own output; the second is anything hidden.
 *
 * **The build's own output.**
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

/**
 * Whether a path is inside something hidden, by the leading-dot convention.
 *
 * Obsidian keeps dot-folders out of its own interface and indexes their
 * contents anyway, which is a combination worth stating plainly: a note in
 * `.archive/` cannot be seen in the app and *was* published by a vault
 * published whole. The author would have found out from the live site, which
 * is the class of failure the unchosen-scope default exists to prevent.
 *
 * `.obsidian` is the obvious one -- a plugin's own folder holds a great deal
 * of HTML and the occasional Markdown file, none of it anybody's page -- but
 * the rule is the convention rather than that one name. `.trash` is where
 * Obsidian puts a deleted note, and publishing those would be worse than
 * merely untidy.
 *
 * The exemption is the same as above, and for the same reason: somebody
 * whose scope *is* `.archive` has said what they want.
 */
export function isHiddenPath(path: string, scope?: string | null): boolean {
  if (!isHidden(path)) return false;
  // Only a hidden scope can exempt a hidden path, and only what is under it.
  // A scope of "" is the whole vault, which is where this rule matters most,
  // and must not exempt anything.
  if (scope && isHidden(scope) && (path === scope || path.startsWith(`${scope}/`))) {
    return false;
  }
  return true;
}

/** Any segment beginning with a dot makes the whole path hidden. */
function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}
