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
import { openExternal } from "./platform/openExternal";
import { AutoRunMode, VaultPublisherSettingsTab } from "./ui/settingsTab";
import {
  ReviewImportError,
  parseExport,
  reviewNote,
  reviewNoteName,
  splitReviewInputs,
} from "./overlay/importReview";
import { OverlayComment, OverlayExport, OverlayExternalIssue } from "./overlay/types";
import {
  RelayOutcome,
  ReviewServer,
  ReviewServerAddress,
  ReviewStore,
} from "./overlay/server";
import {
  DEFAULT_JIRA_ISSUE_TYPE,
  DEFAULT_RELAY_LABELS,
  IssueDraft,
  IssueRef,
  IssueState,
  JIRA_CREDENTIAL_NAME,
  JiraAuth,
  RelayProvider,
  RelayTarget,
  SyncResults,
  TRACKER_NAME,
  applyExternals,
  applySync,
  asanaState,
  closableComments,
  externalFor,
  filedComments,
  githubState,
  issueDraft,
  issueKey,
  issueRef,
  jiraDescription,
  jiraSite,
  jiraState,
  pendingComments,
  resolveTarget,
  withdrawnIssues,
  toMarkdown,
  toText,
} from "./overlay/relay";
import { AsanaClient } from "./tracker/asana";
import { JiraClient } from "./tracker/jira";
import { FiledIssue, TrackerError } from "./tracker/request";
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
/**
 * The live comments file, inside the review folder.
 *
 * Distinct from the `*.json` someone may still drop there by hand: this one
 * is written continuously by the review server and must never be renamed out
 * from under it, which is why `importReview` treats it separately.
 */
const LIVE_COMMENTS = "comments.json";

interface Settings {
  autoRun: AutoRunMode;
  /** Note the diagnose run samples, as a vault path. */
  diagnosePath?: string;
  site: SiteConfig;
  /**
   * The review overlay.
   *
   * Deliberately not inside `site`. `publish()` hands `settings.site`
   * straight to `buildSite`, so a flag living there could reach a published
   * page the moment anyone set it; a flag living here cannot, because the
   * only code that turns it into a `SiteConfig` field is `buildToPreview`.
   * The structure is the guarantee, not the care of whoever edits this next.
   */
  commentOverlay: {
    enabled: boolean;
    /** Prefills the comment author in the overlay. */
    reviewer: string;
    /** Vault folder the review file is saved in, and imported from. */
    reviewFolder: string;
  };
  /**
   * Filing a review comment as an issue in a tracker.
   *
   * Off unless somebody turns it on, and that is the whole of the design: a
   * `provider` of "none" means no command does anything, no action appears in
   * the overlay, and no request is ever made. A review that stays in the
   * vault is the normal case and should cost nothing.
   */
  relay: {
    provider: RelayProvider;
    /**
     * Whether the review and the tracker are kept in step on their own.
     *
     * On means a comment resolved here closes its issue, a comment deleted
     * here closes its issue, and an issue finished there resolves its
     * comment -- without anybody asking for it. Off leaves all of that to
     * the command and the button, and changes nothing else: filing is a
     * separate action either way.
     */
    sync: boolean;
    /** Comma-separated labels every filed issue carries. */
    labels: string;
    github: {
      /** Blank means the repository the site publishes to. */
      owner: string;
      /** Blank means the repository the site publishes to. */
      repo: string;
    };
    jira: {
      /** Where the API is, context path included. */
      site: string;
      /** Optional. Where a person opens Jira, if the API is somewhere else. */
      browseUrl: string;
      /** Project key, e.g. ENG */
      project: string;
      /** Issue type name. Blank means Task. */
      issueType: string;
      /** Which Jira this is, which decides the credential and the API. */
      auth: JiraAuth;
      /** The Atlassian account, on Cloud. */
      email: string;
      /** The account, with basic auth on a Jira somebody runs themselves. */
      username: string;
    };
    asana: {
      /** Project gid tasks are created in. */
      project: string;
      /** Workspace gid. Optional. */
      workspace: string;
    };
    /**
     * The Jira credential or the Asana token, encrypted on disk.
     *
     * GitHub is not in here: it files with the token the publish already
     * uses, since it is the same kind of credential for the same account and
     * usually the same repository. The other two have nothing to borrow.
     */
    token: string;
  };
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

/**
 * How long an automatic sync stays quiet for afterwards.
 *
 * Long enough that reloading a preview a few times is one round of requests
 * rather than five, short enough that someone resolving a comment and
 * looking at their board sees it closed. The command and the button ignore
 * it: asking explicitly means now.
 */
const AUTO_SYNC_INTERVAL = 60_000;

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
  commentOverlay: {
    enabled: false,
    reviewer: "",
    reviewFolder: `${OUTPUT_FOLDER}/review`,
  },
  relay: {
    provider: "none",
    // On, because a tracker that is configured at all is one somebody wants
    // to be right. It does nothing at all while the provider is "none".
    sync: true,
    labels: DEFAULT_RELAY_LABELS,
    github: { owner: "", repo: "" },
    jira: {
      site: "",
      browseUrl: "",
      project: "",
      issueType: DEFAULT_JIRA_ISSUE_TYPE,
      // Cloud, because it is the Jira most people have, and because it is
      // what this did before the other two existed.
      auth: "cloud",
      email: "",
      username: "",
    },
    asana: { project: "", workspace: "" },
    token: "",
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

  /**
   * One sync at a time, and not too often.
   *
   * Both of these guard the same thing: a tracker being asked the same
   * questions twice over because two triggers fired close together. A
   * preview page that loads, pulls and saves within a second is three
   * triggers for one person opening one page.
   */
  private syncing = false;
  private lastSync = 0;

  /**
   * The local server that serves the preview and holds its comments.
   *
   * Started on demand rather than on load: it is a listening socket, and one
   * that can write inside the vault, so it exists only while someone is
   * actually reviewing.
   */
  private reviewServer: ReviewServer | null = null;

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
    this.addCommand({
      id: "import-review-comments",
      name: "Import review comments",
      callback: () => void this.importReview(),
    });
    this.addCommand({
      id: "open-review-preview",
      name: "Open preview in browser",
      callback: () => void this.openPreview(),
    });
    this.addCommand({
      id: "relay-review-comments",
      name: "Send open review comments to the tracker",
      callback: () => void this.relayOpenComments(),
    });
    this.addCommand({
      id: "catch-up-filed-comments",
      name: "Sync review comments with the tracker now",
      callback: () => void this.syncWithTracker(),
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
   * Closes the listening socket when the plugin goes away.
   *
   * Without this a disable-and-enable -- which is what hot reload does on
   * every build -- would leave the old server holding its port, and the next
   * one would come up on a different one while the browser tab kept talking
   * to a server whose store belongs to a plugin instance that no longer
   * exists.
   */
  onunload(): void {
    void this.stopReviewServer();
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
      commentOverlay: {
        ...DEFAULT_SETTINGS.commentOverlay,
        ...stored?.commentOverlay,
      },
      relay: {
        ...DEFAULT_SETTINGS.relay,
        ...stored?.relay,
        // One level deeper than the rest, because each tracker keeps its own
        // fields: a spread of the outer object alone would hand back a Jira
        // block with no project in it the first time somebody picks Jira.
        github: { ...DEFAULT_SETTINGS.relay.github, ...stored?.relay?.github },
        jira: { ...DEFAULT_SETTINGS.relay.jira, ...stored?.relay?.jira },
        asana: { ...DEFAULT_SETTINGS.relay.asana, ...stored?.relay?.asana },
      },
      github: { ...DEFAULT_SETTINGS.github, ...stored?.github },
    };
    // The token lives encrypted on disk and in the clear only in memory, so
    // everything downstream can use it without knowing about any of this.
    const revealed = revealToken(this.settings.github.token);
    this.settings.github.token = revealed.token;
    this.tokenState = revealed.state;
    this.sealedToken = revealed.sealed;

    const relay = revealToken(this.settings.relay.token);
    this.settings.relay.token = relay.token;
    this.relayTokenState = relay.state;
    this.sealedRelayToken = relay.sealed;

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

  /** Whether the stored tracker token could be read. */
  relayTokenState: TokenState = "none";

  /** The tracker token exactly as it sits on disk. */
  sealedRelayToken = "";

  /** Replaces the tracker token, on the same terms as `setToken`. */
  setRelayToken(value: string): void {
    this.settings.relay.token = value;
    this.relayTokenState = value ? "ready" : "none";
    this.sealedRelayToken = "";
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
    const relayToken = tokenForStorage(
      this.settings.relay.token,
      this.sealedRelayToken,
    );

    await this.saveData({
      ...this.settings,
      github: { ...this.settings.github, token },
      relay: { ...this.settings.relay, token: relayToken },
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

  private async build(overrides?: Partial<SiteConfig>): Promise<BuildResult> {
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
      const config: SiteConfig = {
        ...this.settings.site,
        // Named here rather than stored in settings, because these are this
        // plugin's own folders and not the user's business. Publishing HTML
        // files as-is makes the preview folder selectable input, and a build
        // that read its own last output would publish the site inside the
        // site, again on every build.
        outputFolders: [OUTPUT_FOLDER, PREVIEW_FOLDER],
        ...overrides,
      };
      const result = await buildSite(this.app, config, (done, total, path) => {
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
    const overlay = this.settings.commentOverlay;
    // Resolved here rather than in the page: a relay turned on but pointed at
    // no repository would otherwise put a Send action in every preview that
    // could only ever answer with the reason it cannot work.
    const target = resolveTarget(this.settings.relay, this.settings.github);
    const result = await this.build({
      reviewOverlay: overlay.enabled
        ? {
            reviewer: overlay.reviewer,
            tracker:
              typeof target === "string" ? undefined : TRACKER_NAME[target.provider],
          }
        : undefined,
    });

    // A preview is how someone checks a filter, so an empty one is a result
    // rather than a fault. It still has to say so: an empty preview folder
    // and a preview that was never written look identical on disk.
    if (result.selectedCount === 0 && result.htmlFiles.published === 0) {
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
    // Counted separately because they are built differently: an as-is page
    // was copied, not rendered, so folding it into the page count would
    // report a render that never happened.
    const asIs = result.htmlFiles.published
      ? `, ${result.htmlFiles.published} as-is`
      : "";
    new Notice(
      `Built ${result.pages.length} pages${asIs} in ${Math.round(result.totalMs)}ms${removed} -> ${PREVIEW_FOLDER}/`,
    );

    // The other moment worth syncing on: a build is somebody about to look
    // at the review, and the overlay in the page they open reads the
    // document this is about to update.
    this.autoSync();
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

  // -- review --------------------------------------------------------------

  /** Everything the review server may touch, and nothing else. */
  private reviewStore(): ReviewStore {
    const adapter = this.app.vault.adapter;
    const folder = () => normalizePath(this.settings.commentOverlay.reviewFolder);
    const commentsPath = () => normalizePath(`${folder()}/${LIVE_COMMENTS}`);

    return {
      readComments: async () => {
        const path = commentsPath();
        return (await adapter.exists(path)) ? adapter.read(path) : null;
      },
      writeComments: async (body: string) => {
        const dir = folder();
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        await adapter.write(commentsPath(), body);
      },
      readPreview: async (path: string) => {
        // Every file read as bytes, text included: one path through here
        // means no chance of classifying a file wrongly and serving a page
        // as binary or an image as UTF-8.
        const target = normalizePath(`${PREVIEW_FOLDER}/${path}`);
        if (!(await adapter.exists(target))) return null;
        return adapter.readBinary(target);
      },
    };
  }

  /** Starts the review server if it is not already up. */
  async startReviewServer(): Promise<ReviewServerAddress> {
    if (!this.reviewServer) {
      this.reviewServer = new ReviewServer({
        store: this.reviewStore(),
        // Handed over whether or not a tracker is configured: the server is
        // started once and the setting can change under it, so "is there a
        // tracker" is a question answered per request rather than per socket.
        relay: (id) => this.relayComment(id),
        // Hung off the overlay's own reads and writes: a page being opened
        // or a comment being resolved is exactly when the two sides are
        // worth putting back in step, and it costs nothing when there is
        // nothing to do.
        touched: () => this.autoSync(),
      });
    }
    return this.reviewServer.start();
  }

  async stopReviewServer(): Promise<void> {
    const server = this.reviewServer;
    this.reviewServer = null;
    if (server) await server.stop();
  }

  /** Where the server is listening, or null while it is not running. */
  get reviewServerAddress(): ReviewServerAddress | null {
    return this.reviewServer?.listening ?? null;
  }

  /**
   * Opens the built preview in the real browser, through the local server.
   *
   * Through the server rather than as a file, because that is what lets the
   * overlay read and write the vault: same origin, so no CORS, and a page
   * that can ask the plugin for the comments instead of only remembering its
   * own.
   */
  async openPreview(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(normalizePath(`${PREVIEW_FOLDER}/index.html`)))) {
      new Notice(
        "Vault Publisher: build a preview first (Build site to preview folder).",
        8000,
      );
      return;
    }

    try {
      const address = await this.startReviewServer();
      openExternal(address.url);
      new Notice(`Vault Publisher: preview at ${address.url.split("?")[0]}`, 6000);
    } catch (error) {
      new Notice(
        `Vault Publisher: could not start the review server: ${error instanceof Error ? error.message : String(error)}`,
        10000,
      );
    }
  }

  /**
   * Turns review comments into a note in the vault.
   *
   * Reads every `*.json` in the review folder rather than asking for one
   * through a file picker. The folder is a path the settings already name and
   * the one the overlay writes to as comments are left, so there is nothing
   * to pick and no Electron dialog to open. A file dropped there by hand --
   * copied off another machine, say -- is read on the same terms. Imported
   * files are renamed rather than deleted: an import that produced the wrong
   * note should be recoverable from the file that produced it.
   */
  async importReview(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const folder = normalizePath(this.settings.commentOverlay.reviewFolder);

    if (!(await adapter.exists(folder))) {
      await adapter.mkdir(folder);
      new Notice(
        `Vault Publisher: no comments yet. Open a preview and leave some, then run this again.`,
        10000,
      );
      return;
    }

    const listing = await adapter.list(folder);
    // The live file the review server writes, and any one-off file dropped
    // here by hand. Both are read; only the drops are renamed, because
    // renaming the live one would take the running review with it.
    const { live, drops } = splitReviewInputs(listing.files, LIVE_COMMENTS);
    const inputs = [...live, ...drops];

    if (!inputs.length) {
      new Notice(
        `Vault Publisher: nothing to import from ${folder}. Leave some comments in a preview first.`,
        8000,
      );
      return;
    }

    const comments: OverlayComment[] = [];
    let site = "";
    try {
      for (const path of inputs) {
        const data = parseExport(await adapter.read(path));
        comments.push(...data.comments);
        if (!site && data.site) site = data.site;
      }
    } catch (error) {
      // A rejected file stops the whole import, deliberately: a half-written
      // review note is worse than none, because it looks finished.
      new Notice(
        `Vault Publisher: ${error instanceof ReviewImportError ? error.message : String(error)}`,
        12000,
      );
      return;
    }

    if (!comments.length) {
      new Notice("Vault Publisher: the review folder holds no comments.", 8000);
      return;
    }

    // The live file and a hand-dropped copy of it hold the same comments, so
    // importing both would put every one of them in the note twice.
    const seen = new Set<string>();
    const unique = comments.filter((comment) => {
      if (seen.has(comment.id)) return false;
      seen.add(comment.id);
      return true;
    });

    // Two reviews in a day is the normal case -- read, import, fix some of
    // it, go round again -- so the second one must not overwrite the first.
    const existing = new Set(listing.files);
    const now = new Date();
    const name = reviewNoteName(now, (candidate) =>
      existing.has(normalizePath(`${folder}/${candidate}`)),
    );
    const target = normalizePath(`${folder}/${name}`);
    await adapter.write(target, reviewNote({ comments: unique, site, now }));

    for (const path of drops) {
      // Renaming rather than deleting, and tolerating a failure: the note is
      // written by this point, and a file that could not be renamed would
      // only be imported twice, which is a duplicate rather than a loss.
      try {
        await adapter.rename(path, path.replace(/\.json$/, ".imported.json"));
      } catch {
        // Leave it; the note above is what mattered.
      }
    }

    const notes = new Set(unique.map((comment) => comment.sourcePath)).size;
    new Notice(
      `Vault Publisher: imported ${unique.length} comment(s) on ${notes} note(s) into ${target}`,
      8000,
    );
  }

  // -- the tracker ---------------------------------------------------------

  /**
   * Where to file and what it will be called, or a sentence saying what is
   * missing before anything can be.
   *
   * GitHub files with the publish token: one credential rather than two,
   * since it is a GitHub token either way and usually the same repository.
   * The cost is that it has to be allowed to open issues as well, which the
   * settings panel says. Jira and Asana have nothing to borrow, so they keep
   * a token of their own.
   */
  private relayReady(): { target: RelayTarget; where: string } | string {
    const target = resolveTarget(this.settings.relay, this.settings.github);
    if (typeof target === "string") return target;

    const missing = this.missingCredential(target);
    if (missing) return missing;

    return { target, where: describeTarget(target) };
  }

  /** The sentence to show when the tracker has no usable credential. */
  private missingCredential(target: RelayTarget): string | null {
    if (target.provider === "github") {
      if (this.settings.github.token) return null;
      return this.tokenState === "none"
        ? "Add a GitHub token in settings before filing issues."
        : "The stored GitHub token could not be read. Restart Obsidian, or paste it again.";
    }

    if (this.settings.relay.token) return null;
    // Named as the thing the panel asks for: a Jira set up for a personal
    // access token has no "Jira token" field for somebody to go looking for.
    const name =
      target.provider === "jira"
        ? `Jira ${JIRA_CREDENTIAL_NAME[target.auth]}`
        : `${TRACKER_NAME[target.provider]} token`;
    return this.relayTokenState === "none"
      ? `Add your ${name} in settings before filing anything.`
      : `The stored ${name} could not be read. Restart Obsidian, or paste it again.`;
  }

  /**
   * Files one draft, in whichever tracker the target names.
   *
   * The body is rendered here rather than upstream: each tracker takes a
   * different document, and the draft is the one shape all three are made
   * from.
   */
  private async fileIssue(
    target: RelayTarget,
    draft: IssueDraft,
  ): Promise<FiledIssue> {
    if (target.provider === "github") {
      const client = new GitHubClient({
        apiBase: this.settings.github.apiBase,
        token: this.settings.github.token,
        owner: target.owner,
        repo: target.repo,
      });
      const issue = await client.createIssue({
        title: draft.title,
        body: toMarkdown(draft.blocks),
        labels: draft.labels,
      });
      return {
        key: issueKey(target.owner, target.repo, issue.number),
        url: issue.html_url,
      };
    }

    if (target.provider === "jira") {
      const client = new JiraClient({
        site: target.site,
        browseUrl: target.browseUrl,
        project: target.project,
        issueType: target.issueType,
        auth: target.auth,
        user: target.user,
        token: this.settings.relay.token,
      });
      return client.createIssue({
        summary: draft.title,
        description: jiraDescription(draft.blocks, target.auth),
        labels: draft.labels,
      });
    }

    const client = new AsanaClient({
      token: this.settings.relay.token,
      project: target.project,
      workspace: target.workspace,
    });
    return client.createTask({ name: draft.title, notes: toText(draft.blocks) });
  }

  /**
   * Files one comment, by id, and records the issue on it.
   *
   * This is what the overlay's Send action calls, through the review server.
   * A comment that already carries an issue is answered with that issue
   * rather than filed again -- the check is here rather than in the browser
   * because the browser's copy can be out of date, and a duplicate issue is
   * not something an undo exists for.
   */
  async relayComment(id: string): Promise<RelayOutcome> {
    const ready = this.relayReady();
    if (typeof ready === "string") return { ok: false, error: ready };

    const store = this.reviewStore();
    const raw = await store.readComments();
    if (!raw) {
      return { ok: false, error: "No comments have reached the vault yet." };
    }

    let document: OverlayExport;
    try {
      document = parseExport(raw);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ReviewImportError ? error.message : String(error),
      };
    }

    const comment = document.comments.find((row) => row.id === id);
    if (!comment) {
      return { ok: false, error: "That comment has not been saved to the vault yet." };
    }
    if (comment.external) return { ok: true, external: comment.external };

    let external: OverlayExternalIssue;
    try {
      const filed = await this.fileIssue(
        ready.target,
        issueDraft(comment, ready.target, { site: document.site }),
      );
      external = externalFor(ready.target.provider, filed, new Date());
    } catch (error) {
      return { ok: false, error: relayFailure(error, ready.where) };
    }

    // The issue exists now, so this is reported as a success whatever the
    // write does. A write that failed is not a lost record either: the
    // browser is told the issue's key, sets it on its own copy, and saves
    // the document itself a moment later.
    await this.writeExternals(store, new Map([[id, external]]));
    return { ok: true, external };
  }

  /**
   * Files every open comment that has not been filed yet.
   *
   * Sequential, and it stops at the first refusal. A loop that carried on
   * would turn one wrong setting into thirty rejected requests, and the
   * thirty-first would be the one that explained why.
   */
  async relayOpenComments(): Promise<void> {
    const ready = this.relayReady();
    if (typeof ready === "string") {
      new Notice(`Vault Publisher: ${ready}`, 8000);
      return;
    }

    const store = this.reviewStore();
    const raw = await store.readComments();
    if (!raw) {
      new Notice("Vault Publisher: no review comments have reached the vault yet.", 8000);
      return;
    }

    let document: OverlayExport;
    try {
      document = parseExport(raw);
    } catch (error) {
      new Notice(
        `Vault Publisher: ${error instanceof ReviewImportError ? error.message : String(error)}`,
        12000,
      );
      return;
    }

    const pending = pendingComments(document.comments);
    if (!pending.length) {
      new Notice(
        "Vault Publisher: nothing to send. Every open comment has been filed already.",
        8000,
      );
      return;
    }

    const where = ready.where;
    const filed = new Map<string, OverlayExternalIssue>();
    let refusal: string | null = null;

    for (const comment of pending) {
      this.progress?.(`Filing in ${where}`, filed.size, pending.length);
      try {
        const issue = await this.fileIssue(
          ready.target,
          issueDraft(comment, ready.target, { site: document.site }),
        );
        filed.set(comment.id, externalFor(ready.target.provider, issue, new Date()));
      } catch (error) {
        refusal = relayFailure(error, where);
        break;
      }
    }

    // Written even after a refusal, so the issues that were filed are
    // recorded as filed. Without this, a run that failed half way would file
    // the first half again the next time it ran.
    const saved = filed.size === 0 || (await this.writeExternals(store, filed));

    const parts = [
      filed.size
        ? `filed ${filed.size} of ${pending.length} comment(s) in ${where}`
        : `filed nothing in ${where}`,
    ];
    if (refusal) parts.push(refusal);
    if (!saved) {
      parts.push(
        "the issues could not be recorded on the comments, so check them before sending again",
      );
    }
    new Notice(`Vault Publisher: ${parts.join(" \u2014 ")}`, refusal || !saved ? 14000 : 8000);
  }

  /** Puts the issue records onto the saved comments. False if it could not. */
  /**
   * Keeps the review and the trackers in step, in both directions, once.
   *
   * Three things happen here, in this order, because the order is what makes
   * the result stable: issues are closed for comments resolved here, issues
   * are closed for comments deleted here, and comments are resolved for
   * issues finished there. Writing first means a comment resolved in the
   * browser a second ago is not read straight back as "still open over
   * there" and left alone.
   *
   * The safety rules are the same in both directions, and neither is
   * negotiable. A comment can be resolved from a tracker but never reopened.
   * An issue can be closed from here but never deleted and never reopened.
   * An issue closed *without* the work being done -- not planned, won't do,
   * duplicate -- does not resolve its comment: it is counted in the report
   * instead, because a review that ticks itself off on the strength of a
   * decision not to act is worse than one that is out of date.
   *
   * `quiet` is what makes an automatic run bearable: it reports only when
   * something changed or something failed, so a preview opened twice does
   * not produce two notices saying nothing happened.
   */
  async syncWithTracker(options: { quiet?: boolean } = {}): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.runSync(Boolean(options.quiet));
    } finally {
      this.syncing = false;
      this.lastSync = Date.now();
    }
  }

  /**
   * The automatic run, which is the same work with a gate in front of it.
   *
   * Hung off the two moments that matter -- a preview being built, and the
   * overlay in a browser reading or writing the review -- rather than off a
   * timer, because those are the moments somebody is actually looking at the
   * thing being kept in step. The interval is what stops a page reloaded
   * five times firing five rounds of requests at somebody's board.
   */
  private autoSync(): void {
    if (!this.settings.relay.sync) return;
    if (this.settings.relay.provider === "none") return;
    if (this.syncing) return;
    if (Date.now() - this.lastSync < AUTO_SYNC_INTERVAL) return;
    // Not awaited: this runs behind a request a browser is waiting on, and a
    // round of HTTP to a tracker is not worth holding a page open for.
    void this.syncWithTracker({ quiet: true });
  }

  private async runSync(quiet: boolean): Promise<void> {
    const store = this.reviewStore();
    const raw = await store.readComments();
    if (!raw) {
      if (!quiet) {
        new Notice("Vault Publisher: no review comments have reached the vault yet.", 8000);
      }
      return;
    }

    let document: OverlayExport;
    try {
      document = parseExport(raw);
    } catch (error) {
      if (!quiet) {
        new Notice(
          `Vault Publisher: ${error instanceof ReviewImportError ? error.message : String(error)}`,
          12000,
        );
      }
      return;
    }

    const withdrawn = withdrawnIssues(document.withdrawn);
    const closable = closableComments(document.comments);
    const askable = filedComments(document.comments);

    const resolved = new Set<string>();
    const closed = new Set<string>();
    const settled = new Set<string>();
    const refused = new Set<string>();
    const failures: string[] = [];
    let declined = 0;

    // Closing, for the comments somebody resolved here.
    for (const comment of closable) {
      const ref = comment.external ? issueRef(comment.external) : null;
      if (!ref || refused.has(ref.provider)) continue;
      try {
        await this.closeIssue(ref, "done");
        closed.add(comment.id);
      } catch (error) {
        this.noteFailure(error, ref.provider, refused, failures);
      }
    }

    // And for the ones somebody deleted. Closed as not done: the comment
    // that asked for the work is gone, so nobody here is claiming it was.
    for (const row of withdrawn) {
      const ref = issueRef(row.external);
      if (!ref || refused.has(ref.provider)) continue;
      try {
        await this.closeIssue(ref, "declined");
        settled.add(`${row.external.provider}:${row.external.key}`);
      } catch (error) {
        this.noteFailure(error, ref.provider, refused, failures);
      }
    }

    // Reading, for the comments still open here.
    let asked = 0;
    for (const comment of askable) {
      const ref = comment.external ? issueRef(comment.external) : null;
      if (!ref || refused.has(ref.provider)) continue;
      // Closed by this same run, so the answer is already known.
      if (closed.has(comment.id)) continue;
      try {
        const state = await this.issueState(ref);
        asked += 1;
        if (state === "done") resolved.add(comment.id);
        else if (state === "declined") declined += 1;
      } catch (error) {
        this.noteFailure(error, ref.provider, refused, failures);
      }
    }

    const results: SyncResults = {
      resolved,
      closed,
      settled,
      at: new Date().toISOString(),
    };
    const changed = resolved.size + closed.size + settled.size;
    const saved = changed === 0 || (await this.writeSync(store, results));

    if (quiet && !changed && !failures.length) return;

    const parts: string[] = [];
    if (closed.size) parts.push(`closed ${closed.size} issue(s) for resolved comment(s)`);
    if (settled.size) {
      parts.push(`closed ${settled.size} issue(s) whose comment was deleted`);
    }
    if (resolved.size) {
      parts.push(`resolved ${resolved.size} comment(s) finished in the tracker`);
    }
    if (!parts.length) parts.push(`checked ${asked} filed comment(s), nothing to change`);
    if (declined) {
      parts.push(
        `${declined} closed without the work being done, left open for you to look at`,
      );
    }
    parts.push(...failures);
    if (!saved) parts.push("the review document could not be updated");
    if (resolved.size && saved) parts.push("reload the preview to see them");

    new Notice(
      `Vault Publisher: ${parts.join(" — ")}`,
      failures.length || !saved ? 14000 : 8000,
    );
  }

  /**
   * Records a tracker's refusal, once.
   *
   * One refusal from a tracker is the whole answer about that tracker:
   * asking again for every remaining comment would turn one wrong setting
   * into a hundred requests.
   */
  private noteFailure(
    error: unknown,
    provider: Exclude<RelayProvider, "none">,
    refused: Set<string>,
    failures: string[],
  ): void {
    const name = TRACKER_NAME[provider];
    refused.add(provider);
    failures.push(`${name} refused: ${relayFailure(error, name)}`);
  }

  /** Closes one issue, in whichever tracker holds it. */
  private async closeIssue(ref: IssueRef, as: "done" | "declined"): Promise<void> {
    if (ref.provider === "github") {
      await this.githubFor(ref).closeIssue(
        ref.number,
        as === "done" ? "completed" : "not_planned",
      );
      return;
    }

    if (ref.provider === "jira") {
      await this.jiraClient().closeIssue(ref.key, as);
      return;
    }

    // Asana has one notion of finished and no reason to attach to it, so a
    // withdrawn task and a done one arrive looking the same. The task's body
    // says where it came from, which is the only place that can say more.
    await this.asanaClient().completeTask(ref.gid);
  }

  /** What one tracker says about one issue. */
  private async issueState(ref: IssueRef): Promise<IssueState> {
    if (ref.provider === "github") {
      return githubState(await this.githubFor(ref).getIssue(ref.number));
    }
    if (ref.provider === "jira") {
      return jiraState(await this.jiraClient().issueStatus(ref.key));
    }
    return asanaState(await this.asanaClient().taskStatus(ref.gid));
  }

  /**
   * A GitHub client for the repository the issue is actually in.
   *
   * Built per issue rather than once, because the comment carries the
   * repository it was filed in: a review whose relay settings have moved on
   * since is still talking about the issue it created.
   */
  private githubFor(ref: { owner: string; repo: string }): GitHubClient {
    if (!this.settings.github.token) {
      throw new TrackerError("no GitHub token is stored", 0);
    }
    return new GitHubClient({
      apiBase: this.settings.github.apiBase,
      token: this.settings.github.token,
      owner: ref.owner,
      repo: ref.repo,
    });
  }

  private jiraClient(): JiraClient {
    if (!this.settings.relay.token) {
      throw new TrackerError("no token is stored for it", 0);
    }
    const jira = this.settings.relay.jira;
    const site = jiraSite(jira.site);
    if (!site) throw new TrackerError("its site is not set in settings", 0);
    return new JiraClient({
      site,
      browseUrl: jira.browseUrl,
      project: jira.project,
      issueType: jira.issueType || DEFAULT_JIRA_ISSUE_TYPE,
      auth: jira.auth,
      user: jira.auth === "basic" ? jira.username : jira.email,
      token: this.settings.relay.token,
    });
  }

  private asanaClient(): AsanaClient {
    if (!this.settings.relay.token) {
      throw new TrackerError("no token is stored for it", 0);
    }
    return new AsanaClient({
      token: this.settings.relay.token,
      project: this.settings.relay.asana.project,
      workspace: this.settings.relay.asana.workspace,
    });
  }

  /** The sibling of `writeExternals`, for the fields a sync sets. */
  private async writeSync(store: ReviewStore, results: SyncResults): Promise<boolean> {
    try {
      // Read again, for the same reason: a reviewer in a browser may have
      // saved over the document while the requests were in flight.
      const fresh = await store.readComments();
      if (!fresh) return false;
      const next = applySync(fresh, results);
      if (!next) return false;
      await store.writeComments(next);
      return true;
    } catch {
      return false;
    }
  }

  private async writeExternals(
    store: ReviewStore,
    filed: Map<string, OverlayExternalIssue>,
  ): Promise<boolean> {
    try {
      // Read again rather than reusing the document the issues were built
      // from: a reviewer in a browser may have saved over it while the
      // requests were in flight, and their comments must not be rolled back
      // by this write.
      const fresh = await store.readComments();
      if (!fresh) return false;
      const next = applyExternals(fresh, filed);
      if (!next) return false;
      await store.writeComments(next);
      return true;
    } catch {
      return false;
    }
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
      // A site of nothing but hand-written HTML pages is a real site, so
      // the guard asks whether the build produced *any* page -- it exists to
      // stop an empty tree replacing a live site, not to insist on notes.
      if (result.selectedCount === 0 && result.htmlFiles.published === 0) {
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

      // Said for the same reason as the skips: a page that went out
      // untouched is a page none of the checks below apply to.
      if (result.htmlFiles.published) {
        say(
          `published ${result.htmlFiles.published} HTML file(s) as-is` +
            (result.htmlFiles.companions
              ? `, with ${result.htmlFiles.companions} referenced file(s)`
              : ""),
        );
      }
      if (result.htmlFiles.baseHrefs.length) {
        say(
          `WARNING: ${result.htmlFiles.baseHrefs.length} HTML file(s) set a base href ` +
            `that will not find their own files -- see the build report`,
        );
      }
      if (result.htmlFiles.localResourceUrls.length) {
        say(
          `WARNING: ${result.htmlFiles.localResourceUrls.length} HTML file(s) hold an ` +
            `app:// URL, which contains the path of your vault -- see the build report`,
        );
      }
      if (result.htmlFilesBlockedByFlag) {
        say(
          `${result.htmlFilesBlockedByFlag} HTML file(s) not published: a frontmatter ` +
            `flag is required and an HTML file cannot carry one`,
        );
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
        // One request per changed file, so a whole-vault publish is a few
        // hundred of them. Said through `progress` rather than `say`, which
        // would put a few hundred notices on screen.
        onProgress: (done, total, path) => {
          this.progress?.(`Uploading ${path}`, done, total);
        },
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

    const html = result.htmlFiles;
    if (html.published || result.htmlFilesBlockedByFlag) {
      lines.push("", "## HTML files published as-is", "");
      lines.push(
        `Pages: ${html.published}, referenced files carried: ${html.companions} ` +
          `(${formatBytes(html.companionBytes)})`,
      );
      lines.push("");
      lines.push(
        "These are published byte for byte, at their own path, with the files they",
        "reference copied to matching paths. Nothing else in this report applies to",
        "them: they are not rendered, not wrapped in the site's shell, not scanned",
        "for content from unpublished notes, and not styled by the site's CSS.",
      );
      if (result.htmlFilesBlockedByFlag) {
        lines.push(
          "",
          `**${result.htmlFilesBlockedByFlag} HTML file(s) were not published.** ` +
            "A frontmatter flag is required to publish, and an HTML file has no " +
            "frontmatter to carry it. Clear the flag to publish them, or leave it " +
            "set and publish them from a folder scope instead.",
        );
      }
      if (html.localResourceUrls.length) {
        lines.push(
          "",
          `**${html.localResourceUrls.length} page(s) hold an \`app://\` URL.** That is ` +
            "Obsidian's own resource scheme: it contains the absolute path of your " +
            "vault, so your home directory and account name, and it resolves for " +
            "nobody but you. These pages are published as written, so this one is " +
            "yours to fix:",
          "",
        );
        for (const page of html.localResourceUrls) lines.push(`- ${page}`);
      }
      if (html.baseHrefs.length) {
        lines.push(
          "",
          `**${html.baseHrefs.length} page(s) set a \`<base href>\` that will not find ` +
            "their own files.** This is the one that looks like nothing is wrong: " +
            "every reference on such a page can be relative, so every file it " +
            "needs is published beside it, and the browser then resolves all of " +
            "them somewhere else and the page is blank. A build with a relative " +
            "base and one without produce output that is otherwise identical.",
          "",
        );
        for (const page of html.baseHrefs) lines.push(`- ${page}`);
      }
      if (html.unresolved.length) {
        lines.push(
          "",
          "References that will not reach what the page meant by them. Each one",
          "is published exactly as written, so these are yours to fix:",
          "",
        );
        for (const reference of html.unresolved.slice(0, 40)) lines.push(`- ${reference}`);
        if (html.unresolved.length > 40) {
          lines.push(`- ... and ${html.unresolved.length - 40} more`);
        }
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

/**
 * A GitHub refusal, said in terms of what to change.
 *
 * `GitHubError` already carries GitHub's own message, which is accurate and
 * frequently useless: "Not Found" for a repository the token cannot see is
 * true and tells nobody what to do about it. The three statuses worth
 * translating are the three that are nearly always a setting.
 */
function relayFailure(error: unknown, where: string): string {
  const status =
    error instanceof GitHubError || error instanceof TrackerError
      ? error.status
      : null;

  if (status === 401) return `the token was rejected by ${where}`;
  if (status === 403) return `the token is not allowed to file in ${where}`;
  if (status === 404) return `${where} is not there, or the token cannot see it`;
  if (status === 410) return `issues are turned off in ${where}`;
  return error instanceof Error ? error.message : String(error);
}

/** The target in the words somebody would use for it. */
function describeTarget(target: RelayTarget): string {
  if (target.provider === "github") return `${target.owner}/${target.repo}`;
  if (target.provider === "jira") return `${target.project} on ${hostOf(target.site)}`;
  return `Asana project ${target.project}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
