/**
 * Folders the author has said to leave out, whatever the scope takes in.
 *
 * Scope is one folder or the whole vault, and for a vault that keeps its
 * notes in one tree that has always been an awkward pair of answers: publish
 * everything including the three folders you would never show anyone, or move
 * the vault around until a single folder happens to describe what is public.
 * The frontmatter flag is the third answer and it is a different shape -- it
 * is a whitelist, so it asks every note to opt in, which is right for a vault
 * that is private by default and far too much work for one that is not.
 *
 * This is the subtraction. The scope says what is in, these say what comes
 * out of it, and the common setup -- publish the whole vault except
 * `Journal`, `People` and `Archive` -- stops needing either of the other two.
 *
 * **A blacklist is the weaker guarantee and that has to be said plainly.** A
 * folder added to the vault tomorrow is published; a folder added to this
 * list is not. For notes that would do real harm if they were published by
 * accident, the frontmatter flag is the setting that fails safe, because a
 * note nobody has thought about stays private. This one fails open. Both
 * exist, and the settings screen says so where someone is choosing.
 *
 * **Why no globs.** `Journal/**\/*.md` is a language, and a language needs its
 * own errors: a pattern that matches nothing looks exactly like a pattern
 * that matched and found nothing there. Literal paths have one failure --
 * a path that is not in the vault -- and the build report can name it. Each
 * entry is counted and an entry that excluded nothing is reported, which is
 * what catches the typo that a glob engine would have swallowed.
 */

/** One entry's effect, for the report that says what a build left out. */
export interface ExcludeTally {
  /** The entry as the author wrote it. */
  entry: string;
  /** Files it kept out of this build. Zero is worth saying. */
  count: number;
}

/**
 * An entry as it is compared: slashes forward, no slash at either end, and
 * lower case.
 *
 * Case-insensitive on purpose. macOS and Windows both have case-insensitive
 * filesystems, so `journal` and `Journal` are the same folder on the machine
 * the vault is sitting on, and a list that excluded one but not the other
 * would be a privacy setting that worked or did not depending on which key
 * the author happened to press. The cost is a vault on a case-sensitive
 * filesystem that deliberately holds both, where this excludes both; that is
 * the safer way round for a setting whose job is keeping things out.
 */
function normalize(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * The entries, cleaned up and deduplicated, in the order they were written.
 *
 * Takes the stored list or the raw text of the settings field, because the
 * field is a textarea and one path per line is how a list of paths is
 * written. Blank lines are dropped rather than refused: they are how someone
 * spaces out a list while editing it.
 */
export function parseExcludeFolders(value: string | readonly string[] | undefined): string[] {
  const lines = typeof value === "string" ? value.split(/\r?\n/) : [...(value ?? [])];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const entry = line.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Whether one entry covers a path: the path itself, or anything under it.
 *
 * An exact file path works and is not an accident. The setting is named for
 * folders because that is what it is for, but the rule that excludes a folder
 * is the same rule that excludes one note, and refusing a path with `.md` on
 * the end would be a check written to enforce the name of the field rather
 * than to do anything useful.
 */
function covers(entry: string, path: string): boolean {
  const target = normalize(path);
  return target === entry || target.startsWith(`${entry}/`);
}

/** Whether any entry keeps this path out. */
export function isExcluded(path: string, entries: readonly string[]): boolean {
  for (const entry of entries) {
    const clean = normalize(entry);
    if (clean && covers(clean, path)) return true;
  }
  return false;
}

/**
 * What each entry actually kept out, counted independently.
 *
 * Independently, so that two entries where one is inside the other both
 * report what they cover rather than the inner one reporting zero and looking
 * like a mistake. The sum can therefore be larger than the number of files
 * excluded, which is why the report says "matched" per entry rather than
 * adding them up.
 *
 * `paths` is what the build would have taken had this setting been empty --
 * scope, output folders and hidden folders already applied. Counting against
 * the whole vault instead would report a folder outside the scope as doing
 * work it never did.
 */
export function excludeTallies(
  paths: readonly string[],
  entries: readonly string[],
): ExcludeTally[] {
  return entries.map((entry) => {
    const clean = normalize(entry);
    return {
      entry,
      count: clean ? paths.filter((path) => covers(clean, path)).length : 0,
    };
  });
}

/**
 * Whether an entry takes out everything the scope takes in.
 *
 * A contradiction rather than a subtraction -- "publish `notes`, except
 * `notes`" -- and the build's honest answer to it is an empty site, which is
 * exactly what the author wrote and almost certainly not what they meant. The
 * settings screen asks this so it can say so while the field is in front of
 * them, which is the only place the mistake is cheap to fix.
 *
 * A scope of `""` is the whole vault, which any entry at the root of the
 * vault would swallow -- so only an entry that is itself the whole vault can
 * answer true for it, and there is no way to write one.
 */
export function swallowsScope(entry: string, scope: string | null): boolean {
  if (scope === null) return false;
  const clean = normalize(entry);
  if (!clean) return false;
  if (scope === "") return false;
  return covers(clean, scope);
}
