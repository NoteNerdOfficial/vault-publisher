import { App, Notice, Plugin, TFile, apiVersion, normalizePath } from "obsidian";
import { diagnoseRender } from "./render/diagnose";
import { createRenderHost, renderFile, RenderedNote } from "./render/renderNote";
import { findStaticHazards, probeHtml, ProbeResult } from "./render/probe";
import { probeStylesheets } from "./render/cssProbe";
import { waitForDataviewIndex } from "./render/settle";
import { countInvalidNesting } from "./publish/normalize";
import {
  buildSite,
  BuildResult,
  SiteConfig,
  isScopeChosen,
} from "./publish/buildSite";
import { formatBytes } from "./publish/drift";
import { pruneStale } from "./publish/prune";
import { DEFAULT_THEME } from "./publish/themes";
import {
  MANIFEST_PATH,
  diffAgainstManifest,
  parseManifest,
} from "./publish/incremental";
import {
  TokenState,
  describeStorage,
  describeTokenState,
  protectToken,
  revealToken,
  storageMode,
  tokenForStorage,
} from "./platform/secrets";
import { AutoRunMode, VaultPublisherSettingsTab } from "./ui/settingsTab";
import {
  findLegacyFolder,
  hasStoredSettings,
  migrateLegacySettings,
} from "./platform/migrate";
import {
  probeBackgroundThrottling,
  suspendBackgroundThrottling,
} from "./platform/backgroundThrottling";
import { GITHUB_COM_API, GitHubClient, GitHubError } from "./github/client";

/**
 * Spike plugin: renders a vault through Obsidian, builds a static site from
 * the result, and commits it to GitHub.
 *
 * `autoRun` runs one thing when the plugin loads. Its two useful settings,
 * a preview build and a publish, are in the settings panel; the rest exist
 * so the whole loop can be driven from a shell during development, by
 * writing data.json and touching the build. Obsidian offers no way to invoke
 * a command from outside, and clicking through the UI for every iteration
 * would make the measurements no one can reproduce.
 */

const INPUT_FOLDER = "spike-notes";
const OUTPUT_FOLDER = "_vault-publisher";
const PREVIEW_FOLDER = "_site-preview";

interface Settings {
  autoRun: AutoRunMode;
  /** Note the diagnose run samples, as a vault path. */
  diagnosePath?: string;
  site: SiteConfig;
  github: {
    apiBase: string;
    owner: string;
    repo: string;
    branch: string;
    token: string;
    /** Pages cannot serve a private repository on a free plan. */
    private: boolean;
  };
}

const DEFAULT_SETTINGS: Settings = {
  autoRun: "none",
  site: {
    // No site name and no scope: both have to be chosen. A placeholder name
    // would tick the first-run checklist's own box, and either possible
    // default for the scope is wrong in a way the user would not find out
    // about until after they had published. See `isScopeChosen`.
    siteName: "",
    folder: null,
    requireFrontmatterFlag: null,
    updatedProperty: "updated",
    pinnedProperty: "pinned",
    theme: DEFAULT_THEME,
  },
  github: {
    apiBase: GITHUB_COM_API,
    owner: "",
    repo: "",
    branch: "gh-pages",
    token: "",
    private: false,
  },
};

interface NoteReport {
  render: RenderedNote;
  probes: ProbeResult[];
}

export default class VaultPublisherPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;

  /**
   * Where progress goes while a build or publish runs.
   *
   * A publish renders every note in the vault and then talks to GitHub, which
   * on a large vault is long enough that silence reads as a hang. Notices
   * scroll away and cannot show a proportion, so the settings screen
   * registers a sink here and shows the steps as they happen.
   */
  progress: ((step: string, done?: number, total?: number) => void) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "run-render-spike",
      name: "Run render spike",
      callback: () => void this.runSpike(),
    });
    this.addCommand({
      id: "build-site",
      name: "Build site to preview folder",
      callback: () => void this.buildToPreview(),
    });
    this.addCommand({
      id: "publish-site",
      name: "Publish site to GitHub",
      callback: () => void this.publish(),
    });

    // Rendering before the workspace is ready gives Dataview no index to
    // query and Bases no file list, which looks like a rendering failure but
    // is really a timing one.
    this.addSettingTab(new VaultPublisherSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.runAuto();
    });
  }

  /**
   * Runs the configured autoRun mode and leaves a trace on disk either way.
   *
   * `void this.buildToPreview()` discarded the rejection, so a build that
   * threw produced exactly the same evidence as a build that never started:
   * no output folder, no report, nothing. An hour went into telling those two
   * apart in a vault whose devtools console was not readable from here. The
   * run log exists so the next failure says what it was.
   */
  private async runAuto(): Promise<void> {
    const mode = this.settings.autoRun;
    if (mode === "none") return;

    await this.appendRunLog(`start ${mode} (Obsidian ${apiVersion})`);
    const started = performance.now();
    try {
      if (mode === "spike") await this.runSpike();
      if (mode === "build") await this.buildToPreview();
      if (mode === "publish") await this.publish();
      if (mode === "diagnose") await this.diagnose();
      if (mode === "electron") await this.probeElectron();
      await this.appendRunLog(
        `done ${mode} in ${Math.round(performance.now() - started)}ms`,
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message}\n\n${error.stack ?? "(no stack)"}`
          : String(error);
      await this.appendRunLog(
        `FAILED ${mode} after ${Math.round(performance.now() - started)}ms\n\n${detail}`,
      );
      new Notice(`Vault Publisher: ${mode} failed, see ${OUTPUT_FOLDER}/run-log.md`);
    }
  }

  /** Appends to the run log, creating the output folder if it is missing. */
  private async appendRunLog(entry: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = normalizePath(`${OUTPUT_FOLDER}/run-log.md`);
    try {
      if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
      const previous = (await adapter.exists(path)) ? await adapter.read(path) : "";
      await adapter.write(
        path,
        `${previous}\n- ${new Date().toISOString()} ${entry}\n`,
      );
    } catch {
      // The log is diagnostics. Failing to write it must not replace the
      // error it was trying to record.
    }
  }

  private async loadSettings(): Promise<void> {
    let stored = (await this.loadData()) as Partial<Settings> | null;

    // Renaming the plugin changed its id, and Obsidian keys plugin data by
    // id, so a renamed plugin starts with nothing. Pull the old settings
    // across once, on a run that has none of its own.
    if (!hasStoredSettings(stored)) {
      const migrated = await migrateLegacySettings(this.app);
      if (migrated.data) {
        stored = migrated.data as Partial<Settings>;
        this.legacyFolder = migrated.staleFolder;
        new Notice(
          `Vault Publisher: brought your settings over from ${migrated.from}.`,
          6000,
        );
      }
    }

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      site: { ...DEFAULT_SETTINGS.site, ...stored?.site },
      github: { ...DEFAULT_SETTINGS.github, ...stored?.github },
    };
    // The token lives encrypted on disk and in the clear only in memory, so
    // everything downstream can use it without knowing about any of this.
    const revealed = revealToken(this.settings.github.token);
    this.settings.github.token = revealed.token;
    this.tokenState = revealed.state;
    this.sealedToken = revealed.sealed;

    // Write straight away, so the next load finds our own data and the
    // migration does not run again -- including after a deliberate reset.
    if (this.legacyFolder) await this.saveSettings();

    // Independently of whether a migration just happened: if the old folder
    // is still on disk, the settings screen should keep offering to remove
    // it, because it still contains a copy of the token.
    this.legacyFolder = this.legacyFolder ?? (await findLegacyFolder(this.app));
  }

  /** Old plugin folder left behind by a rename, if there was one. */
  legacyFolder: string | null = null;

  /** Whether the stored token could be read, so the UI can say why not. */
  tokenState: TokenState = "none";

  /**
   * The token exactly as it sits on disk.
   *
   * Held so that a save can put back what it could not read. Without this, an
   * unreadable token became an empty one on the next write.
   */
  sealedToken = "";

  /**
   * Replaces the token, from the settings screen.
   *
   * Going through here rather than assigning to `settings.github.token` is
   * what makes the preservation in `saveSettings` safe: a deliberate edit
   * drops the sealed value, so clearing the field really does clear the
   * token, while an incidental save leaves it alone.
   */
  setToken(value: string): void {
    this.settings.github.token = value;
    this.tokenState = value ? "ready" : "none";
    this.sealedToken = "";
  }

  /**
   * Deletes the folder the plugin used to live in.
   *
   * Only ever called from the settings screen, by someone who has read what
   * is in it. The folder is inside the vault's own config directory and was
   * written by an earlier version of this plugin, so this is not reaching
   * into anything that is not ours.
   */
  async removeLegacyFolder(): Promise<boolean> {
    if (!this.legacyFolder) return false;
    try {
      await this.app.vault.adapter.rmdir(this.legacyFolder, true);
      this.legacyFolder = null;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persists settings with the token encrypted.
   *
   * The in-memory settings keep the plain token, because the publish path
   * needs it on every request; only what reaches disk is protected.
   */
  async saveSettings(): Promise<void> {
    const token = tokenForStorage(
      this.settings.github.token,
      this.sealedToken,
    );

    await this.saveData({
      ...this.settings,
      github: { ...this.settings.github, token },
    });
  }

  /** Confirms the token works and says which account it belongs to. */
  async verifyToken(): Promise<string> {
    const { github } = this.settings;
    if (!github.token) throw new Error("No token set.");
    const client = new GitHubClient({
      apiBase: github.apiBase,
      token: github.token,
      owner: github.owner,
      repo: github.repo,
    });
    const viewer = await client.getViewer();
    return viewer.login;
  }

  // -- build ---------------------------------------------------------------

  private async build(): Promise<BuildResult> {
    // Chromium defers work in a window nobody is looking at, and publishing
    // is exactly when someone goes to do something else. Measured
    // backgrounded: a 50ms wait took 3,485ms. It is not only our waits that
    // suffer -- Dataview fills its cells from its own timers, so its work
    // lands late too, and no amount of care in our completion detection can
    // make another plugin's scheduler run sooner.
    //
    // So the window stops being throttled for the length of the build, and
    // is restored afterwards even if it throws.
    const restoreThrottling = suspendBackgroundThrottling();
    try {
      const result = await buildSite(this.app, this.settings.site, (done, total, path) => {
        this.progress?.(`Rendering ${path}`, done, total);
        if (done % 25 === 0) new Notice(`Rendering ${done + 1}/${total}`, 1000);
      });
      await this.writeBuildReport(result);
      return result;
    } finally {
      restoreThrottling();
    }
  }

  /**
   * Describes the scope, for a message that tells someone what to change.
   *
   * "No notes matched" sends a user looking at their vault. Naming the folder
   * and the flag that did the filtering sends them to the setting.
   */
  private describeScope(): string {
    const { folder, requireFrontmatterFlag } = this.settings.site;
    const where =
      folder === null
        ? "no folder chosen"
        : folder === ""
          ? "the whole vault"
          : `the folder "${folder}"`;
    return requireFrontmatterFlag
      ? `${where}, with "${requireFrontmatterFlag}: true" required in frontmatter`
      : where;
  }

  async buildToPreview(): Promise<void> {
    if (!isScopeChosen(this.settings.site)) {
      new Notice(
        "Vault Publisher: choose what to publish in settings first.",
        6000,
      );
      return;
    }

    new Notice("Building site...");
    const result = await this.build();

    // A preview is how someone checks a filter, so an empty one is a result
    // rather than a fault. It still has to say so: an empty preview folder
    // and a preview that was never written look identical on disk.
    if (result.selectedCount === 0) {
      new Notice(
        `Vault Publisher: no notes matched (${this.describeScope()}).`,
        8000,
      );
    }

    const adapter = this.app.vault.adapter;
    const written = new Set<string>();
    for (const file of result.files) {
      const target = normalizePath(`${PREVIEW_FOLDER}/${file.path}`);
      const dir = target.slice(0, target.lastIndexOf("/"));
      if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      if (typeof file.content === "string") {
        await adapter.write(target, file.content);
      } else {
        await adapter.writeBinary(target, file.content);
      }
      written.add(target);
    }

    // What the build stopped producing has to go, or a renamed note leaves a
    // page behind that the next build serves with a current stylesheet.
    const pruned = await pruneStale(adapter, PREVIEW_FOLDER, written);
    for (const failure of pruned.failed) {
      console.warn(`vault-publisher: could not remove ${failure.path}: ${failure.reason}`);
    }

    const removed = pruned.removed.length
      ? `, removed ${pruned.removed.length} stale ${pruned.removed.length === 1 ? "file" : "files"}`
      : "";
    new Notice(
      `Built ${result.pages.length} pages in ${Math.round(result.totalMs)}ms${removed} -> ${PREVIEW_FOLDER}/`,
    );
  }

  /** Reports which Electron paths exist. Reads only; changes nothing. */
  private async probeElectron(): Promise<void> {
    const probe = probeBackgroundThrottling();
    const lines = [
      "# Background throttling probe",
      "",
      `Run: ${new Date().toISOString()}`,
      `Obsidian ${apiVersion}, Electron ${probe.electronVersion ?? "unknown"}`,
      "",
      `**setBackgroundThrottling reachable: ${probe.reachable ? "YES" : "NO"}**`,
      `**token storage: ${storageMode()}** -- ${describeStorage()}`,
      "",
      ...(() => {
        // Round-trip a throwaway value: "the API exists" and "the API works
        // on this machine" are different claims, and only the second one
        // justifies telling a user their token is encrypted.
        const sample = "vault-publisher-probe-" + Date.now();
        const sealed = protectToken(sample);
        const opened = revealToken(sealed);
        return [
          `Round trip: ${opened.token === sample ? "OK" : `FAILED (${opened.state})`}`,
          `Stored form: \`${sealed.slice(0, 24)}${sealed.length > 24 ? "…" : ""}\``,
          "",
        ];
      })(),
      "| path | available | detail |",
      "|---|---|---|",
      ...probe.findings.map(
        (f) => `| \`${f.path}\` | ${f.available ? "yes" : "no"} | ${f.detail.replace(/\|/g, "\\|")} |`,
      ),
    ];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/electron-probe.md`),
      lines.join("\n"),
    );
    new Notice(`Electron probe: throttling API ${probe.reachable ? "reachable" : "not reachable"}`);
  }

  // -- diagnose ------------------------------------------------------------

  private async diagnose(): Promise<void> {
    const path = this.settings.diagnosePath ?? "spike-notes/02-dataview-table.md";
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Vault Publisher: no note at ${path}`);
      return;
    }

    await waitForDataviewIndex(this.app as never);
    new Notice(`Diagnosing ${path}...`);
    const result = await diagnoseRender(this.app, file);

    const lines = [
      "# Render timeline",
      "",
      `Note: ${result.path}`,
      `Run: ${new Date().toISOString()}`,
      `Attempts: ${result.runs.length}`,
      "",
      "## Summary",
      "",
      "| attempt | render ms | complete at | never completed |",
      "|---|---|---|---|",
      ...result.runs.map(
        (r) =>
          `| ${r.attempt} | ${Math.round(r.renderMs)} | ${r.completeAtMs === null ? "-" : r.completeAtMs + "ms"} | ${r.completeAtMs === null ? "**yes**" : "no"} |`,
      ),
      "",
    ];

    for (const run of result.runs) {
      lines.push(`## Attempt ${run.attempt}`, "");
      lines.push(
        "| at ms | complete | blocked by | pending | empty spans | text | mutations |",
      );
      lines.push("|---|---|---|---|---|---|---|");
      for (const s of run.samples) {
        lines.push(
          `| ${s.atMs} | ${s.complete ? "yes" : "no"} | ${s.reason ?? "-"} | ${s.pending} | ${s.emptySpans} | ${s.textLength} | ${s.mutationsSoFar} |`,
        );
      }
      lines.push("");
    }

    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/diagnose.md`),
      lines.join("\n"),
    );
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/diagnose-final.html`),
      result.finalHtml,
    );
    new Notice(`Diagnose written to ${OUTPUT_FOLDER}/diagnose.md`);
  }

  // -- publish -------------------------------------------------------------

  async publish(): Promise<void> {
    const { github } = this.settings;
    // Said separately from the generic gate below: "your token is there but
    // unreadable" calls for restarting Obsidian, not for pasting a new token,
    // and the two were previously reported as the same thing.
    if (!github.token && this.tokenState !== "none") {
      new Notice(
        `Vault Publisher: ${describeTokenState(this.tokenState) ?? "token unavailable"}`,
        12000,
      );
      return;
    }
    if (!github.token || !github.owner || !github.repo) {
      new Notice("Vault Publisher: set the repository and token in settings first");
      return;
    }
    if (!isScopeChosen(this.settings.site)) {
      new Notice(
        "Vault Publisher: choose what to publish in settings first.",
        6000,
      );
      return;
    }

    const client = new GitHubClient({
      apiBase: github.apiBase,
      token: github.token,
      owner: github.owner,
      repo: github.repo,
    });

    const log: string[] = [];
    const say = (line: string) => {
      log.push(line);
      this.progress?.(line);
      new Notice(`Vault Publisher: ${line}`, 3000);
    };

    try {
      const viewer = await client.getViewer();
      say(`authenticated as ${viewer.login}`);

      let repo = await client.getRepo();
      if (!repo) {
        repo = await client.createRepo({
          private: github.private,
          description: "Published from Obsidian by vault-publisher.",
        });
        say(`created ${repo.full_name}`);
      } else {
        say(`using ${repo.full_name}`);
      }

      // A publish makes a handful of requests plus one blob per changed
      // binary, so a few hundred left is fine and a few dozen is not. Said
      // before the work starts, because failing half way through leaves the
      // branch committed and Pages rebuilding.
      const remaining = client.rateRemaining;
      if (remaining !== null && remaining < 100) {
        say(`WARNING: only ${remaining} GitHub API requests left this hour`);
      }

      const result = await this.build();
      say(`built ${result.pages.length} pages, ${result.files.length} files`);

      // Before anything else is checked. A publish sends a complete tree, so
      // committing a build that selected nothing does not publish an empty
      // site -- it replaces a live one with an empty site. The likeliest
      // cause is a folder that does not exist, which is a typo away.
      if (result.selectedCount === 0) {
        say(`ABORTED: no notes matched (${this.describeScope()})`);
        await this.writePublishLog(log);
        return;
      }

      // Said here as well as in the build report: a note or an attachment
      // that did not make it is exactly the thing someone needs to be told
      // without going looking.
      for (const skip of result.skipped) {
        say(`SKIPPED ${skip.path}: ${skip.reason}`);
      }

      // Every one of these means the built site differs from what Obsidian
      // shows, which is the one promise this plugin exists to keep.
      const privacyNotes = new Set(
        result.privacyLeaks.map((leak) => leak.sourcePath),
      );
      if (privacyNotes.size) {
        say(
          `WARNING: ${privacyNotes.size} unpublished note(s) appear on published pages, see the build report`,
        );
      }

      if (this.settings.site.failOnPrivacyLeak && privacyNotes.size) {
        say(`ABORTED: refusing to publish with ${privacyNotes.size} unpublished note(s) exposed`);
        await this.writePublishLog(log);
        return;
      }

      // Always reported, whether or not it stops the publish. A shortened
      // Bases view is the quietest way this can be wrong: the table looks
      // perfectly well-formed and is simply missing rows. The page now says
      // so itself, so this is the operator's copy of the same fact.
      if (result.basesTruncated.length) {
        say(
          `${result.basesTruncated.length} bases view(s) published shortened, see the build report`,
        );
        for (const view of result.basesTruncated) say(`  shortened: ${view}`);
      }

      if (this.settings.site.failOnTruncatedBase && result.basesTruncated.length) {
        say(
          `ABORTED: refusing to publish with ${result.basesTruncated.length} shortened bases view(s)`,
        );
        await this.writePublishLog(log);
        return;
      }

      if (
        result.invalidNesting > 0 ||
        result.incompletePages > 0 ||
        result.loadingPlaceholders > 0
      ) {
        say(
          `ABORTED: ${result.invalidNesting} blocks would break on reparse, ${result.incompletePages} pages serialized incomplete, ${result.loadingPlaceholders} blocks still loading`,
        );
        await this.writePublishLog(log);
        return;
      }

      // Incremental: compare the rendered bytes against what was published
      // last time, and point unchanged entries at blobs the branch already
      // holds. The tree stays complete, so deletions still need no
      // bookkeeping; only the upload shrinks.
      // The tip the incremental diff is about to be computed against. A
      // publish sends a complete tree, so if the branch moves between these
      // reads and the commit below, our tree silently reverts whatever landed
      // in between -- another device, a second window, a direct edit on
      // GitHub. Captured first, checked at the commit.
      const baseSha = await client.getRef(github.branch);

      const [previousRaw, existingBlobs] = await Promise.all([
        client.readFile(github.branch, MANIFEST_PATH),
        client.getTreeBlobs(github.branch),
      ]);
      const previous = parseManifest(previousRaw);
      const diff = diffAgainstManifest(result.files, previous, existingBlobs);

      const files = [
        ...result.files,
        {
          path: MANIFEST_PATH,
          content: JSON.stringify(diff.next, null, 0),
        },
      ];

      if (previousRaw) {
        say(
          `${diff.changed.length} changed, ${diff.unchanged} unchanged` +
            (diff.removed.length ? `, ${diff.removed.length} removed` : ""),
        );
      }
      if (diff.changed.length === 0 && diff.removed.length === 0 && previousRaw) {
        say("nothing to publish: the site is already up to date");
        await this.writePublishLog(log);
        return;
      }

      const commit = await client.commitFiles({
        branch: github.branch,
        message: `Publish ${result.pages.length} pages from Obsidian`,
        files,
        expectedHeadSha: baseSha,
      });
      say(`committed ${commit.commitSha.slice(0, 7)} to ${github.branch}`);

      const pages = await client.enablePages(github.branch);
      say(`pages: ${pages.html_url ?? pages.url} (${pages.status ?? "building"})`);

      log.push(`\nSite URL: ${pages.html_url ?? "(see repo settings)"}`);
    } catch (e) {
      // The one failure with a specific remedy: nothing was committed, and
      // publishing again rebuilds against what is now on the branch.
      if (e instanceof GitHubError && e.status === 409) {
        say("ABORTED: the branch moved while this publish was being prepared");
        say("nothing was committed -- publish again to rebuild against it");
        await this.writePublishLog(log);
        return;
      }
      const message =
        e instanceof GitHubError
          ? `${e.message} [status ${e.status}]`
          : e instanceof Error
            ? e.message
            : String(e);
      log.push(`FAILED: ${message}`);
      new Notice(`Vault Publisher failed: ${message}`, 8000);
    }

    await this.writePublishLog(log);
  }

  private async writePublishLog(log: string[]): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/publish-log.md`),
      ["# Publish log", "", `Run: ${new Date().toISOString()}`, "", ...log.map((l) => `- ${l}`)].join(
        "\n",
      ),
    );
  }

  private async writeBuildReport(result: BuildResult): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);

    const lines: string[] = ["# Build report", ""];
    lines.push(`Run: ${new Date().toISOString()}`);
    lines.push(`Pages: ${result.pages.length}, files: ${result.files.length}`);
    lines.push(`Total: ${Math.round(result.totalMs)}ms`);
    lines.push(`Blocks that would break on reparse: ${result.invalidNesting}`);
    lines.push(`Pages serialized incomplete: ${result.incompletePages}`);
    lines.push(`Blocks still showing a loading placeholder: ${result.loadingPlaceholders}`);
    lines.push(
      `Media files: ${result.assetsPublished} (${Math.round(result.assetBytes / 1024)} KB)` +
        (result.assetsUnresolved.length
          ? `, ${result.assetsUnresolved.length} unresolved`
          : ""),
    );
    lines.push("");

    lines.push(
      "| Page | url | render ms | total ms | pending | incomplete | guarded | errored | unresolved links |",
    );
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const p of result.pages) {
      lines.push(
        `| ${p.title} | ${p.url} | ${Math.round(p.renderMs)} | ${Math.round(p.totalMs)} | ${p.pending} | ${p.incomplete} | ${p.guarded} | ${p.errored} | ${p.unresolvedTargets.join(", ")} |`,
      );
    }

    const reasons = new Map<string, { n: number; ms: number }>();
    for (const page of result.pages) {
      const row = reasons.get(page.settleReason) ?? { n: 0, ms: 0 };
      row.n++;
      row.ms += page.totalMs;
      reasons.set(page.settleReason, row);
    }
    if (reasons.size) {
      lines.push("", "## How notes finished", "");
      lines.push("| reason | notes | total s | mean ms |");
      lines.push("|---|---|---|---|");
      for (const [reason, row] of [...reasons].sort((a, b) => b[1].ms - a[1].ms)) {
        lines.push(
          `| ${reason} | ${row.n} | ${(row.ms / 1000).toFixed(1)} | ${Math.round(row.ms / row.n)} |`,
        );
      }
      lines.push(
        "",
        "`fast-path` and `content-complete` finish from the content. `quiet` and",
        "`timeout` finish from a clock, and a hidden window clamps clocks to one",
        "wake-up a minute, so those two are where a backgrounded build loses time.",
      );
    }

    const drift = result.drift;
    if (drift && drift.ratio !== null) {
      lines.push("", "## Drift", "");
      lines.push(
        `Control notes: ${drift.samples.length} (identical, no async content)`,
      );
      lines.push(`First third: ${Math.round(drift.firstMs ?? 0)}ms mean render`);
      lines.push(`Last third:  ${Math.round(drift.lastMs ?? 0)}ms mean render`);
      lines.push(`Ratio: ${drift.ratio.toFixed(2)}x`);
      if (drift.heapGrowthBytes !== null) {
        lines.push(`Heap growth: ${formatBytes(drift.heapGrowthBytes)}`);
      }
      lines.push(
        drift.degraded
          ? "\n**DEGRADED.** The build slowed as it ran, so every other timing here is suspect."
          : "\nStable. Render time did not drift materially across the build.",
      );
      lines.push("", "| # | control | render ms | heap |");
      lines.push("|---|---|---|---|");
      for (const s of drift.samples) {
        lines.push(
          `| ${s.index} | ${s.path.split("/").pop()} | ${Math.round(s.renderMs)} | ${s.heapBytes === null ? "-" : formatBytes(s.heapBytes)} |`,
        );
      }
    }

    if (result.privacyLeaks.length) {
      const byNote = new Map<string, { kinds: Set<string>; pages: Set<string> }>();
      for (const leak of result.privacyLeaks) {
        const row = byNote.get(leak.sourcePath) ?? { kinds: new Set(), pages: new Set() };
        row.kinds.add(leak.kind);
        row.pages.add(leak.page);
        byNote.set(leak.sourcePath, row);
      }
      lines.push("", "## Privacy", "");
      lines.push(
        `**${byNote.size} unpublished note(s) appear on published pages.**`,
        "",
        "A query inside a published note reaches the whole vault, so it can print",
        "the name or fields of a note that is not itself published.",
        "",
        "| unpublished note | appears as | on pages |",
        "|---|---|---|",
      );
      for (const [note, row] of byNote) {
        lines.push(
          `| ${note} | ${Array.from(row.kinds).join(", ")} | ${Array.from(row.pages).slice(0, 4).join(", ")}${row.pages.size > 4 ? ` +${row.pages.size - 4}` : ""} |`,
        );
      }
    }

    const basesPages = result.pages.filter((p) => p.bases.views > 0);
    if (basesPages.length) {
      lines.push("", "## Bases", "");
      lines.push(
        "| Page | views | tables | cards | rows | input values recovered | measurement rows dropped | unhandled |",
      );
      lines.push("|---|---|---|---|---|---|---|---|");
      for (const p of basesPages) {
        const b = p.bases;
        lines.push(
          `| ${p.title} | ${b.views} | ${b.tables} | ${b.cards} | ${b.rows} | ${b.inputValues} | ${b.measurementDropped} | ${b.unhandled.join(", ") || "-"} |`,
        );
      }
      if (result.basesTruncated.length) {
        lines.push("", "Truncated views (emitted/total):", "");
        for (const v of result.basesTruncated) lines.push(`- ${v}`);
      }
    }

    if (result.skipped.length) {
      lines.push("", "## Skipped", "");
      for (const s of result.skipped) lines.push(`- ${s.path}: ${s.reason}`);
    }

    await adapter.write(normalizePath(`${OUTPUT_FOLDER}/build-report.md`), lines.join("\n"));
  }

  // -- render spike --------------------------------------------------------

  private async runSpike(): Promise<void> {
    const app = this.app as App & { plugins?: { plugins?: Record<string, unknown> } };
    const started = performance.now();

    new Notice("Vault Publisher: starting");

    const dataviewReady = await waitForDataviewIndex(app as never);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${INPUT_FOLDER}/`))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (!files.length) {
      new Notice(`Vault Publisher: no notes under ${INPUT_FOLDER}/`);
      return;
    }

    const host = createRenderHost();
    const reports: NoteReport[] = [];

    try {
      for (const file of files) {
        const render = await renderFile(this.app, file, host);
        reports.push({ render, probes: probeHtml(render.html) });
      }
    } finally {
      host.remove();
    }

    const css = probeStylesheets();
    const elapsed = performance.now() - started;

    await this.writeOutput(reports, {
      dataviewReady,
      css,
      elapsedMs: elapsed,
      pluginIds: Object.keys(app.plugins?.plugins ?? {}),
      obsidianVersion: apiVersion,
    });

    new Notice(
      `Vault Publisher: ${reports.length} notes in ${Math.round(elapsed)}ms. See ${OUTPUT_FOLDER}/report.md`,
    );
  }

  private async writeOutput(
    reports: NoteReport[],
    meta: {
      dataviewReady: boolean;
      css: ReturnType<typeof probeStylesheets>;
      elapsedMs: number;
      pluginIds: string[];
      obsidianVersion: string;
    },
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = normalizePath(OUTPUT_FOLDER);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);

    for (const { render } of reports) {
      const name = render.path.replace(/[\/\\]/g, "__").replace(/\.md$/, "");
      await adapter.write(normalizePath(`${dir}/${name}.html`), render.html);
    }

    await adapter.write(normalizePath(`${dir}/report.md`), buildReport(reports, meta));
    await adapter.write(
      normalizePath(`${dir}/report.json`),
      JSON.stringify({ meta, reports }, null, 2),
    );
  }
}

function verdictMark(v: ProbeResult["verdict"]): string {
  const marks: Record<string, string> = {
    ok: "OK",
    partial: "PARTIAL",
    empty: "EMPTY",
    error: "ERROR",
    blocked: "BLOCKED",
  };
  return marks[v] ?? "-";
}

function buildReport(
  reports: NoteReport[],
  meta: {
    dataviewReady: boolean;
    css: ReturnType<typeof probeStylesheets>;
    elapsedMs: number;
    pluginIds: string[];
    obsidianVersion: string;
  },
): string {
  const lines: string[] = [];
  lines.push("# Render spike report", "");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Obsidian API version: ${meta.obsidianVersion}`);
  lines.push(`Dataview index ready before rendering: ${meta.dataviewReady}`);
  lines.push(`Enabled plugins: ${meta.pluginIds.join(", ") || "(none)"}`);
  lines.push(`Total time: ${Math.round(meta.elapsedMs)}ms for ${reports.length} notes`);
  lines.push("");

  lines.push("## Per note", "");
  lines.push(
    "| Note | total ms | render | settle | assets | normalize | serialize | mutations | skipped wait | <p> fixed | still invalid |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { render } of reports) {
    const r = (n: number) => Math.round(n);
    lines.push(
      `| ${render.path} | ${r(render.totalMs)} | ${r(render.renderMs)} | ${r(render.settle.elapsedMs - render.settle.assetMs)} | ${r(render.settle.assetMs)} | ${r(render.normalizeMs)} | ${r(render.serializeMs)} | ${render.settle.mutations} | ${render.settle.skipped} | ${render.normalize.paragraphsRewritten} | ${render.normalize.remaining} |`,
    );
  }
  lines.push("");

  const errored = reports.filter((r) => r.render.error);
  if (errored.length) {
    lines.push("### Render errors", "");
    for (const { render } of errored) {
      lines.push(`- ${render.path}: ${render.error?.split("\n")[0]}`);
    }
    lines.push("");
  }

  lines.push("## Feature probes", "");
  const featureIds = Array.from(
    new Set(reports.flatMap((r) => r.probes.map((p) => p.id))),
  );
  lines.push(`| Note | ${featureIds.join(" | ")} |`);
  lines.push(`|---|${featureIds.map(() => "---").join("|")}|`);
  for (const { render, probes } of reports) {
    const cells = featureIds.map((id) => {
      const p = probes.find((x) => x.id === id);
      if (!p || p.verdict === "missing") return "-";
      const detail = Object.entries(p.breakdown)
        .map(([v, n]) => `${n} ${v}`)
        .join(", ");
      return `${verdictMark(p.verdict)} (${detail})`;
    });
    lines.push(`| ${render.path} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const problems = reports.flatMap(({ render, probes }) =>
    probes
      .filter((p) => p.verdict !== "ok" && p.verdict !== "missing")
      .map((p) => `- ${render.path} / ${p.id}: ${p.verdict} - ${p.note}`),
  );
  if (problems.length) {
    lines.push("### Problems", "", ...problems, "");
  }

  lines.push("## Static hazards", "");
  lines.push(
    "| Note | inline handlers | css vars | app:// urls | controls | data-* | embeds emptied by reparse |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const { render } of reports) {
    const h = findStaticHazards(render.html);
    lines.push(
      `| ${render.path} | ${h.inlineHandlers} | ${h.cssVarReferences} | ${h.appUrls} | ${h.interactiveControls} | ${h.rehydrationHooks} | ${countInvalidNesting(render.html)} |`,
    );
  }
  lines.push("");

  lines.push("## Stylesheets", "");
  lines.push(
    `${meta.css.readableSheets} of ${meta.css.totalSheets} sheets readable, ${meta.css.totalRules} rules total.`,
    "",
  );
  lines.push("| Origin | Source | Rules | Error |");
  lines.push("|---|---|---|---|");
  for (const s of meta.css.sheets) {
    lines.push(
      `| ${s.origin} | ${s.source.slice(0, 80)} | ${s.rules ?? "-"} | ${s.error ?? ""} |`,
    );
  }

  return lines.join("\n");
}
