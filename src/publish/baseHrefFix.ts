/**
 * Making a built application's references resolve beside it.
 *
 * `<base href="/">` is what every bundler writes until told otherwise, and
 * it is the one fault in this whole area that leaves no evidence: the page
 * publishes, every file it names travels, and the browser then resolves all
 * of them from the root of the server. A build with a relative base and one
 * without are otherwise byte-identical. See `baseHrefHazard`, which detects
 * it; this repairs it.
 *
 * ## Why both the config and the built file
 *
 * `--base-href ./` is a command-line spelling of a value that lives in the
 * project's config. Patching the built `index.html` alone works until the
 * next build overwrites it -- which is a worse failure than the original,
 * because the app renders today and is blank tomorrow with nothing changed
 * that anyone can point at.
 *
 * So a repair does both: the config, so it survives, and the file that is
 * already on disk, so the next preview shows it working without waiting for
 * a rebuild.
 *
 * ## Why a text edit and not a reparse
 *
 * `angular.json` is the user's file, usually in version control, and often
 * hand-arranged. `JSON.parse` followed by `JSON.stringify` would hand them
 * back a diff touching every line, which is not a repair anybody asked for.
 * So the edit is made in the text: the value is replaced where the key
 * exists, and one line is inserted where it does not. The surrounding
 * document comes back unchanged, byte for byte.
 *
 * ## What is deliberately not edited
 *
 * **A Vite config is not data.** It is a TypeScript module that exports the
 * result of a function call, and the value may be computed, conditional, or
 * spread in from elsewhere. There is no edit to it that is correct in
 * general, so none is attempted: the caller is given the two lines to paste
 * and the user decides where they go.
 */

/** The `href` of a `<base>` tag, with the quote style captured. */
const BASE_TAG_HREF = /(<base\b[^>]*\bhref\s*=\s*)(["']?)([^"'>\s]*)\2/i;

/** Any `<base>` tag at all, for the question "is there one". */
const BASE_TAG = /<base\b[^>]*>/i;

/** `<head>`, with whatever attributes, which nothing sane gives it. */
const HEAD_OPEN = /<head\b[^>]*>/i;

export interface Patch {
  /** The file's new text. */
  text: string;
  /** What changed, in a line a confirmation dialog can show. */
  summary: string;
}

/**
 * A built page's `<base href>`, set to a value that resolves beside it.
 *
 * Three cases, and the third is the one worth naming: a page with no
 * `<base>` at all is already relative and needs nothing, so it is left
 * alone rather than given a tag it never had. Returning null for "nothing
 * to do" keeps the caller from reporting a repair it did not make.
 */
export function patchBuiltPage(html: string, value = "./"): Patch | null {
  const existing = BASE_TAG_HREF.exec(html);
  if (existing) {
    if (existing[3] === value) return null;
    const quote = existing[2] || '"';
    return {
      text: html.replace(BASE_TAG_HREF, `$1${quote}${value}${quote}`),
      summary: `base href "${existing[3]}" becomes "${value}"`,
    };
  }

  /*
   * A `<base>` with no href is malformed and resolves to the document's
   * own URL, which is the behaviour we want anyway -- but it will confuse
   * the next person to read it, so it is given the value explicitly.
   */
  if (BASE_TAG.test(html)) {
    return {
      text: html.replace(BASE_TAG, `<base href="${value}">`),
      summary: `a <base> tag with no href gets href="${value}"`,
    };
  }

  // No base tag: every reference is already resolved against the page.
  return null;
}

/**
 * The slice of text holding one JSON object, given where its `{` is.
 *
 * Brace counting, with strings and their escapes skipped so a `}` inside a
 * path or a glob does not close the object early. Returns the index just
 * past the matching `}`, or -1 when the document is unbalanced -- in which
 * case the caller declines to edit, which is the right answer for a file
 * this cannot read.
 */
export function objectEnd(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Where a project's build options object begins in an `angular.json`.
 *
 * Walked key by key rather than by one regex, because every name involved
 * -- the project, `architect`, `build`, `options` -- also occurs elsewhere
 * in the same document, and a regex that found the first `"options"` would
 * edit the wrong target as readily as the right one. Each step searches
 * only inside the object the previous step opened.
 *
 * `targets` is accepted beside `architect`: Nx uses the first name for the
 * same block, and a vault may hold either.
 */
export function angularBuildOptions(text: string, project: string): { open: number; end: number } | null {
  const at = text.indexOf(`"${project}"`);
  if (at === -1) return null;

  let from = at;
  let bound = text.length;
  for (const key of ["architect|targets", "build", "options"]) {
    let found = -1;
    for (const name of key.split("|")) {
      const hit = text.indexOf(`"${name}"`, from);
      if (hit !== -1 && hit < bound && (found === -1 || hit < found)) found = hit;
    }
    if (found === -1) return null;
    const open = text.indexOf("{", found);
    if (open === -1) return null;
    const end = objectEnd(text, open);
    if (end === -1) return null;
    from = open + 1;
    bound = end;
  }
  // `from` is one past the `{` of the options object, `bound` its close.
  return { open: from - 1, end: bound };
}

/**
 * `baseHref` written into a project's build options, in place.
 *
 * Replaces the value where the key is already there, and otherwise inserts
 * one line immediately after the opening brace, indented to match whatever
 * follows it. Nothing else in the document is touched.
 */
export function patchAngularConfig(
  text: string,
  project: string,
  value = "./",
): Patch | null {
  const span = angularBuildOptions(text, project);
  if (!span) return null;

  const body = text.slice(span.open, span.end);
  const existing = /("baseHref"\s*:\s*")([^"]*)(")/.exec(body);
  if (existing) {
    if (existing[2] === value) return null;
    const patched = body.replace(/("baseHref"\s*:\s*")([^"]*)(")/, `$1${value}$3`);
    return {
      text: text.slice(0, span.open) + patched + text.slice(span.end),
      summary: `angular.json: baseHref "${existing[2]}" becomes "${value}" for ${project}`,
    };
  }

  /*
   * The indentation of the line after the brace, so an inserted key lines
   * up with its siblings. A file written on one line has no next line to
   * copy, and gets no newline either -- which is still valid JSON.
   */
  const after = text.slice(span.open + 1);
  const indent = /^\r?\n([ \t]*)/.exec(after);
  const insert = indent
    ? `\n${indent[1]}"baseHref": "${value}",`
    : `"baseHref": "${value}",`;

  return {
    text: text.slice(0, span.open + 1) + insert + after,
    summary: `angular.json: baseHref "${value}" added to ${project}`,
  };
}

/**
 * `"homepage": "."` in a `package.json`, which is how create-react-app
 * spells the same thing.
 *
 * The key is at the top level here rather than nested in a build target, so
 * the edit is simpler: replace the value, or insert after the opening brace
 * of the document.
 */
export function patchPackageHomepage(text: string, value = "."): Patch | null {
  const existing = /("homepage"\s*:\s*")([^"]*)(")/.exec(text);
  if (existing) {
    if (existing[2] === value) return null;
    return {
      text: text.replace(/("homepage"\s*:\s*")([^"]*)(")/, `$1${value}$3`),
      summary: `package.json: homepage "${existing[2]}" becomes "${value}"`,
    };
  }

  const open = text.indexOf("{");
  if (open === -1) return null;
  const after = text.slice(open + 1);
  const indent = /^\r?\n([ \t]*)/.exec(after);
  const insert = indent ? `\n${indent[1]}"homepage": "${value}",` : `"homepage": "${value}",`;
  return {
    text: text.slice(0, open + 1) + insert + after,
    summary: `package.json: homepage "${value}" added`,
  };
}

/**
 * What to paste into a Vite config, for the one case this will not edit.
 *
 * Shown rather than applied, because a Vite config is executable and its
 * `base` may be computed. Two lines, in the shape the config already has.
 */
export const VITE_BASE_HINT =
  `In your vite.config, set the base to a relative path:\n\n` +
  `export default defineConfig({\n` +
  `  base: "./",\n` +
  `  // ...the rest of your config\n` +
  `});`;
