/**
 * The folders neither selector looks at, whatever the scope says.
 *
 * Three rules, and the same shape to all of them: a folder nobody meant to
 * publish, skipped before anything else is considered, with one exemption --
 * a scope aimed inside such a folder is somebody naming the path, and
 * refusing it would mean a build that matched nothing and could not say why.
 *
 * The first rule is the build's own output; the second is anything hidden;
 * the third is somebody else's code, installed rather than written.
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

/**
 * Folders holding installed dependencies, which are code and not content.
 *
 * `node_modules` is the one that matters and the one this was written for. A
 * vault with a prototype in it has one, Obsidian indexes it like any other
 * folder -- it has no leading dot, so the rule above does not reach it -- and
 * nothing here used to look at the name, so a build treated the whole
 * dependency tree as vault content. What that costs is worth spelling out,
 * because "slow" undersells it:
 *
 *   - **Every package's `README.md` is a note.** This repository's own
 *     `node_modules` holds 753 Markdown files and 4.5 MB of them, and each one
 *     goes through the full note pipeline: Obsidian's Markdown renderer, the
 *     link rewriter, the privacy scan, a page assembled around it. A
 *     prototype's tree is usually larger.
 *   - **Every bundled `.html` is a page**, once `publishHtmlFiles` is on --
 *     a package's coverage report, its demo, its test fixtures -- each read,
 *     scanned for references and published.
 *   - **And the cost is not linear.** Every page carries the whole vault
 *     listing (see `nav.ts`), so N files published means N rows inlined into
 *     each of N pages. A few thousand files is where that stops being slow
 *     and starts being a build that does not finish.
 *
 * So the names are refused by name. Three of them, all unambiguous: no
 * project has ever meant one of these to be read by a person.
 *
 * **`vendor` is deliberately not here**, though it is the same thing in PHP
 * and Go. It is also an ordinary English word and a perfectly good name for a
 * folder of notes about suppliers, and silently not publishing somebody's
 * notes is worse than publishing a dependency slowly. The excluded-folders
 * setting is the right tool for a folder whose name only its author knows the
 * meaning of, and it reports what it left out.
 *
 * Matched on any segment, not just the first: a prototype's dependencies are
 * at `proto/node_modules`, and npm nests them inside each other.
 */
export const DEPENDENCY_FOLDERS = ["node_modules", "bower_components", "jspm_packages"];

/**
 * Whether a vault path is inside installed dependencies.
 *
 * The exemption is the one the other two rules have, and it is not merely
 * consistency: a reviewer whose scope *is* `proto/node_modules/some-demo`
 * has named the path, and a build that matched nothing and could not say why
 * is the failure that rule exists to prevent.
 */
export function isDependencyPath(path: string, scope?: string | null): boolean {
  if (!hasDependencySegment(path)) return false;
  if (scope && hasDependencySegment(scope)) {
    if (path === scope || path.startsWith(`${scope}/`)) return false;
  }
  return true;
}

/** The dependency folder a path sits in, as a vault path, or null. */
export function dependencyRoot(path: string): string | null {
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    if (DEPENDENCY_FOLDERS.indexOf(parts[i]) !== -1) {
      return parts.slice(0, i + 1).join("/");
    }
  }
  return null;
}

function hasDependencySegment(path: string): boolean {
  return path.split("/").some((segment) => DEPENDENCY_FOLDERS.indexOf(segment) !== -1);
}
