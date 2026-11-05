import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { THEMES, getTheme } from "../publish/themes";
import { SiteConfig, isScopeChosen, resolveHomeNote, selectNotes } from "../publish/buildSite";
import {
  TokenState,
  describeStorage,
  describeTokenState,
  storageMode,
} from "../platform/secrets";
import { JIRA_AUTH_LABEL, JiraAuth, RelayProvider } from "../overlay/relay";
import { parseExcludeFolders, swallowsScope } from "../publish/excludeFolders";
import { normalizeCustomCssPath } from "../publish/customCss";
import { DEFAULT_OUTPUT_FOLDERS, isBuildOutput } from "../publish/outputFolders";
import {
  SourceLinkSettings,
  resolveSourceUrl,
  sourceUrlProblem,
} from "../publish/sourceLink";
import { openExternal } from "../platform/openExternal";

/**
 * The settings screen.
 *
 * The goal the whole project is measured against is that setup is simple,
 * so this is grouped by how often a section is wanted rather than by which
 * part of the code owns each field. One block at the top holds the whole
 * working loop -- build a preview, open it, publish -- and changes what it
 * says with the state of setup rather than where it sits; everything under
 * it is configuration, ordered by what reaches a working preview soonest.
 * `display` says more about why that way round, and `renderActions` about
 * the block.
 *
 * Two things it deliberately does:
 *
 * It verifies the token by calling GitHub rather than by checking the string
 * looks plausible, and shows which account answered. A token that is valid
 * but belongs to the wrong account is the error people actually hit, and no
 * amount of format checking catches it.
 *
 * It says where the token is stored, in plain words, every time. Secret
 * handling that quietly degrades to plaintext is worse than none, because
 * the user believes something that is not true.
 */

/**
 * What a plugin load does on its own, if anything.
 *
 * `build` and `publish` are the two a user would want. The rest are
 * development instrumentation: Obsidian offers no way to invoke a command
 * from outside, so a shell drives a run by writing data.json and touching
 * the build. They are deliberately not offered in the settings UI, and
 * shown there only when one is already selected, so the panel never
 * misreports what the plugin is about to do.
 */
export type AutoRunMode =
  | "none"
  | "spike"
  | "build"
  | "publish"
  | "diagnose"
  | "electron";

/** The modes a reader of the settings panel can choose between. */
const OFFERED_MODES: { value: AutoRunMode; label: string }[] = [
  { value: "build", label: "Build a preview" },
  { value: "publish", label: "Publish to GitHub" },
];

/**
 * Other plugins worth having alongside this one.
 *
 * Each entry says what the plugin is and what it has to do with publishing a
 * vault, rather than repeating the listing's own blurb. A row that only
 * described the plugin would be an advertisement; the second half of each
 * sentence is what makes the section worth a reader's time.
 *
 * `icon` is the plugin's own ribbon icon where it has one, so a row matches
 * what the reader will see once it is installed. Convert to Markdown,
 * Unhidden and AI Skills Manager register no ribbon icon, or register a
 * custom SVG this plugin cannot reach, so those carry the nearest Lucide
 * name instead.
 */
export const RELATED_PLUGINS: { name: string; desc: string; url: string; icon: string }[] = [
  {
    name: "Convert to Markdown",
    desc:
      "Turns PDFs, Office and OpenDocument files, EPUBs, web pages and email " +
      "into Markdown, locally, with nothing uploaded. What it writes is a note " +
      "like any other, so it is publishable the moment it lands in the vault.",
    url: "https://community.obsidian.md/plugins/convert-to-markdown",
    icon: "file-text",
  },
  {
    name: "Terminus",
    desc:
      "A real terminal inside Obsidian, with a review workflow for the edits " +
      "an agent makes. Useful beside a preview: look at what was actually " +
      "written into the preview folder, or work on the published repository " +
      "without leaving the vault it is built from.",
    url: "https://community.obsidian.md/plugins/terminus",
    icon: "square-terminal",
  },
  {
    name: "AI Skills Manager",
    desc:
      "Manages the skills, agents, commands and rules your AI tools run. The " +
      "review overlay reads comments a tool wrote into the review file and " +
      "marks them as an agent's, so the agents this manages can mark up a " +
      "preview build the same way a person does.",
    url: "https://community.obsidian.md/plugins/ai-skills-manager",
    icon: "shapes",
  },
  {
    name: "Browser Bookmark",
    desc:
      "A bookmarks sidebar that opens saved links in Obsidian's own Web " +
      "Viewer. Somewhere to keep the published site and its repository, one " +
      "click from the notes they are built from.",
    url: "https://community.obsidian.md/plugins/browser-bookmark",
    icon: "bookmark",
  },
  {
    name: "Working tabs",
    desc:
      "Groups open tabs into named spaces you can put away and finish later. " +
      "A publishing pass sprawls \u2014 the notes being fixed, the review " +
      "note, the preview \u2014 and this keeps that from becoming the rest " +
      "of the day's tabs.",
    url: "https://community.obsidian.md/plugins/working-tabs",
    icon: "layout-panel-left",
  },
  {
    name: "Unhidden",
    desc:
      "Reveals dot-folders like .github and .claude in the file explorer, " +
      "search and Bases. Worth having when the vault you publish from is also " +
      "a repository, and the parts of it Obsidian hides are the parts you " +
      "need to look at.",
    url: "https://community.obsidian.md/plugins/unhidden",
    icon: "eye",
  },
];

/** What the Jira credential field is called, per way of signing in. */
const JIRA_CREDENTIAL_NAME_UI: Record<JiraAuth, string> = {
  cloud: "API token",
  pat: "Personal access token",
  basic: "Password",
};

/** Where that credential comes from, since each one is made somewhere else. */
const JIRA_CREDENTIAL_SOURCE: Record<JiraAuth, string> = {
  cloud: "Made at id.atlassian.com, under Security. It is not your password.",
  pat: "Made in Jira itself, under your profile, Personal Access Tokens.",
  basic: "The password you sign in to Jira with.",
};

export interface SettingsHost {
  /** Set by this tab so a running build can report what it is doing. */
  progress: ((step: string, done?: number, total?: number) => void) | null;
  /** Folder an earlier version of this plugin left behind, if any. */
  legacyFolder: string | null;
  /** Deletes that folder. Resolves to false if it could not be removed. */
  removeLegacyFolder(): Promise<boolean>;
  /** Whether the stored token could be read. */
  tokenState: TokenState;
  /** Replaces the token. Use this rather than assigning to settings. */
  setToken(value: string): void;
  /** Whether the stored tracker token could be read. */
  relayTokenState: TokenState;
  /** Replaces the tracker token, on the same terms as `setToken`. */
  setRelayToken(value: string): void;
  setPublishPassword(value: string): void;
  settings: {
    autoRun: AutoRunMode;
    site: {
      siteName: string;
      /** Folder path, `""` for the whole vault, `null` for unchosen. */
      folder: string | null;
      requireFrontmatterFlag: string | null;
      homeNote?: string;
      updatedProperty?: string;
      pinnedProperty?: string;
      theme?: string;
      publishHtmlFiles?: boolean;
      excludeFolders?: string[];
      failOnPrivacyLeak?: boolean;
      failOnTruncatedBase?: boolean;
      customDomain?: string;
      /** Vault path of a stylesheet of the author's own, or unset. */
      customCssPath?: string;
    };
    publishPassword: string;
    commentOverlay: {
      enabled: boolean;
      onPublish: boolean;
      publishComments: boolean;
      publishContact: string;
      reviewer: string;
      reviewFolder: string;
    };
    sourceLink: SourceLinkSettings;
    relay: {
      provider: RelayProvider;
      sync: boolean;
      labels: string;
      github: { owner: string; repo: string };
      jira: {
        site: string;
        browseUrl: string;
        project: string;
        issueType: string;
        auth: JiraAuth;
        email: string;
        username: string;
      };
      asana: { project: string; workspace: string };
      token: string;
    };
    github: {
      apiBase: string;
      owner: string;
      repo: string;
      branch: string;
      token: string;
      private: boolean;
    };
  };
  saveSettings(): Promise<void>;
  /** Resolves to the authenticated login, or throws. */
  verifyToken(): Promise<string>;
  publish(): Promise<void>;
  buildToPreview(): Promise<void>;
  /** Turns review comments into a note in the vault. */
  importReview(): Promise<void>;
  /** Files every open review comment in the tracker. */
  relayOpenComments(): Promise<void>;
  /** Puts the review and the tracker back in step, both ways. */
  syncWithTracker(): Promise<void>;
  /** Serves the built preview locally and opens it in the browser. */
  openPreview(): Promise<void>;
  /** Where the review server is listening, or null while it is not running. */
  readonly reviewServerAddress: { url: string; port: number } | null;
  /** Stops the review server. */
  stopReviewServer(): Promise<void>;
}

export class VaultPublisherSettingsTab extends PluginSettingTab {
  private host: SettingsHost;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  /**
   * Whether the folder field is showing, when no folder has been typed yet.
   *
   * Not persisted: it only disambiguates a state the stored value cannot,
   * which is "wants a folder, has not named one". Once a folder is named the
   * value speaks for itself, and on a reopen that is what it is read from.
   */
  private folderMode = false;

  /** Which of the three scope states the controls should show. */
  private scopeMode(): "unset" | "vault" | "folder" {
    const folder = this.host.settings.site.folder;
    if (folder === "") return "vault";
    if (folder !== null) return "folder";
    return this.folderMode ? "folder" : "unset";
  }

  constructor(app: App, host: SettingsHost & { app: App }) {
    super(app, host as never);
    this.host = host;
  }

  /**
   * Draws the whole panel.
   *
   * The order is the point. Several of these sections change what else is
   * shown -- a toggle reveals the rows under it -- so the panel is rebuilt
   * from scratch rather than patched, and `display` is what every one of
   * those handlers calls.
   *
   * **One block of actions on top, setup under it.** This panel is two things
   * at once: the place a site is set up, which happens once, and the place it
   * is built, previewed and published, which happens every time. Putting the
   * one-time half first meant scrolling past it forever; putting a live
   * Publish button first meant the very first thing a new reader saw was a
   * button that could only fail.
   *
   * So the top is a single block that holds the whole working loop -- build a
   * preview, open it, publish -- and changes what it says rather than where
   * it sits. Before setup is finished it leads with what is still missing and
   * each action carries the reason it cannot run yet; afterwards the
   * checklist is gone and the actions are live. The block never moves, so
   * nobody has to relearn where the buttons are the day something becomes
   * unset. `renderActions` has the detail.
   *
   * **The setup below it is in the order that reaches something real
   * fastest.** Not "connect, choose, look" -- a preview needs no GitHub at
   * all, only a site name and a scope, so what to publish and how it looks
   * come first and GitHub is where it belongs: the step before publishing,
   * and nothing earlier. It also puts the two things Build preview depends on
   * directly beneath the button.
   *
   * Review and Issue tracker are last but for startup behaviour: an optional
   * way of working rather than part of setup. Neither exists at all until the
   * overlay is switched on, and the switch for that is up in the action
   * block, attached to the build it is an argument to -- see
   * `renderBuildRow`. Issue tracker used to be drawn from inside
   * `renderReview`, which put a section running to a dozen Jira fields in the
   * middle of the review settings.
   *
   * The methods below are in the order they were written rather than the
   * order they draw in, so the banners over them name their section instead
   * of numbering it. The call list here is the running order.
   */
  display(): void {
    const { containerEl } = this;
    // Taken before the container is emptied, because emptying it collapses
    // its height and the scroll position goes with it. Without this, every
    // toggle in here threw the reader back to the top of the panel.
    const marks = this.scrollMarks();
    containerEl.empty();

    this.renderLegacyNotice(containerEl);
    this.renderActions(containerEl);
    this.renderContent(containerEl);
    this.renderTheme(containerEl);
    this.renderConnection(containerEl);
    this.renderPassword(containerEl);
    this.renderReview(containerEl);
    this.renderRelay(containerEl);
    this.renderAutomation(containerEl);
    this.renderRelatedPlugins(containerEl);

    this.restoreScroll(marks);
  }

  /**
   * Where the panel is scrolled to, as offsets that can be put back.
   *
   * Which element actually scrolls is Obsidian's business and has changed
   * between versions -- the tab content, or the container it sits in -- so
   * this records every ancestor that is scrolled rather than guessing at one
   * of them. Only non-zero offsets are kept, so the common case costs one
   * property read.
   */
  private scrollMarks(): Array<[HTMLElement, number]> {
    const marks: Array<[HTMLElement, number]> = [];
    let node: HTMLElement | null = this.containerEl;
    while (node) {
      if (node.scrollTop > 0) marks.push([node, node.scrollTop]);
      if (node === document.body) break;
      node = node.parentElement;
    }
    return marks;
  }

  /**
   * Puts the scroll position back after a redraw.
   *
   * Synchronous, and deliberately not deferred to an animation frame: the
   * rebuilt rows are already in the document, so the offset lands before
   * anything is painted and the panel never visibly moves. A redraw that
   * made the panel shorter is clamped by the browser, which is the right
   * answer -- the row that was being looked at is now nearer the end.
   */
  private restoreScroll(marks: Array<[HTMLElement, number]>): void {
    for (const [node, at] of marks) node.scrollTop = at;
  }

  /**
   * Offers to clear out the folder the plugin used to live in.
   *
   * The rename left a complete copy of the old settings behind, and those
   * settings include the GitHub token. It is encrypted, and it is still a
   * credential sitting in a folder nothing will ever load again, inside a
   * vault that is probably synced. Worth one button rather than a line in a
   * changelog nobody reads.
   */
  private renderLegacyNotice(root: HTMLElement): void {
    const folder = this.host.legacyFolder;
    if (!folder) return;

    new Setting(root).setName("Leftover from the old plugin").setHeading();

    new Setting(root)
      .setName("Remove the previous plugin folder")
      .setDesc(
        `Your settings were brought across from ${folder}. That folder still ` +
          "holds a copy of them, including your GitHub token, and nothing " +
          "reads it any more.",
      )
      .addButton((button) =>
        button
          .setButtonText("Remove")
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true);
            const removed = await this.host.removeLegacyFolder();
            new Notice(
              removed
                ? "Removed the old plugin folder."
                : "Could not remove it; delete it by hand if you want it gone.",
            );
            this.display();
          }),
      );
  }

  /**
   * What setup still needs, in the order it is worth doing.
   *
   * Name and scope first, then the GitHub pair, because that is the order in
   * which each step buys something: with the first two a preview builds and
   * can be read, and the token and repository are only ever needed by the
   * last step. The old order asked for a personal access token before the
   * reader had seen a single page of their own site.
   *
   * `reach` is what the step unlocks, and is how the list can say that
   * stopping halfway is a sensible place to stop.
   */
  private setupSteps(): Array<{ done: boolean; text: string; reach: "preview" | "publish" }> {
    const { github, site } = this.host.settings;
    return [
      { done: Boolean(site.siteName), text: "Give the site a name", reach: "preview" },
      { done: isScopeChosen(site), text: "Choose what to publish", reach: "preview" },
      { done: Boolean(github.token), text: "Add a GitHub token", reach: "publish" },
      {
        done: Boolean(github.owner && github.repo),
        text: "Name the repository to publish to",
        reach: "publish",
      },
    ];
  }

  /**
   * The whole working loop, in one block at the top of the panel.
   *
   * Build a preview, open it, publish it: three actions that used to be in
   * two sections with the review overlay's settings between them, which made
   * the preview loop something you had to already know in order to find.
   *
   * It has two states and one position. While setup is unfinished it leads
   * with the short list of what is missing and every action says what is
   * stopping it; once setup is done the list is gone and the actions are
   * live. Nothing is reordered between the two, because a settings panel
   * that rearranges itself costs a returning reader more than it saves a new
   * one -- and the state can go backwards, when a token stops being readable
   * or a scope is unset.
   *
   * The actions report rather than refuse. Each of them already checked its
   * own preconditions and answered a failed press with a Notice; saying the
   * same thing on the row, before the press, is the same sentence delivered
   * where it can still be acted on.
   */
  private renderActions(root: HTMLElement): void {
    const steps = this.setupSteps();
    const ready = steps.every((step) => step.done);

    new Setting(root)
      .setName(ready ? "Preview and publish" : "Get started")
      .setHeading();

    if (!ready) this.renderChecklist(root, steps);

    /*
     * The progress readout, which is not on screen until there is progress.
     *
     * It used to be drawn always: an empty line of reserved height and a 4px
     * empty track, directly under the heading. With nothing building, that
     * is a stray grey rule and a band of dead space at the top of the panel
     * -- and the rule reads as a section divider, which is the one thing it
     * is not. So the whole readout is hidden until the first report arrives
     * and stays up afterwards, holding whatever it last said.
     */
    const readout = root.createDiv();
    readout.style.cssText = "display:none;margin:0.2em 0 1.25em;";

    this.progressEl = readout.createDiv();
    this.progressEl.style.cssText =
      "font-size:0.9em;margin:0 0 0.5em;color:var(--text-muted);";

    const track = readout.createDiv();
    track.style.cssText =
      "height:4px;border-radius:2px;background:var(--background-modifier-border);overflow:hidden;";
    this.progressBar = track.createDiv();
    this.progressBar.style.cssText =
      "height:100%;width:0;background:var(--interactive-accent);transition:width 120ms linear;";

    // The sink stays registered for the life of the tab: a publish started
    // from here keeps reporting even if the user scrolls away, and a publish
    // started from the command palette fills this in if the tab is open.
    this.host.progress = (step, done, total) => {
      readout.style.display = "block";
      if (this.progressEl) this.progressEl.setText(step);
      if (this.progressBar) {
        const pct =
          done !== undefined && total ? Math.round((done / total) * 100) : null;
        this.progressBar.style.width = pct === null ? "100%" : `${pct}%`;
        this.progressBar.style.opacity = pct === null ? "0.35" : "1";
      }
    };

    this.renderBuildRow(root);
    this.renderOpenRow(root);
    this.renderPublishRow(root);
  }

  /**
   * The steps still to do, and the two the preview alone needs.
   *
   * Done steps stay on the list struck through rather than disappearing from
   * it. A list that shortens as it is worked through tells you how much is
   * left; a list that also keeps what is finished tells you how far along you
   * are, and on a four-item list that costs two lines.
   */
  private renderChecklist(
    root: HTMLElement,
    steps: Array<{ done: boolean; text: string; reach: "preview" | "publish" }>,
  ): void {
    // One block, not two: the list and the line under it are one thought,
    // and as two they were two outdented paragraphs instead of one.
    const body = this.note(root);

    const list = body.createEl("ol");
    list.style.cssText = "margin:0 0 0.6em;padding-left:1.4em;line-height:1.8;";
    for (const step of steps) {
      const item = list.createEl("li");
      item.setText(step.done ? `${step.text} — done` : step.text);
      item.style.opacity = step.done ? "0.5" : "1";
      if (step.done) item.style.textDecoration = "line-through";
    }

    // The useful half of the list is that it has a halfway point. Someone who
    // only wants to see their vault as a site never has to finish it.
    body.createDiv().setText(
      "The first two are all a preview needs — nothing is sent anywhere until " +
        "you publish. The repository is created for you on the first publish, " +
        "and GitHub Pages is switched on automatically.",
    );
  }

  /** Why a preview cannot be built yet, or null when it can. */
  private previewBlocked(): string | null {
    return isScopeChosen(this.host.settings.site)
      ? null
      : "Choose what to publish, below, and this will build.";
  }

  /**
   * Why a publish cannot run yet, or null when it can.
   *
   * The same conditions `publish` itself checks, in the same order, so the
   * row and the Notice can never disagree about what is wrong. A token that
   * is present but unreadable is reported as itself: the remedy there is to
   * restart Obsidian, not to paste a new token.
   */
  private publishBlocked(): string | null {
    const { github, site } = this.host.settings;
    if (!github.token) {
      return (
        describeTokenState(this.host.tokenState) ??
        "Add a GitHub token, below, and this will publish."
      );
    }
    if (!github.owner || !github.repo) {
      return "Name the repository to publish to, below, and this will publish.";
    }
    if (!isScopeChosen(site)) {
      return "Choose what to publish, below, and this will publish.";
    }
    return null;
  }

  /**
   * Building a preview, and the one choice that changes what gets built.
   *
   * The overlay toggle lives here rather than down in the Review section
   * because that is what it actually is: `buildToPreview` reads it on the way
   * past and hands the build a review layer or nothing. It was filed as a
   * feature of reviewing, which put the argument several sections away from
   * the button that consumes it, and left the button's own description
   * describing something it might not be about to do.
   *
   * So the row says which of the two builds it is about to make, and the
   * switch for that sits directly under it, indented, because an option that
   * belongs to one action should be impossible to read as belonging to the
   * panel. Under the button rather than over it: the action is what someone
   * opened this panel for and should stay the first thing in it, and a row
   * that names its own state does not need the switch read first to be
   * understood.
   */
  private renderBuildRow(root: HTMLElement): void {
    const why = this.previewBlocked();
    const overlay = this.host.settings.commentOverlay;

    new Setting(root)
      .setName("Build a preview")
      .setDesc(
        why ??
          (overlay.enabled
            ? "Renders the site into a folder in this vault, with the review " +
              "overlay on it. Nothing is sent to GitHub."
            : "Renders the site into a folder in this vault. Nothing is sent to GitHub."),
      )
      .addButton((button) => {
        button.setButtonText("Build preview");
        if (why) {
          button.setDisabled(true);
          return;
        }
        button.onClick(async () => {
          button.setDisabled(true);
          this.setProgress("Starting…");
          try {
            await this.host.buildToPreview();
            this.setProgress("Preview built.");
          } catch (error) {
            this.setProgress("Build failed.");
            new Notice(`Build failed: ${error instanceof Error ? error.message : error}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    // Left exactly as the theme draws any other row. An earlier version
    // stripped its top border and indented it, to make it look like part of
    // the card above; in a theme that draws rows as cards that produced an
    // indented card with its top padding gone, misaligned against every
    // neighbour. What ties it to the build is that it sits directly under it
    // and that the build row says which of the two builds it will make --
    // neither of which depends on a theme cooperating.
    new Setting(root)
      .setName("Include a review overlay")
      .setDesc(
        "A comment layer on the build, so you can pin notes to a paragraph " +
          "while reading it. Never added to a published site, and your " +
          "readers never see it.",
      )
      .addToggle((toggle) =>
        toggle.setValue(overlay.enabled).onChange(async (value) => {
          overlay.enabled = value;
          await this.host.saveSettings();
          // Redrawn because this is also what decides whether the Review
          // section below exists at all, and what the row above it says.
          this.display();
        }),
      );

  }

  /**
   * Opening the built preview in a browser.
   *
   * Out here rather than inside the Review section, where it used to be.
   * `openPreview` has never needed the review overlay -- it serves the
   * preview folder and opens it -- but it was only drawn when the overlay was
   * switched on, so anyone who had not turned on commenting had no way to
   * look at their own preview from this panel at all.
   *
   * It is not gated on a preview existing, because knowing whether one does
   * means reading the vault and this draws synchronously. Pressing it with
   * nothing built says so, and says to build one.
   */
  private renderOpenRow(root: HTMLElement): void {
    const running = this.host.reviewServerAddress;

    new Setting(root)
      .setName("Open the preview")
      // The server's state belongs to this row, so it is said in this row.
      // It used to be a bare line underneath, pulled up by a negative
      // margin, which left it jammed against the row above and hanging
      // outside the inset every other piece of text in the panel sits in.
      // A listening socket is worth saying plainly; it is not worth its own
      // paragraph.
      .setDesc(
        running
          ? `Serving on ${running.url.split("?")[0]} — reachable only from this ` +
              "computer. It stops when you close Obsidian or disable the plugin."
          : "Serves the built preview from this computer and opens it in your " +
              "browser. Nothing outside this machine can reach it, and the " +
              "server stops when you close Obsidian.",
      )
      .addButton((button) =>
        button
          .setButtonText(running ? "Open again" : "Open")
          .onClick(async () => {
            button.setDisabled(true);
            try {
              await this.host.openPreview();
            } finally {
              button.setDisabled(false);
              this.display();
            }
          }),
      );

    if (running) {
      new Setting(root)
        .setName("Stop serving")
        .setDesc("Closes the local server. Comments already saved stay in the vault.")
        .addButton((button) =>
          button.setButtonText("Stop").onClick(async () => {
            await this.host.stopReviewServer();
            this.display();
          }),
        );
    }
  }

  private renderPublishRow(root: HTMLElement): void {
    const why = this.publishBlocked();

    new Setting(root)
      .setName("Publish to GitHub")
      .setDesc(
        why ??
          "Renders every selected note and commits the result. Keep Obsidian open until it finishes.",
      )
      .addButton((button) => {
        button.setButtonText("Publish").setCta();
        if (why) {
          button.setDisabled(true);
          return;
        }
        button.onClick(async () => {
          button.setDisabled(true);
          this.setProgress("Starting…");
          try {
            await this.host.publish();
          } catch (error) {
            this.setProgress("Publish failed.");
            new Notice(`Publish failed: ${error instanceof Error ? error.message : error}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }

  // -- connect -------------------------------------------------------------

  private renderConnection(root: HTMLElement): void {
    new Setting(root).setName("GitHub").setHeading();

    const github = this.host.settings.github;

    new Setting(root)
      .setName("Personal access token")
      .setDesc(describeStorage())
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("github_pat_… or ghp_…")
          .setValue(github.token ? "••••••••••••" : "")
          .onChange(async (value) => {
            // An untouched field shows dots; only a real edit replaces the
            // stored token, or opening settings would wipe it.
            if (value.includes("•")) return;
            this.host.setToken(value.trim());
            await this.host.saveSettings();
          });
      });

    // A token that is present but unreadable. Worth its own notice, because
    // the field looks empty and the remedy is not to paste a new token.
    const trouble = describeTokenState(this.host.tokenState);
    if (trouble) {
      this.warning(root, trouble);
    }

    if (storageMode() === "plaintext") {
      this.warning(
        root,
        "This platform does not offer encrypted storage, so the token is " +
          "saved as plain text in this vault. Use a fine-grained token " +
          "limited to the one repository you publish to.",
      );
    }

    new Setting(root)
      .setName("Connection")
      .setDesc("Checks the token against GitHub and reports which account it belongs to.")
      .addButton((button) =>
        button.setButtonText("Verify").onClick(async () => {
          this.setStatus("Checking…");
          try {
            const login = await this.host.verifyToken();
            this.setStatus(`Connected as ${login}.`, "ok");
          } catch (error) {
            this.setStatus(
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        }),
      );

    this.statusEl = this.note(root, "");
    this.statusEl.addClass("osp-settings-status");
    this.statusEl.style.minHeight = "1.2em";

    new Setting(root)
      .setName("Repository")
      .setDesc("Owner and name, for example: acme-team and handbook. Created on first publish if it does not exist.")
      .addText((text) =>
        text
          .setPlaceholder("owner")
          .setValue(github.owner)
          .onChange(async (value) => {
            github.owner = value.trim();
            await this.host.saveSettings();
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("repository")
          .setValue(github.repo)
          .onChange(async (value) => {
            github.repo = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Branch")
      .setDesc("The branch GitHub Pages serves. No Actions workflow is used.")
      .addText((text) =>
        text
          .setPlaceholder("gh-pages")
          .setValue(github.branch)
          .onChange(async (value) => {
            github.branch = value.trim() || "gh-pages";
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Custom domain")
      .setDesc(
        "Optional. Point a CNAME record at your GitHub Pages address first, " +
          "then put the domain here and publish.",
      )
      .addText((text) =>
        text
          .setPlaceholder("notes.example.com")
          .setValue(this.host.settings.site.customDomain ?? "")
          .onChange(async (value) => {
            this.host.settings.site.customDomain =
              value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("GitHub Enterprise")
      .setDesc("API base URL. Leave as is for github.com.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.github.com")
          .setValue(github.apiBase)
          .onChange(async (value) => {
            github.apiBase = value.trim() || "https://api.github.com";
            await this.host.saveSettings();
          }),
      );
  }

  // -- what to publish -----------------------------------------------------

  private renderContent(root: HTMLElement): void {
    new Setting(root).setName("What to publish").setHeading();

    const site = this.host.settings.site;

    new Setting(root)
      .setName("Site name")
      .setDesc("Shown in the header and the browser tab.")
      .addText((text) =>
        text
          .setPlaceholder("My notes")
          .setValue(site.siteName)
          .onChange(async (value) => {
            site.siteName = value;
            await this.host.saveSettings();
          }),
      );

    // Three states, so a control with three states. A text box cannot tell
    // "the whole vault" from "I have not decided", and the difference between
    // those two is every private note in the vault.
    new Setting(root)
      .setName("Scope")
      .setDesc(
        "Publishing the whole vault publishes every note in it. Choose " +
          "deliberately: this is the setting that decides what becomes public.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("unset", "— choose —");
        dropdown.addOption("vault", "The whole vault");
        dropdown.addOption("folder", "One folder");
        dropdown.setValue(this.scopeMode());
        dropdown.onChange(async (value) => {
          // Picking "One folder" does not itself choose a scope: an empty
          // folder path is not an answer. So the stored value stays null
          // until something is typed, and only the mode changes.
          this.folderMode = value === "folder";
          site.folder = value === "vault" ? "" : null;
          await this.host.saveSettings();
          // Redrawn because the folder field below appears and disappears
          // with this choice, and the checklist above it changes too.
          this.display();
        });
      });

    if (this.scopeMode() === "folder") {
      new Setting(root)
        .setName("Folder")
        .setDesc("Only notes inside this folder are published.")
        .addText((text) =>
          text
            .setPlaceholder("notes")
            .setValue(site.folder ?? "")
            .onChange(async (value) => {
              const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
              site.folder = trimmed || null;
              await this.host.saveSettings();
            }),
        );
    }

    this.renderExcludes(root);

    new Setting(root)
      .setName("Require a frontmatter flag")
      .setDesc(
        "When set, a note is published only if this property is true. " +
          "Safer for a vault that holds private notes alongside public ones.",
      )
      .addText((text) =>
        text
          .setPlaceholder("publish")
          .setValue(site.requireFrontmatterFlag ?? "")
          .onChange(async (value) => {
            site.requireFrontmatterFlag = value.trim() || null;
            await this.host.saveSettings();
          }),
      );

    // Placed under the flag rather than with the publishing options, because
    // the flag is what decides whether this does anything at all.
    new Setting(root)
      .setName("Publish HTML files as-is")
      .setDesc(this.describeHtmlFiles())
      .addToggle((toggle) =>
        toggle.setValue(site.publishHtmlFiles ?? false).onChange(async (value) => {
          site.publishHtmlFiles = value;
          await this.host.saveSettings();
          // The description changes with the value: with a flag set, the
          // answer is that this publishes nothing, and that belongs on
          // screen rather than in the build report.
          this.display();
        }),
      );

    // The field is a path, but the useful half is the answer: this says
    // which note the front page is actually going to be, including when the
    // field is empty and the vault's own README is winning.
    new Setting(root)
      .setName("Homepage")
      .setDesc(this.describeHome())
      .addText((text) =>
        text
          .setPlaceholder("README.md")
          .setValue(site.homeNote ?? "")
          .onChange(async (value) => {
            site.homeNote = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("Check which note this resolves to")
          .onClick(() => this.display()),
      );

    new Setting(root)
      .setName("Date property")
      .setDesc(
        "Frontmatter key holding a note's own last-edited date. It dates the " +
          "note's header and orders Recently updated. A note without it falls " +
          "back to the file's modified time.",
      )
      .addText((text) =>
        text
          .setPlaceholder("updated")
          .setValue(site.updatedProperty ?? "")
          .onChange(async (value) => {
            site.updatedProperty = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Start here property")
      .setDesc(
        "Frontmatter key that marks a note as a place to begin. Notes with it " +
          "set to true lead the jump-to panel. Bookmarks are deliberately not " +
          "used: they can name notes you are not publishing.",
      )
      .addText((text) =>
        text
          .setPlaceholder("pinned")
          .setValue(site.pinnedProperty ?? "")
          .onChange(async (value) => {
            site.pinnedProperty = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Refuse to publish if private notes are exposed")
      .setDesc(
        "A query inside a published note reads the whole vault, so it can print " +
          "the name or fields of a note you are not publishing. This is always " +
          "reported; turn it on to make it stop the publish.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(site.failOnPrivacyLeak ?? false)
          .onChange(async (value) => {
            site.failOnPrivacyLeak = value;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Refuse to publish a shortened Bases view")
      .setDesc(
        "Bases only builds the rows it is currently showing, so a long view " +
          "reaches the publisher short. Published pages say how many rows " +
          "they are showing; turn this on to stop the publish instead.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(site.failOnTruncatedBase ?? false)
          .onChange(async (value) => {
            site.failOnTruncatedBase = value;
            await this.host.saveSettings();
          }),
      );
  }

  /**
   * What publishing HTML files does, given the rest of the scope.
   *
   * The second sentence is the one worth the method: with a frontmatter flag
   * set, this setting publishes nothing at all, and a toggle that is on and
   * inert is worse than one that explains itself.
   */
  private describeHtmlFiles(): string {
    const site = this.host.settings.site;
    const base =
      "An .html file in the published folder goes out exactly as written -- " +
      "its own markup, its own CSS, no page of ours around it -- at its own " +
      "path, with the files it references copied beside it. Links to it from " +
      "a note resolve.";

    if (site.requireFrontmatterFlag) {
      return (
        `${base} Right now this publishes nothing: "${site.requireFrontmatterFlag}: true" ` +
        "is required to publish and an HTML file has no frontmatter to put it in."
      );
    }
    if (site.folder === "") {
      return (
        `${base} Your scope is the whole vault, which usually holds HTML nobody ` +
        "wrote as a web page -- saved articles, plugin help, old exports. Check " +
        "the build report before publishing."
      );
    }
    return base;
  }

  /**
   * What the front page will be, in one sentence.
   *
   * Resolved against the notes the scope actually matches, because that is
   * the question: a `README.md` outside the published folder is not the
   * site's homepage, and a homepage named but not published is a typo the
   * user would otherwise only find after publishing.
   */
  private describeHome(): string {
    const site = this.host.settings.site;
    const fallback =
      "Leave empty to use the vault's README, then index.md, then Home.md. " +
      "With none of those, the front page is a generated overview: what you " +
      "marked as a starting point, the most linked notes, what changed " +
      "lately, and the tags.";

    if (!isScopeChosen(site)) return fallback;

    const home = resolveHomeNote(selectNotes(this.app, site as SiteConfig), site);
    const named = site.homeNote?.trim();

    if (named && !home.path) {
      return `Nothing published matches "${named}", so the front page is the generated overview. ${fallback}`;
    }
    if (named && home.path && home.unresolved) {
      return `Nothing published matches "${named}". Using ${home.path} instead. ${fallback}`;
    }
    if (home.path) {
      return `Now using ${home.path}, published as the front page rather than at its own address. ${fallback}`;
    }
    return fallback;
  }

  // -- how it looks --------------------------------------------------------

  /**
   * Named "Appearance" rather than "Theme" because this panel is inside
   * Obsidian's own settings, where "theme" already means the one the reader
   * is looking at rather than the one their site will be built with.
   */
  /**
   * The folders to leave out of whatever the scope took in.
   *
   * Under Scope, because it is the second half of the same sentence: this is
   * what the scope cannot say on its own. Shown at every scope and not only
   * for a vault published whole -- a folder with a private subfolder in it is
   * the same problem one level down, and a control that appeared and
   * disappeared with the dropdown above would be hiding the answer from the
   * person most likely to want it.
   *
   * A textarea rather than a comma-separated field. A list of paths is
   * written one per line, and a folder is allowed a comma in its name.
   */
  private renderExcludes(root: HTMLElement): void {
    const site = this.host.settings.site;
    const entries = parseExcludeFolders(site.excludeFolders);

    new Setting(root)
      .setName("Exclude folders")
      .setDesc(
        "One vault path per line. Nothing inside these is published, at any " +
          "scope. This is a list of what to leave out, so a folder added to " +
          "the vault later is published unless you add it here too -- for " +
          "notes that must never go out, the frontmatter flag below is the " +
          "setting that fails safe.",
      )
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.inputEl.spellcheck = false;
        text
          .setPlaceholder("Journal\nPeople\nwork/clients")
          .setValue(entries.join("\n"))
          .onChange(async (value: string) => {
            site.excludeFolders = parseExcludeFolders(value);
            await this.host.saveSettings();
          });
      });

    // The contradiction: "publish this folder, except this folder". The
    // build's honest answer is an empty site, and here is the only place
    // where saying so costs the reader nothing.
    const swallowed = entries.filter((entry) => swallowsScope(entry, site.folder));
    if (swallowed.length) {
      this.warning(
        root,
        `"${swallowed[0]}" contains everything you are publishing, so this ` +
          "build would have no pages in it at all.",
      );
    }
  }

  private renderTheme(root: HTMLElement): void {
    new Setting(root).setName("Appearance").setHeading();

    const site = this.host.settings.site;

    // A site can be configured for a theme that no longer ships. The build
    // already falls back, so the honest thing is to show what will actually
    // be used rather than an empty dropdown over a stale name.
    const retired = site.theme !== undefined && getTheme(site.theme).name !== site.theme;
    const chosen = getTheme(site.theme).name;

    const description = this.note(root);

    const describe = (name: string) => {
      description.setText(getTheme(name).description);
    };

    if (retired) {
      const notice = this.note(root);
      notice.setText(
        `This site was set to "${site.theme}", which is no longer one of the themes. It will build as ${getTheme(chosen).label} until you pick another.`,
      );
      notice.style.cssText =
        "padding:0.6em 0.8em;border-radius:6px;" +
        "background:var(--background-modifier-error-hover);color:var(--text-normal);";
    }

    // A specimen rather than prose: it is a card of its own, so it lines up
    // with the edges of the rows around it and not with the text inside
    // them. The one block in the panel that is right to leave full width.
    const preview = root.createDiv({ cls: "osp-theme-specimen" });
    preview.style.cssText = "margin:0.4em 0 1.5em;";

    new Setting(root)
      .setName("Style")
      .setDesc("Applied the next time the site is built.")
      .addDropdown((dropdown) => {
        for (const theme of THEMES) dropdown.addOption(theme.name, theme.label);
        dropdown.setValue(chosen);
        dropdown.onChange(async (value) => {
          site.theme = value;
          describe(value);
          this.renderThemePreview(preview, value);
          await this.host.saveSettings();
        });
      });

    describe(chosen);
    this.renderThemePreview(preview, chosen);

    this.renderCustomCss(root);
    this.renderSourceLink(root);
  }

  /**
   * A stylesheet of the author's own, named by path.
   *
   * The curated themes are the answer for most vaults and are deliberately
   * not a theme API -- but "nearly, with our own blue" has no answer among
   * five fixed looks, and the stylesheet has been written against custom
   * properties from the start. So this is the whole of the escape hatch: name
   * a CSS file, and its rules go on the end of the site's own stylesheet.
   *
   * The example is only drawn once a path is named. A six-line CSS snippet
   * sitting under the theme dropdown for everyone who will never use it is a
   * worse trade than one line of description for the person who will.
   */
  private renderCustomCss(root: HTMLElement): void {
    const site = this.host.settings.site;
    const path = normalizeCustomCssPath(site.customCssPath);

    new Setting(root)
      .setName("Custom stylesheet")
      .setDesc(
        "A CSS file in the vault, added to the end of the site's own " +
          "stylesheet on every build -- for your own colours and fonts. " +
          "Leave it empty for none.",
      )
      .addText((text) =>
        text
          .setPlaceholder("design/site.css")
          .setValue(site.customCssPath ?? "")
          .onChange(async (value) => {
            site.customCssPath = value.trim();
            await this.host.saveSettings();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("Check this path")
          .onClick(() => this.display()),
      );

    if (!path) return;

    // Pointing at the preview's own stylesheet is the obvious mistake after
    // reading one, and the build refuses it: appended to itself it would
    // double on every build.
    if (isBuildOutput(path, DEFAULT_OUTPUT_FOLDERS)) {
      this.warning(
        root,
        `${path} is inside a folder this plugin writes rather than reads, so ` +
          "the build will leave it out. Keep your stylesheet somewhere else " +
          "in the vault.",
      );
      return;
    }

    const example = this.note(root);
    example.setText(
      "Redeclare any of the theme's custom properties and yours win, in both " +
        "light and dark. Every name the theme sets is listed at the top of the " +
        "built assets/site.css, where you can read the values you are replacing.",
    );
    const code = example.createEl("pre");
    code.style.cssText =
      "margin:0.6em 0 0;padding:0.6em 0.8em;overflow-x:auto;" +
      "border-radius:6px;background:var(--background-secondary);" +
      "font-size:var(--font-smaller)";
    code.setText(
      [
        ":root {",
        "  --osp-link: #b4531f;",
        "  --osp-accent: #b4531f;",
        '  --osp-font-body: "Iowan Old Style", Georgia, serif;',
        "  --osp-measure: 72ch;",
        "}",
      ].join("\n"),
    );

    // Whether the file is actually there. Asynchronous, so it is drawn into a
    // slot kept for it rather than appended whenever the answer arrives --
    // otherwise it lands under whatever section finished rendering last.
    const verdict = root.createDiv();
    void this.reportCustomCss(verdict, path);
  }

  /**
   * Says whether the named stylesheet exists.
   *
   * Through the adapter rather than the file index, matching the build: a
   * stylesheet in `.obsidian/snippets/` is hidden from Obsidian's own
   * explorer and perfectly readable, and somebody who already writes CSS for
   * Obsidian may well keep it there.
   *
   * A vault that cannot answer draws nothing. The alternative -- warning that
   * a file is missing because the check itself failed -- would send someone
   * to fix a path that was right.
   */
  private async reportCustomCss(host: HTMLElement, path: string): Promise<void> {
    const adapter = this.app.vault.adapter as {
      exists?: (path: string) => Promise<boolean>;
    } | undefined;
    if (typeof adapter?.exists !== "function") return;

    let found: boolean;
    try {
      found = await adapter.exists(path);
    } catch {
      return;
    }

    if (found) {
      this.note(host, `Found ${path}. Its rules are added after the theme's.`);
      return;
    }
    this.warning(
      host,
      `No file at ${path}, so the site builds without it. Create it, or ` +
        "correct the path -- a build says so too, in the skipped list of its " +
        "report.",
    );
  }

  /**
   * The link out to the repository the site came from.
   *
   * Here rather than in the GitHub section, although the address it falls
   * back to is named down there. What this decides is whether the published
   * site carries a control, which is a question about the site's furniture --
   * the same kind of question as which theme it is built in. The GitHub
   * section is about reaching GitHub at all.
   *
   * Two rows, and only one of them unless the switch is on. The switch is the
   * decision; the field is a correction to a guess that is right most of the
   * time, and a site whose source is in the repository it publishes to never
   * has to look at it.
   */
  private renderSourceLink(root: HTMLElement): void {
    const link = this.host.settings.sourceLink;
    const github = this.host.settings.github;

    new Setting(root)
      .setName("Link to the source repository")
      .setDesc(
        "Adds a button to the top bar, beside light and dark, and to the menu " +
          "on a phone. It opens in a new tab.",
      )
      .addToggle((toggle) =>
        toggle.setValue(link.enabled).onChange(async (value) => {
          link.enabled = value;
          await this.host.saveSettings();
          // The field below and the line that says where the button leads
          // both exist only while this is on.
          this.display();
        }),
      );

    if (!link.enabled) return;

    const derived = resolveSourceUrl({ enabled: true, url: "" }, github);

    new Setting(root)
      .setName("Repository address")
      .setDesc(
        "Leave this empty to use the repository you publish to. Fill it in " +
          "when your vault's source is somewhere else -- publishing to a " +
          "branch of an output-only repository is common, and readers should " +
          "be sent to the work rather than to the build.",
      )
      .addText((text) =>
        text
          .setPlaceholder(derived ?? "https://github.com/you/your-vault")
          .setValue(link.url)
          .onChange(async (value) => {
            link.url = value.trim();
            await this.host.saveSettings();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("Check where this leads")
          .onClick(() => this.display()),
      );

    // What the button will actually do, which is the only part of this the
    // reader is really deciding. A typed address no browser would follow is
    // said as a warning rather than silently dropped at build time.
    const trouble = sourceUrlProblem(link.url);
    if (trouble) {
      this.warning(root, trouble);
      return;
    }

    const resolved = resolveSourceUrl(link, github);
    if (resolved) {
      this.note(
        root,
        link.url
          ? `The button links to ${resolved}.`
          : `The button links to ${resolved}, the repository you publish to.`,
      );
      return;
    }

    this.warning(
      root,
      "No address yet, so no button is built. Either fill this in or name " +
        "the repository to publish to in the GitHub section below.",
    );
  }

  /**
   * A sample of the theme, drawn from its own tokens.
   *
   * Picking a look from three words and a dropdown is guesswork, and the
   * honest alternative -- build the site and look -- costs a full render.
   * This is deliberately a small specimen rather than a screenshot: the
   * colours, the type pairing and the heading scale all come from the same
   * token set the published stylesheet uses, so it cannot drift from the
   * real thing the way a stored image would.
   *
   * It is not a page preview and does not pretend to be. Layout, the table
   * of contents and plugin output are not represented.
   */
  private renderThemePreview(host: HTMLElement, themeName: string): void {
    const theme = getTheme(themeName);
    const dark = document.body.classList.contains("theme-dark");
    const palette = { ...theme.base, ...(dark ? theme.dark : theme.light) };
    const v = (name: string) => palette[name] ?? "";

    host.empty();

    const card = host.createDiv();
    card.style.cssText = [
      `background:${v("--osp-bg")}`,
      `color:${v("--osp-text")}`,
      `border:1px solid ${v("--osp-border")}`,
      `border-radius:${v("--osp-radius")}`,
      "padding:1.1rem 1.25rem",
      "overflow:hidden",
    ].join(";");

    const eyebrow = card.createDiv();
    eyebrow.setText(
      (this.host.settings.site.siteName || "Your site").toUpperCase(),
    );
    eyebrow.style.cssText = [
      `font-family:${v("--osp-font-ui")}`,
      `color:${v("--osp-text-muted")}`,
      `letter-spacing:${v("--osp-eyebrow-tracking")}`,
      "font-size:0.65rem",
      "font-weight:600",
      "margin-bottom:0.6rem",
    ].join(";");

    const heading = card.createDiv();
    heading.setText("A note about rivers");
    heading.style.cssText = [
      `font-family:${v("--osp-font-display")}`,
      `font-weight:${v("--osp-title-weight")}`,
      `letter-spacing:${v("--osp-title-tracking")}`,
      "font-size:1.35rem",
      "line-height:1.15",
      "margin-bottom:0.4rem",
    ].join(";");

    const body = card.createDiv();
    body.innerHTML =
      'Water finds the cheapest path downhill, and so does a note that has been ' +
      'rewritten often enough. <span class="osp-preview-link">A link looks like this</span>.';
    body.style.cssText = [
      `font-family:${v("--osp-font-body")}`,
      `line-height:${v("--osp-line-height")}`,
      "font-size:0.9rem",
    ].join(";");

    const link = body.querySelector(".osp-preview-link") as HTMLElement | null;
    if (link) {
      link.style.cssText = [
        `color:${v("--osp-link")}`,
        "text-decoration:underline",
        `text-decoration-thickness:${v("--osp-link-underline")}`,
        "text-underline-offset:3px",
      ].join(";");
    }

    const swatches = card.createDiv();
    swatches.style.cssText = "display:flex;gap:6px;margin-top:0.9rem;";
    for (const token of ["--osp-accent", "--osp-link", "--osp-surface", "--osp-border"]) {
      const dot = swatches.createDiv();
      dot.style.cssText = [
        "width:16px",
        "height:16px",
        "border-radius:50%",
        `background:${v(token)}`,
        `border:1px solid ${v("--osp-border")}`,
      ].join(";");
    }
  }

  // -- review, and where its comments go -----------------------------------

  /**
   * The review overlay.
   *
   * One toggle, and the detail only once it is on. This is an optional way of
   * working rather than part of setup, so it stays out of the first-run
   * checklist and out of the way of someone who only wants to publish.
   *
   * The overlay can now reach a published page, which it could not before,
   * so the two things someone would otherwise have to guess are both said
   * here in full: whether readers of the site can write comments, and
   * whether the vault's folder names travel with them. The answers are no
   * and never, and both are worth a sentence rather than a reassuring
   * silence.
   */
  /**
   * A password on the published site.
   *
   * The copy here is the whole of the honesty of this feature, so it is
   * worth labouring. A reader who sets a password reasonably assumes it is
   * a login; it is not, and cannot be, because GitHub Pages serves every
   * byte of a public repository to anyone who asks. What it actually does
   * is encrypt the files, which is real -- somebody without the password
   * downloads ciphertext -- but it is one shared secret, it cannot be
   * revoked without republishing, and anyone it is given to can pass it on.
   *
   * Saying so plainly is not a disclaimer. It is the difference between
   * somebody using this for a draft they would rather not have indexed,
   * which it is good at, and using it for something that matters, which it
   * is not built for.
   */
  private renderPassword(root: HTMLElement): void {
    new Setting(root).setName("Password").setHeading();

    this.note(
      root,
      "A published site is public: anyone with the address can download " +
        "every file. A password does not change that — it encrypts the " +
        "files, so what they download cannot be read without it.",
    );

    const set = Boolean(this.host.settings.publishPassword);
    new Setting(root)
      .setName("Password for the published site")
      .setDesc(
        set
          ? `Set. Pages and attachments are encrypted on publish. ${describeStorage()}`
          : `Leave empty to publish normally. ${describeStorage()}`,
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setValue(set ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "")
          .onChange(async (value) => {
            // Dots mean untouched. A field that looks empty invites a save
            // that empties it, which is how a password gets lost by opening
            // settings to change something else.
            if (value.includes("\u2022")) return;
            this.host.setPublishPassword(value.trim());
            await this.host.saveSettings();
          });
      });

    if (set) {
      this.note(
        root,
        "What this is: one shared secret. Everyone you give it to can read " +
          "everything and pass it on, and changing it means publishing " +
          "again. Forgetting it costs nothing — your vault is the original. " +
          "What it is not: an account, a login, or a way to give one person " +
          "access and not another. If your host can ask for a password " +
          "itself, that is stronger than this.",
      );
      /*
       * The limit worth knowing before trusting this with anything.
       *
       * Page contents are encrypted; the names of the files holding them
       * are not, and cannot be while the pages still link to each other by
       * name. On a public repository the whole tree is browsable anyway. So
       * a note called "Acme layoffs" publishes a readable URL saying so,
       * whatever is inside it -- and somebody deciding what to protect
       * should hear that from the settings rather than discover it.
       */
      this.warning(
        root,
        "Page addresses stay readable. A note called “Acme layoffs” " +
          "publishes a URL that says so, even though nobody can read the " +
          "page. Rename anything whose title is the secret.",
      );
      this.note(
        root,
        "Your preview is never encrypted, and the review overlay still " +
          "works on an unlocked page.",
      );
    }
  }

  private renderReview(root: HTMLElement): void {
    const overlay = this.host.settings.commentOverlay;

    // Nothing here until there is an overlay to configure. The switch that
    // turns one on is up with Build a preview, where it is an argument to
    // the build rather than a feature of its own, so this whole section
    // comes and goes with it instead of standing empty behind one toggle.
    if (!overlay.enabled) return;

    new Setting(root).setName("Review").setHeading();

    this.note(
      root,
      "Comments you leave are saved straight into the review folder in this " +
        "vault, and are there again the next time you open the preview " +
        "— in any browser.",
    );

    new Setting(root)
      .setName("Your name")
      .setDesc("Shown against the comments you leave. Optional.")
      .addText((text) =>
        text
          .setPlaceholder("Alex")
          .setValue(overlay.reviewer)
          .onChange(async (value) => {
            overlay.reviewer = value.trim();
            await this.host.saveSettings();
          }),
      );

    /*
     * The overlay on the published site: three settings, in the order the
     * decisions are actually made.
     *
     * Shipping the overlay, inviting people to write into it, and telling
     * them where to send what they wrote are separate choices, and the
     * second is much the largest. So they nest, each one off until the one
     * above it is on.
     *
     * The copy is written for an invited reviewer rather than for a
     * passing reader, because that is who this works for. There is no way
     * back from a published page: a reviewer exports a file and sends it,
     * which somebody who was asked to review the site will do and somebody
     * who wandered in will not.
     */
    new Setting(root)
      .setName("Include in the published site")
      .setDesc(
        "Puts the overlay on published pages, so someone you send the site " +
          "to can read a review on it. Your vault's folder names never go " +
          "with it: a published page groups comments by its own URL.",
      )
      .addToggle((toggle) =>
        toggle.setValue(overlay.onPublish).onChange(async (value) => {
          overlay.onPublish = value;
          await this.host.saveSettings();
          this.display();
        }),
      );

    if (overlay.onPublish) {
      this.note(
        root,
        "A published page has no plugin behind it, so comments live in the " +
          "reader's own browser and reach you only as a file they export " +
          "and send. Best suited to reviewers you asked, rather than to " +
          "whoever happens to visit.",
      );

      new Setting(root)
        .setName("Let readers write comments")
        .setDesc(
          "Off, the published overlay only reads: pins, the comment list, " +
            "and import and export. On, anyone who can open the site can " +
            "leave comments in their own browser.",
        )
        .addToggle((toggle) =>
          toggle.setValue(overlay.publishComments).onChange(async (value) => {
            overlay.publishComments = value;
            await this.host.saveSettings();
          }),
        );

      /*
       * Not nested under "let readers write comments".
       *
       * Exporting works on a read-only published page too -- it is how
       * somebody passes on a review they imported -- so the address is
       * useful whenever the overlay is published at all. It used to be
       * hidden when commenting was off while still being written into
       * every page, which meant a stale address could publish with
       * nothing in the settings showing it.
       */
      new Setting(root)
        .setName("Where to send a review")
        .setDesc(
          "Shown when a reader exports their comments, with the reminder " +
            "to put the file in your review folder. A link is safer than " +
            "an email address: this is written into every published page, " +
            "where anything can read it.",
        )
        .addText((text) =>
          text
            .setPlaceholder("https://github.com/you/repo/issues/new")
            .setValue(overlay.publishContact)
            .onChange(async (value) => {
              overlay.publishContact = value.trim();
              await this.host.saveSettings();
            }),
        );
    }

    new Setting(root)
      .setName("Review folder")
      .setDesc(
        "Where comments are saved as you leave them, and where the imported " +
          "review note is written.",
      )
      .addText((text) =>
        text
          .setPlaceholder("_vault-publisher/review")
          .setValue(overlay.reviewFolder)
          .onChange(async (value) => {
            overlay.reviewFolder =
              value.trim().replace(/^\/+|\/+$/g, "") || "_vault-publisher/review";
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Import review comments")
      .setDesc(
        "Reads the review folder and writes one note, with a task per " +
          "comment, linked to the note it is about.",
      )
      .addButton((button) =>
        button.setButtonText("Import").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.host.importReview();
          } finally {
            button.setDisabled(false);
          }
        }),
      );
  }

  /**
   * Filing review comments as issues.
   *
   * Straight after the Review section rather than beside the GitHub
   * connection, because this is a thing done to a comment, not a thing done
   * to the site. Drawn by `display` rather than from inside `renderReview`,
   * though: nested, it sat between the Open button and the Publish button,
   * and on a Jira setup that is a dozen fields of scrolling between the two
   * rows most often wanted together.
   *
   * Off is the first option and the default, and choosing it hides the rest:
   * a vault whose reviews stay in the vault should not have to read any of
   * this.
   */
  private renderRelay(root: HTMLElement): void {
    // Nothing to file from, so nothing to configure. It follows the Review
    // section and reads as part of it, which means it should come and go
    // with it rather than offering a tracker for comments that cannot exist.
    if (!this.host.settings.commentOverlay.enabled) return;

    const relay = this.host.settings.relay;
    const github = this.host.settings.github;

    new Setting(root).setName("Issue tracker").setHeading();

    new Setting(root)
      .setName("File comments as issues")
      .setDesc(
        "Adds a Send action to a comment, so the work it asks for can be " +
          "tracked where the rest of the work is. Nothing is sent " +
          "automatically, and nothing is kept in step afterwards: a comment " +
          "goes across once, when you ask for it.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "Off");
        dropdown.addOption("github", "GitHub Issues");
        dropdown.addOption("jira", "Jira");
        dropdown.addOption("asana", "Asana");
        dropdown.setValue(relay.provider);
        dropdown.onChange(async (value) => {
          relay.provider = value as RelayProvider;
          await this.host.saveSettings();
          this.display();
        });
      });

    if (relay.provider === "none") return;

    if (relay.provider === "github") this.renderGitHubRelay(root);
    if (relay.provider === "jira") this.renderJiraRelay(root);
    if (relay.provider === "asana") this.renderAsanaRelay(root);

    if (relay.provider !== "asana") {
      new Setting(root)
        .setName("Labels")
        .setDesc(
          "Put on every issue filed from a comment, separated by commas. A " +
            "high or low priority adds its own label as well." +
            (relay.provider === "jira"
              ? " A Jira label cannot hold a space, so \"priority: high\" is " +
                "sent as \"priority-high\"."
              : ""),
        )
        .addText((text) =>
          text
            .setPlaceholder("review")
            .setValue(relay.labels)
            .onChange(async (value) => {
              relay.labels = value;
              await this.host.saveSettings();
            }),
        );
    }

    // Said here rather than found out from an absence: the Send action is
    // baked into the preview, so a preview built before the tracker was
    // turned on does not have one in it.
    this.note(
      root,
      relay.provider === "github" && !(relay.github.owner || github.owner)
        ? "Name a repository above, or set one under GitHub. Rebuild the " +
            "preview after turning this on, so the Send action is in it."
        : "Rebuild the preview after turning this on, so the Send action is " +
            "in it. The command and the button below work either way.",
    );

    new Setting(root)
      .setName("Send every open comment")
      .setDesc(
        "Files each open comment that has not been filed yet, and records " +
          "the issue on it so it is never filed twice.",
      )
      .addButton((button) =>
        button.setButtonText("Send").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.host.relayOpenComments();
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(root)
      .setName("Keep the two in step")
      .setDesc(
        "Resolving a comment here closes its issue, deleting one closes its " +
          "issue as not done, and an issue finished in the tracker resolves " +
          "its comment. Nothing is ever deleted in the tracker and nothing " +
          "is ever reopened. Turn this off to leave all of it to the button " +
          "below.",
      )
      .addToggle((toggle) =>
        toggle.setValue(relay.sync).onChange(async (value) => {
          relay.sync = value;
          await this.host.saveSettings();
          this.display();
        }),
      );

    this.note(
      root,
      relay.sync
        ? "It runs when a preview is built and while one is open, at most " +
            "once a minute, so a page reloaded twice is one round of requests."
        : "Nothing is kept in step until you press Sync.",
    );

    new Setting(root)
      .setName("Sync now")
      .setDesc(
        "Does the same round immediately: closes issues for comments " +
          "resolved or deleted here, and resolves comments whose issue is " +
          "done. An issue closed without the work being done is left for you.",
      )
      .addButton((button) =>
        button.setButtonText("Sync").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.host.syncWithTracker();
          } finally {
            button.setDisabled(false);
          }
        }),
      );
  }

  private renderGitHubRelay(root: HTMLElement): void {
    const relay = this.host.settings.relay.github;
    const github = this.host.settings.github;

    new Setting(root)
      .setName("Repository owner")
      .setDesc("Leave blank to use the repository the site publishes to.")
      .addText((text) =>
        text
          .setPlaceholder(github.owner || "owner")
          .setValue(relay.owner)
          .onChange(async (value) => {
            relay.owner = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Repository")
      .setDesc("Leave blank to use the repository the site publishes to.")
      .addText((text) =>
        text
          .setPlaceholder(github.repo || "repo")
          .setValue(relay.repo)
          .onChange(async (value) => {
            relay.repo = value.trim();
            await this.host.saveSettings();
          }),
      );

    // No second token: it is a GitHub token either way, and usually the same
    // repository. What it costs is that the publish token has to be allowed
    // to open issues, which nobody would guess.
    this.note(
      root,
      `Issues are filed with the token under GitHub, which has to be allowed ` +
        `to open issues in ${relay.owner || github.owner || "the repository"}/` +
        `${relay.repo || github.repo || "\u2026"}.`,
    );
  }

  /**
   * Jira, which is two products with one name.
   *
   * The first question is which one, because the answer decides the rest:
   * Cloud takes an email and an API token, a Jira a company runs takes a
   * personal access token on its own, and the API underneath is a different
   * version with a different idea of what a description is. Asking it once,
   * in words rather than in jargon, is cheaper than three fields that are
   * each right in one case and a 401 in the others.
   */
  private renderJiraRelay(root: HTMLElement): void {
    const jira = this.host.settings.relay.jira;

    new Setting(root)
      .setName("Jira site")
      .setDesc(
        "The address you open Jira at. Keep the path if your company serves " +
          "it under one, such as jira.example.com/jira.",
      )
      .addText((text) =>
        text
          .setPlaceholder("acme.atlassian.net")
          .setValue(jira.site)
          .onChange(async (value) => {
            jira.site = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("How you sign in")
      .setDesc(
        "Cloud has no personal access tokens, and a Jira your company runs " +
          "has no Atlassian account to make an API token in. The wrong choice " +
          "here is a rejected credential with nothing in the refusal to say " +
          "that the credential was fine.",
      )
      .addDropdown((dropdown) => {
        for (const auth of ["cloud", "pat", "basic"] as const) {
          dropdown.addOption(auth, JIRA_AUTH_LABEL[auth]);
        }
        dropdown.setValue(jira.auth);
        dropdown.onChange(async (value) => {
          jira.auth = value as JiraAuth;
          await this.host.saveSettings();
          this.display();
        });
      });

    // Said where it can be acted on, because the request it saves is a 401
    // with nothing in it about the scheme being the thing that was wrong.
    if (jira.auth !== "cloud" && /(^|\.)atlassian\.net$/i.test(hostOnly(jira.site))) {
      this.warning(
        root,
        "That looks like a Jira Cloud site, and Cloud issues no personal " +
          "access tokens. Choose the Cloud option above and use an API token " +
          "with your account email.",
      );
    }

    new Setting(root)
      .setName("Project key")
      .setDesc("The short code in front of every issue number, such as ENG.")
      .addText((text) =>
        text
          .setPlaceholder("ENG")
          .setValue(jira.project)
          .onChange(async (value) => {
            jira.project = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Issue type")
      .setDesc("What a comment arrives as. Task unless your project says otherwise.")
      .addText((text) =>
        text
          .setPlaceholder("Task")
          .setValue(jira.issueType)
          .onChange(async (value) => {
            jira.issueType = value.trim();
            await this.host.saveSettings();
          }),
      );

    if (jira.auth === "cloud") {
      new Setting(root)
        .setName("Atlassian account email")
        .setDesc("The account the API token belongs to. Cloud needs both.")
        .addText((text) =>
          text
            .setPlaceholder("you@example.com")
            .setValue(jira.email)
            .onChange(async (value) => {
              jira.email = value.trim();
              await this.host.saveSettings();
            }),
        );
    }

    if (jira.auth === "basic") {
      new Setting(root)
        .setName("Username")
        .setDesc("The account the password belongs to, as Jira spells it.")
        .addText((text) =>
          text
            .setPlaceholder("yourname")
            .setValue(jira.username)
            .onChange(async (value) => {
              jira.username = value.trim();
              await this.host.saveSettings();
            }),
        );
    }

    this.renderRelayToken(
      root,
      JIRA_CREDENTIAL_NAME_UI[jira.auth],
      JIRA_CREDENTIAL_SOURCE[jira.auth],
    );

    new Setting(root)
      .setName("Browser address")
      .setDesc(
        "Optional, and only for a Jira whose API sits behind a gateway: the " +
          "address a person opens an issue at, when it is not the one above.",
      )
      .addText((text) =>
        text
          .setPlaceholder("optional")
          .setValue(jira.browseUrl)
          .onChange(async (value) => {
            jira.browseUrl = value.trim();
            await this.host.saveSettings();
          }),
      );

    if (jira.auth !== "cloud") {
      this.note(
        root,
        "A Jira your company runs answers on the older API, whose issue " +
          "description is wiki markup rather than a document. Comments are " +
          "sent that way, so they arrive formatted either way.",
      );
    }
  }

  private renderAsanaRelay(root: HTMLElement): void {
    const asana = this.host.settings.relay.asana;

    new Setting(root)
      .setName("Project")
      .setDesc(
        "The number in the project's own URL: app.asana.com/0/<project>/list.",
      )
      .addText((text) =>
        text
          .setPlaceholder("1201234567890123")
          .setValue(asana.project)
          .onChange(async (value) => {
            asana.project = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Workspace")
      .setDesc("Optional. The project already says which workspace it is in.")
      .addText((text) =>
        text
          .setPlaceholder("optional")
          .setValue(asana.workspace)
          .onChange(async (value) => {
            asana.workspace = value.trim();
            await this.host.saveSettings();
          }),
      );

    this.renderRelayToken(
      root,
      "Personal access token",
      "Made in Asana under Settings, Apps, Developer apps.",
    );

    // Asana has no labels and no priority everyone has, so the one place the
    // priority can be true is the task's own body.
    this.note(
      root,
      "Asana has no labels, so a high or low priority is written into the " +
        "task instead.",
    );
  }

  /**
   * The tracker's own credential.
   *
   * Shown as dots once set, exactly like the GitHub one: a field that looks
   * empty invites a save that empties it, which is how a token gets destroyed
   * by opening settings and changing something else.
   */
  private renderRelayToken(root: HTMLElement, name: string, how: string): void {
    new Setting(root)
      .setName(name)
      .setDesc(`${how} ${describeStorage()}`)
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setValue(this.host.settings.relay.token ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "")
          .onChange(async (value) => {
            if (value.includes("\u2022")) return;
            this.host.setRelayToken(value.trim());
            await this.host.saveSettings();
          });
      });

    const trouble = describeTokenState(this.host.relayTokenState);
    if (trouble) this.warning(root, trouble);
  }

  /**
   * A block of explanation between rows, built out of the theme's own parts.
   *
   * These were plain divs with a hand-written size, opacity and margin. The
   * margins were the first thing wrong with them and the inset was the
   * second: a div dropped straight into the container sits at the *outer*
   * edge of a settings row, while every row insets its own text by whatever
   * padding the theme gives it. Under a theme that draws rows as cards that
   * is a visible outdent -- the prose lines up with the card's edge and with
   * none of the words in it.
   *
   * There is no right number to write here, because the padding belongs to
   * the theme. So the block is assembled from the structure Obsidian styles
   * -- a `setting-item` holding an info column holding a description -- and
   * the theme indents, sizes and colours it exactly as it does every other
   * description in the panel. Nothing here sets any of those.
   *
   * Returns the element holding the text, for the two callers that rewrite
   * it in place rather than redrawing the panel.
   */
  private note(root: HTMLElement, text?: string): HTMLElement {
    const item = root.createDiv({ cls: "setting-item osp-settings-note" });
    const info = item.createDiv({ cls: "setting-item-info" });
    const body = info.createDiv({ cls: "setting-item-description" });
    if (text !== undefined) body.setText(text);
    return body;
  }

  /**
   * The same, for something the reader has to act on.
   *
   * A hairline in the warning colour rather than the 2px bar it was: at two
   * it reads as a decorated card of its own, and the colour is already
   * saying this one is different.
   */
  private warning(root: HTMLElement, text: string): HTMLElement {
    const body = this.note(root, text);
    body.parentElement?.parentElement?.addClass("osp-settings-warning");
    body.style.cssText =
      "border-left:1px solid var(--text-warning);padding-left:0.75em;color:var(--text-normal);";
    return body;
  }


  // -- what happens without anyone pressing a button -----------------------

  /**
   * Whether a plugin load runs something by itself.
   *
   * Two controls rather than one dropdown with "Off" in it, because the
   * question is really two: should anything happen on its own, and if so
   * what. A single list puts "Off" and "Publish to GitHub" one row apart,
   * which is a long way to slip.
   */
  private renderAutomation(root: HTMLElement): void {
    new Setting(root).setName("On startup").setHeading();

    const settings = this.host.settings;
    const mode = settings.autoRun;
    const offered = OFFERED_MODES.some((option) => option.value === mode);

    new Setting(root)
      .setName("Run automatically")
      .setDesc(
        "Off by default. Obsidian loads plugins before a sync has necessarily finished, so an automatic run can act on a half-updated vault.",
      )
      .addToggle((toggle) =>
        toggle.setValue(mode !== "none").onChange(async (on) => {
          // Turning it on lands on the harmless one. Publishing on every
          // start is a choice worth making deliberately, in the row below.
          settings.autoRun = on ? "build" : "none";
          await this.host.saveSettings();
          this.display();
        }),
      );

    if (mode === "none") return;

    const what = new Setting(root)
      .setName("What to run")
      .setDesc(
        mode === "publish"
          ? "Every start will render the whole vault and commit it. A mistake reaches the live site without anyone pressing anything."
          : "Renders the site into a folder in this vault. Nothing is sent to GitHub.",
      )
      .addDropdown((dropdown) => {
        for (const option of OFFERED_MODES) {
          dropdown.addOption(option.value, option.label);
        }
        // A development mode is not offered, but it is shown when it is what
        // is set, so the panel never claims the plugin will do something
        // other than what it will.
        if (!offered) dropdown.addOption(mode, `${mode} (development mode)`);
        dropdown.setValue(mode);
        dropdown.onChange(async (value) => {
          settings.autoRun = value as AutoRunMode;
          await this.host.saveSettings();
          this.display();
        });
      });

    if (mode === "publish") {
      what.descEl.style.color = "var(--text-warning)";
    }
  }

  // -- what else is worth having -------------------------------------------

  /**
   * Other plugins that pair with this one.
   *
   * Last, and after even the startup behaviour, because it is the only
   * section that is not about this plugin at all. Somebody scrolling to the
   * bottom of a settings panel has finished with it; that is the right place
   * to mention something else, and the wrong place is anywhere above a
   * control they came here to change.
   *
   * Each row is a link out, not an install button. Nothing here reaches the
   * network, reads which plugins are installed, or reports that it was
   * shown: it is a list of names in the plugin, and pressing one opens the
   * community listing in the reader's own browser, where installing is
   * Obsidian's business and not ours.
   */
  private renderRelatedPlugins(root: HTMLElement): void {
    new Setting(root).setName("Related plugins").setHeading();
    this.note(root, "Other community plugins that pair well with Vault Publisher.");

    for (const plugin of RELATED_PLUGINS) {
      const row = new Setting(root)
        .setName(plugin.name)
        .setDesc(plugin.desc)
        .addButton((button) =>
          button.setButtonText("View plugin").onClick(() => openExternal(plugin.url)),
        );

      row.settingEl.addClass("osp-related-plugin");
      // Ahead of the name rather than beside the button: it is the plugin's
      // own mark, so it belongs where a reader looks for what a row is
      // about. Hidden from assistive tech, which has the name already.
      const tile = createDiv({
        cls: "osp-related-plugin-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(tile, plugin.icon);
      row.settingEl.prepend(tile);
    }
  }

  private setProgress(text: string): void {
    this.host.progress?.(text);
  }

  /** Stops reporting into elements that are about to be discarded. */
  hide(): void {
    this.host.progress = null;
  }

  private setStatus(message: string, kind: "ok" | "error" | "info" = "info"): void {
    if (!this.statusEl) return;
    this.statusEl.setText(message);
    this.statusEl.style.color =
      kind === "ok"
        ? "var(--text-success)"
        : kind === "error"
          ? "var(--text-error)"
          : "var(--text-muted)";
  }
}

/**
 * The host out of whatever was typed into the site field.
 *
 * Its own small function because that field holds anything a person can paste
 * out of a browser, and a warning is not worth a thrown URL error.
 */
function hostOnly(site: string): string {
  const raw = site.trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
}
