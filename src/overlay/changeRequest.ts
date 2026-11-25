/**
 * A change request as a note in the vault: what Edit mode's Describe stack
 * saves, so the request is kept, and an AI coding tool can be pointed at a
 * file rather than a paste.
 *
 * The body is the same prompt Copy for AI puts on the clipboard, word for
 * word, under a little frontmatter that says which page it is about and
 * whether it has been dealt with.
 */

export const DEFAULT_CHANGE_REQUESTS_FOLDER = "Change requests";

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-24`, in local time, as a person dates a note. */
export function noteDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The note's name without the folder: the page's name and the day, then
 * " 2", " 3" when that name is taken. A page called index is named for its
 * folder, which is the name a person knows it by. Characters a file name
 * can't hold are dropped.
 */
export function noteName(pagePath: string, now: Date, taken: (name: string) => boolean): string {
  const parts = pagePath.split("/");
  let file = parts.pop() ?? "page";
  if (/^index\.[^.]+$/i.test(file) && parts.length) file = parts.pop() + ".html";
  const base = (file.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "page") +
    " " + noteDate(now);
  let name = `${base}.md`;
  for (let n = 2; taken(name) && n < 1000; n++) name = `${base} ${n}.md`;
  return name;
}

/** The note itself: frontmatter, a line on how to use it, then the request. */
export function noteText(pagePath: string, request: string, now: Date): string {
  const quoted = JSON.stringify(pagePath);
  return [
    "---",
    `page: ${quoted}`,
    `created: ${noteDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    "status: open",
    "tags:",
    "  - change-request",
    "---",
    "",
    "> Made in Edit mode. Hand this note to an AI coding tool, for example:",
    `> "Read this note and make the changes it asks for."`,
    "",
    request.trim(),
    "",
  ].join("\n");
}
