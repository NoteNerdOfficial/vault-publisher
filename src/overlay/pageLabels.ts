/**
 * What to call each page in a review, when several of them are called the
 * same thing.
 *
 * A review is a list of comments from the whole site, so every heading and
 * every row has to say which page it is about -- and a vault that publishes
 * applications as they are holds several pages called `index`. The filename
 * alone is what a reviewer knows a note as and is the right answer for notes;
 * it is no answer at all for four stock builds, because every tool that
 * builds for the web writes an entry point with the same name.
 *
 * So a page is named by the shortest tail of its path that no other page in
 * the same review wears. `Scope` where that decides, `react-default/index`
 * where it does not, a second folder only where the first still does not
 * separate them. Being ambiguous is not a property of a page: it is a
 * property of a page sitting in a list beside another one, which is why this
 * takes the whole set rather than one path at a time.
 *
 * **The review overlay carries its own copy of this rule**, in the script it
 * ships to the browser -- see `relabel` in `overlayScript.ts`. It cannot
 * import this one: the overlay is a string of JavaScript rather than a module
 * the bundler links. `pageLabels.parity.test.ts` runs the real overlay and
 * checks the two agree, for the same reason `anchor.ts` has a parity test
 * with the stamping the overlay does in the browser. Two labellings that
 * disagree would be worse than either on its own: the panel and the imported
 * note would be saying different things about the same page.
 */

/**
 * Filenames that name nothing on their own.
 *
 * `index` is the one that matters and the rest are the same mistake by other
 * spellings. A page with one of these names is always qualified by its
 * folder, whether or not anything else in the review shares the name: one
 * "index" in a list is no clearer than four, since it still does not say what
 * it is the index of -- and the folder above it is exactly what a person
 * calls these, the React one, the Angular one, the demo.
 */
const VAGUE = new Set([
  "index",
  "home",
  "main",
  "app",
  "page",
  "readme",
  "default",
  "untitled",
]);

/** A path as segments, with the extension off the last one. */
function partsOf(path: string): string[] {
  const parts = path.split("/").filter((segment) => segment !== "");
  if (!parts.length) return [];
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.(md|html?)$/i, "");
  return parts;
}

/** The last `take` segments of a path, joined. */
function tail(parts: string[], take: number): string {
  return parts.slice(Math.max(0, parts.length - take)).join("/");
}

/**
 * Each path's label, keyed by the path exactly as it was given.
 *
 * A path with nothing in it is "Untitled", which is what a comment carrying
 * no page at all has always been shown as.
 */
export function labelPaths(paths: string[]): Map<string, string> {
  const unique = [...new Set(paths)];
  const parts = new Map(unique.map((path) => [path, partsOf(path)]));
  const labels = new Map<string, string>();

  for (const path of unique) {
    const own = parts.get(path) ?? [];
    if (!own.length) {
      labels.set(path, "Untitled");
      continue;
    }

    // A vague filename starts one folder up, so it is qualified even when it
    // is the only one of its name here.
    const from = VAGUE.has(own[own.length - 1].toLowerCase()) && own.length > 1 ? 2 : 1;

    let label = tail(own, own.length);
    for (let take = from; take <= own.length; take++) {
      const candidate = tail(own, take);
      // The other page's tail at the same depth, or all of it when it is
      // shallower -- a shorter path cannot collide with a longer tail.
      const clash = unique.some(
        (other) => other !== path && tail(parts.get(other) ?? [], take) === candidate,
      );
      if (!clash) {
        label = candidate;
        break;
      }
    }
    labels.set(path, label);
  }

  return labels;
}
