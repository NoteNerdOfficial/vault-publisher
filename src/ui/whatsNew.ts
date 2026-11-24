import { App, Modal } from "obsidian";
import { openExternal } from "../platform/openExternal";
import editModeShot from "./whats-new/edit-mode.jpg";

/**
 * What's new: a popup shown once after an update that has something worth
 * telling, and on demand from the command.
 *
 * Only versions listed here get one. A release that only fixes things passes
 * quietly, and a fresh install never sees it: someone who has just installed
 * the plugin has not been missing anything.
 *
 * The screenshot is bundled into `main.js` as a data URL, since a release
 * ships `main.js`, `manifest.json` and `styles.css` and nothing else.
 */
export interface Release {
  version: string;
  title: string;
  lede: string;
  image?: { src: string; alt: string };
  points: Array<{ title: string; text: string }>;
  link?: { text: string; url: string };
}

export const RELEASES: Release[] = [
  {
    version: "0.2.0",
    title: "Edit your prototypes like in Figma",
    lede:
      "Edit mode joins the notch in your preview. Select anything on an HTML page published as-is and change it: " +
      "the change is written straight into the page's file in your vault.",
    image: {
      src: editModeShot,
      alt:
        "Edit mode on a pricing page: a card selected, the Rectangle tool out on the bar under the page, " +
        "and the Design panel on the right showing the card's auto layout, sizing, fill and stroke.",
    },
    points: [
      {
        title: "A Design panel in Figma's words",
        text: "Auto layout, sizing, fill, stroke, effects, text and hover states, plus a Layers tab. Select several layers to change them all at once.",
      },
      {
        title: "Insert tools",
        text: "Frame (F), Rectangle (R), Text (T) and Image. Click to place, drag to size. A new button or heading takes the look of one already on the page.",
      },
      {
        title: "Straight to the code",
        text: "The Code section shows the file and line of a layer and its CSS rules, and opens them in VS Code, Cursor or the editor you choose.",
      },
      {
        title: "To try it",
        text: "Turn on Include comment and edit tools and Publish HTML files as-is, build a preview, open a prototype and press E.",
      },
    ],
    link: {
      text: "Read how it works",
      url: "https://github.com/NoteNerdOfficial/vault-publisher#editing-a-prototype-from-its-preview",
    },
  },
];

/** -1, 0 or 1, comparing dotted version numbers part by part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The release to show on start-up, or null. The newest one with notes that
 * came out after the version last seen, up to the one running now, so
 * skipping a version still shows what it brought.
 */
export function releaseToShow(
  current: string,
  lastSeen: string | undefined,
  freshInstall: boolean,
  releases: Release[] = RELEASES,
): Release | null {
  if (freshInstall) return null;
  return (
    releases
      .filter((r) => compareVersions(r.version, current) <= 0)
      .filter((r) => !lastSeen || compareVersions(r.version, lastSeen) > 0)
      .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null
  );
}

/** The newest release with notes, for the command. */
export function latestRelease(current: string, releases: Release[] = RELEASES): Release | null {
  return releaseToShow(current, undefined, false, releases);
}

export class WhatsNewModal extends Modal {
  constructor(
    app: App,
    private readonly release: Release,
    private readonly openSettings: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("osp-whats-new");
    contentEl.empty();
    contentEl.createDiv({ cls: "osp-whats-new-kicker", text: `What's new in Vault Publisher ${this.release.version}` });
    contentEl.createEl("h2", { cls: "osp-whats-new-title", text: this.release.title });
    contentEl.createEl("p", { cls: "osp-whats-new-lede", text: this.release.lede });
    if (this.release.image) {
      const img = contentEl.createEl("img", { cls: "osp-whats-new-shot" });
      img.src = this.release.image.src;
      img.alt = this.release.image.alt;
    }
    const list = contentEl.createEl("ul", { cls: "osp-whats-new-points" });
    for (const point of this.release.points) {
      const item = list.createEl("li");
      item.createEl("strong", { text: point.title });
      item.createSpan({ text: point.text });
    }
    const buttons = contentEl.createDiv({ cls: "osp-whats-new-buttons" });
    if (this.release.link) {
      const link = this.release.link;
      buttons.createEl("button", { text: link.text }).addEventListener("click", () => {
        openExternal(link.url);
      });
    }
    buttons.createEl("button", { text: "Open settings" }).addEventListener("click", () => {
      this.close();
      this.openSettings();
    });
    const done = buttons.createEl("button", { cls: "mod-cta", text: "Got it" });
    done.addEventListener("click", () => this.close());
    window.setTimeout(() => done.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
