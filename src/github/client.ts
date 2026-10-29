import { requestUrl, RequestUrlResponse } from "obsidian";
import { encodeUrlPath } from "../publish/urls";

/**
 * Pushing a built site to GitHub without git, and without Actions.
 *
 * Three constraints drove this.
 *
 * Corporate networks often block GitHub Actions, and a build that runs in CI
 * is useless to us anyway: only a running Obsidian can render Dataview. So we
 * commit the *built* site and let Pages serve the branch directly, which
 * needs no workflow file and no `workflow` token scope.
 *
 * There is no git binary to rely on either -- Obsidian ships none, and a
 * corporate machine may not have one. The Git Data API covers it: blobs, a
 * tree, a commit, one ref update. That also makes a publish atomic, which
 * matters for a shared team repo where two people might publish at once.
 *
 * And requests go through Obsidian's `requestUrl` rather than `fetch`, since
 * that bypasses the renderer's CORS rules and honours system proxy settings.
 */

/** Blob mode for a regular file. Git's other modes are not needed here. */
const FILE_MODE = "100644";

export interface GitHubConfig {
  /** Host API root. Non-default values are what support GitHub Enterprise
   * Server, e.g. https://github.acme.com/api/v3 */
  apiBase: string;
  token: string;
  owner: string;
  repo: string;
}

export const GITHUB_COM_API = "https://api.github.com";

/** A file to publish. Text goes inline into the tree; binary needs a blob. */
export interface PublishFile {
  /** Path within the repository, with no leading slash. */
  path: string;
  content: string | ArrayBuffer;
  /**
   * Blob already in the repository holding exactly this content.
   *
   * When set, the tree entry points at it and the bytes are not sent again.
   * The tree stays complete either way, so a file simply absent from it is
   * still deleted; only the upload is skipped, never the entry.
   */
  existingSha?: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    /** Remaining core rate limit, when the response reported one. */
    readonly rateRemaining: number | null = null,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHubClient {
  constructor(private readonly config: GitHubConfig) {}

  private lastRateRemaining: number | null = null;

  /**
   * Requests left in the hour, as of the last response, or null if this host
   * does not report it. Read after the preflight calls so a publish can warn
   * before it starts uploading rather than fail part way through.
   */
  get rateRemaining(): number | null {
    return this.lastRateRemaining;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith("https://")
      ? path
      : `${this.config.apiBase}${path}`;

    let response: RequestUrlResponse;
    try {
      response = await requestUrl({
        url,
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          // Without these a second publish fails with "Update is not a fast
          // forward". GitHub serves refs with an ETag, the HTTP stack
          // answers the next read from cache, and the branch tip we commit
          // against is the one from *before* the previous publish moved it.
          // Measured: two publishes sixteen seconds apart, the second
          // rejected. A stale read here is not a slow cache, it is a wrong
          // parent commit.
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          "If-None-Match": "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // We handle non-2xx ourselves so the error carries GitHub's own
        // message, which is far more useful than a generic status failure.
        throw: false,
      });
    } catch (e) {
      // A genuine transport failure: offline, DNS, TLS interception, a proxy
      // refusing the connection. Worth distinguishing from an API rejection.
      throw new GitHubError(
        `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
        0,
        null,
      );
    }

    const rateRemaining = parseRate(response.headers);
    // Every response carries this, and until now it was read and thrown away
    // unless the request failed -- so a publish could not warn before it ran
    // out, only explain afterwards.
    if (rateRemaining !== null) this.lastRateRemaining = rateRemaining;

    if (response.status >= 400) {
      const apiMessage =
        (response.json as { message?: string } | undefined)?.message ??
        `HTTP ${response.status}`;
      // A 403 with nothing left in the quota is a rate limit, not a
      // permissions problem, and GitHub's own message says "rate limit
      // exceeded" only sometimes. Saying when it refills is the useful part.
      const exhausted =
        rateRemaining === 0 &&
        (response.status === 403 || response.status === 429);
      const reset = exhausted ? parseRateReset(response.headers) : null;
      const message = exhausted
        ? `GitHub API rate limit reached${reset ? `, refills at ${reset}` : ""}. Nothing was committed.`
        : `${method} ${path} failed: ${apiMessage}`;
      throw new GitHubError(message, response.status, response.json ?? response.text, rateRemaining);
    }

    return response.json as T;
  }

  // -- repository and Pages setup ------------------------------------------

  async getRepo(): Promise<RepoInfo | null> {
    try {
      return await this.request<RepoInfo>(
        "GET",
        `/repos/${this.config.owner}/${this.config.repo}`,
      );
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Creates the repository under the authenticated user. `autoInit` gives it
   * a first commit, which matters because an empty repository has no ref for
   * a commit to descend from.
   */
  async createRepo(options: {
    private: boolean;
    description?: string;
  }): Promise<RepoInfo> {
    return this.request<RepoInfo>("POST", "/user/repos", {
      name: this.config.repo,
      private: options.private,
      description: options.description,
      auto_init: true,
    });
  }

  /**
   * Points Pages at a branch. This is the step that replaces a deploy
   * workflow: GitHub serves the committed files as they are.
   */
  async enablePages(branch: string, path: "/" | "/docs" = "/"): Promise<PagesInfo> {
    try {
      return await this.request<PagesInfo>(
        "POST",
        `/repos/${this.config.owner}/${this.config.repo}/pages`,
        { source: { branch, path } },
      );
    } catch (e) {
      // 409 means Pages is already on, which is success for our purposes.
      if (e instanceof GitHubError && e.status === 409) return this.getPages();
      throw e;
    }
  }

  async getPages(): Promise<PagesInfo> {
    return this.request<PagesInfo>(
      "GET",
      `/repos/${this.config.owner}/${this.config.repo}/pages`,
    );
  }

  // -- the commit itself ---------------------------------------------------

  async getRef(branch: string): Promise<string | null> {
    try {
      const ref = await this.request<{ object: { sha: string } }>(
        "GET",
        `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${branch}`,
      );
      return ref.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** Uploads one binary file and returns its blob SHA. */
  private async createBlob(content: ArrayBuffer): Promise<string> {
    const blob = await this.request<{ sha: string }>(
      "POST",
      `/repos/${this.config.owner}/${this.config.repo}/git/blobs`,
      { content: arrayBufferToBase64(content), encoding: "base64" },
    );
    return blob.sha;
  }

  /**
   * Commits `files` as the complete contents of `branch`.
   *
   * The tree is built from scratch rather than on top of the previous one, so
   * a note deleted in the vault disappears from the site without us tracking
   * deletions separately. Text files travel inline in the tree request, which
   * lets GitHub create their blobs server side -- one request for the whole
   * site instead of one per file. Only binary files need a blob upload first,
   * because a tree's inline content must be UTF-8.
   */
  async commitFiles(options: {
    branch: string;
    message: string;
    files: PublishFile[];
    /** Ref the new commit must descend from; a mismatch means someone else
     * published in the meantime. Omit to descend from the branch's current
     * tip. */
    expectedHeadSha?: string | null;
  }): Promise<CommitResult> {
    const { branch, message, files } = options;
    const base = `/repos/${this.config.owner}/${this.config.repo}`;

    const headSha = await this.getRef(branch);
    if (
      options.expectedHeadSha !== undefined &&
      options.expectedHeadSha !== headSha
    ) {
      throw new GitHubError(
        `${branch} moved since this publish was prepared (expected ${options.expectedHeadSha ?? "no branch"}, found ${headSha ?? "no branch"}). Someone else may have published.`,
        409,
        null,
      );
    }

    const tree: TreeEntry[] = [];
    for (const file of files) {
      if (file.existingSha) {
        tree.push({
          path: file.path,
          mode: FILE_MODE,
          type: "blob",
          sha: file.existingSha,
        });
      } else if (typeof file.content === "string") {
        tree.push({
          path: file.path,
          mode: FILE_MODE,
          type: "blob",
          content: file.content,
        });
      } else {
        tree.push({
          path: file.path,
          mode: FILE_MODE,
          type: "blob",
          sha: await this.createBlob(file.content),
        });
      }
    }

    const created = await this.request<{ sha: string }>("POST", `${base}/git/trees`, {
      tree,
    });

    const commit = await this.request<{ sha: string }>("POST", `${base}/git/commits`, {
      message,
      tree: created.sha,
      parents: headSha ? [headSha] : [],
    });

    if (headSha) {
      await this.request("PATCH", `${base}/git/refs/heads/${branch}`, {
        sha: commit.sha,
        // No force: a rejection here means a concurrent publish, which the
        // caller should surface rather than overwrite.
        force: false,
      });
    } else {
      await this.request("POST", `${base}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
    }

    return { commitSha: commit.sha, treeSha: created.sha, previousSha: headSha };
  }

  /** The authenticated user, used to confirm the token and fill in the owner. */
  /**
   * Every file on a branch, as path to blob sha.
   *
   * Used to point a tree entry at bytes the repository already has instead of
   * uploading them again. Returns an empty map for a branch that does not
   * exist yet, which is the first publish.
   */
  async getTreeBlobs(branch: string): Promise<Map<string, string>> {
    const base = `/repos/${this.config.owner}/${this.config.repo}`;
    const head = await this.getRef(branch);
    if (!head) return new Map();

    try {
      const commit = await this.request<{ tree: { sha: string } }>(
        "GET",
        `${base}/git/commits/${head}`,
      );
      const tree = await this.request<{
        tree: { path: string; type: string; sha: string }[];
        truncated?: boolean;
      }>("GET", `${base}/git/trees/${commit.tree.sha}?recursive=1`);

      // A truncated listing is missing entries, and a missing entry only
      // means that file gets uploaded again. Correct, just less thrifty.
      const blobs = new Map<string, string>();
      for (const entry of tree.tree) {
        if (entry.type === "blob") blobs.set(entry.path, entry.sha);
      }
      return blobs;
    } catch {
      // Losing this costs bandwidth, never correctness: without it every
      // file is simply sent in full.
      return new Map();
    }
  }

  /** Reads one file from a branch, or null when it is not there. */
  async readFile(branch: string, path: string): Promise<string | null> {
    const base = `/repos/${this.config.owner}/${this.config.repo}`;
    try {
      const response = await this.request<{ content?: string; encoding?: string }>(
        "GET",
        // Per segment, not encodeURI: that leaves "%", "#" and "?" alone, so a
        // note called "50% done" produced a malformed request URL.
        `${base}/contents/${encodeUrlPath(path)}?ref=${encodeURIComponent(branch)}`,
      );
      if (!response.content) return null;
      const cleaned = response.content.replace(/\n/g, "");
      return decodeURIComponent(escape(atob(cleaned)));
    } catch {
      return null;
    }
  }

  async getViewer(): Promise<{ login: string }> {
    return this.request<{ login: string }>("GET", "/user");
  }

  // -- issues --------------------------------------------------------------

  /**
   * Files one issue and returns it.
   *
   * A label the repository does not have yet is created by GitHub as part of
   * this call, which is what lets a priority label work with no setup step
   * first. A request refused outright over its labels is retried once without
   * them: an issue with no labels is worth a great deal more than no issue,
   * and the caller has a comment in front of someone waiting on it.
   */
  async createIssue(options: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<IssueInfo> {
    const path = `/repos/${this.config.owner}/${this.config.repo}/issues`;
    const labels = options.labels?.length ? options.labels : undefined;
    const base = { title: options.title, body: options.body };

    try {
      return await this.request<IssueInfo>("POST", path, { ...base, labels });
    } catch (e) {
      if (!labels || !(e instanceof GitHubError) || e.status !== 422) throw e;
      return this.request<IssueInfo>("POST", path, base);
    }
  }
}

export interface CommitResult {
  commitSha: string;
  treeSha: string;
  previousSha: string | null;
}

export interface IssueInfo {
  number: number;
  html_url: string;
  title: string;
}

export interface RepoInfo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface PagesInfo {
  url: string;
  status: string | null;
  html_url?: string;
  cname?: string | null;
}

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob";
  content?: string;
  sha?: string;
}

function parseNumericHeader(
  headers: Record<string, string>,
  name: string,
): number | null {
  // Header casing varies between GitHub.com and Enterprise Server.
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function parseRate(headers: Record<string, string>): number | null {
  return parseNumericHeader(headers, "x-ratelimit-remaining");
}

/** When the quota refills, as a local time, or null if the header is absent. */
function parseRateReset(headers: Record<string, string>): string | null {
  const seconds = parseNumericHeader(headers, "x-ratelimit-reset");
  if (seconds === null) return null;
  return new Date(seconds * 1000).toLocaleTimeString();
}

/**
 * Chunked so a large attachment cannot blow the argument limit of
 * String.fromCharCode, which a spread of a multi-megabyte array would.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
