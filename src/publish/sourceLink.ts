/**
 * Where the site says it came from.
 *
 * A published site is a rendering of somebody's vault, and the one question a
 * reader of a rendering asks that the pages themselves cannot answer is where
 * the thing lives. So the bar can carry a link to the repository -- which
 * sounds like a setting with a URL in it, and nearly isn't: the plugin
 * already knows a repository, because it pushes the site into one.
 *
 * Hence two settings rather than one. A switch, because a link to the
 * repository is a decision about the published site and not every site wants
 * one; and an address, because the repository the site is *pushed* to is not
 * always the one its source is in. A vault published to an output-only repo
 * on a `gh-pages` branch is an ordinary setup, and pointing readers at it
 * would be pointing them at the build rather than at the work.
 *
 * Left blank, the address is derived from the publish target, which is right
 * for the common case and is the only thing here that can be guessed at all.
 * Typed, it is used as it stands and nothing is inferred -- including the
 * host, which is why none of this says "github.com" anywhere a URL is read.
 */

/** The toggle and the address, as they are stored. */
export interface SourceLinkSettings {
  /** Put a link to the repository in the site's bar. */
  enabled: boolean;
  /** Any address. Blank means the repository the site publishes to. */
  url: string;
}

/** Enough of the publish target to name its page on the web. */
export interface SourceRepoRef {
  /** API root, which on Enterprise Server is not the web address. */
  apiBase: string;
  owner: string;
  repo: string;
}

/**
 * The web address of a GitHub host, given the API root the plugin talks to.
 *
 * The two are the same host on Enterprise Server and deliberately different
 * on GitHub.com, where the API is `api.github.com` and the pages people read
 * are at `github.com`. Both conventions come down to the same two edits: take
 * off the `/api/v3` path Enterprise Server's root carries, and take off the
 * `api.` the hosted one puts on the front.
 *
 * An address that cannot be parsed falls back to github.com rather than
 * throwing. The caller is drawing a button, and the only setting that could
 * have produced an unparseable API root is one the publish is already failing
 * on with a better message.
 */
export function githubWebHost(apiBase: string): string {
  const raw = (apiBase ?? "").trim();
  if (!raw) return "https://github.com";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "https://github.com";
  }

  const host = parsed.host.replace(/^api\./i, "");
  return `${parsed.protocol}//${host}`;
}

/**
 * Why an address cannot be used, in words a settings row can print, or null
 * when it can.
 *
 * Only the two schemes a browser will follow from a published page. This is
 * not defensive tidiness: the value is written straight into an `href` on
 * every page of the site, so `javascript:` in this field would be a script
 * the publisher put in their own bar, and a reader's click would run it.
 */
export function sourceUrlProblem(value: string): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "That is not a full web address. It needs to start with https://.";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `A link in the bar has to be http or https, not ${parsed.protocol.replace(":", "")}.`;
  }
  return null;
}

/**
 * The address the button links to, or null when there is none to link.
 *
 * Null is the answer the build wants: no address means no button, rather than
 * a button that leads nowhere. There are three ways to get it -- the switch
 * is off, the typed address is one no browser should follow, or nothing was
 * typed and no repository has been named to derive one from.
 */
export function resolveSourceUrl(
  link: SourceLinkSettings | undefined,
  repo: SourceRepoRef,
): string | null {
  if (!link?.enabled) return null;

  const typed = (link.url ?? "").trim();
  if (typed) {
    if (sourceUrlProblem(typed)) return null;
    // Trailing slash off, so the title a reader hovers reads like the address
    // they would have typed.
    return typed.replace(/\/+$/, "");
  }

  const owner = (repo.owner ?? "").trim();
  const name = (repo.repo ?? "").trim();
  if (!owner || !name) return null;
  return `${githubWebHost(repo.apiBase)}/${owner}/${name}`;
}
