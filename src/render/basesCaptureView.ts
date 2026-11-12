import {
  App,
  BasesPropertyId,
  BasesView,
  Plugin,
  QueryController,
  TFile,
  Value,
  parseYaml,
  requireApiVersion,
} from "obsidian";
import {
  CAPTURE_VIEW_TYPE,
  CapturedRow,
  CapturedSummary,
  buildCapturedCards,
  buildCapturedList,
  buildCapturedTable,
} from "../publish/bases";
import { BaseConfig, BasesSourceDeps } from "../publish/basesSource";
import {
  cardOptions,
  coverSource,
  hasWikilink,
  listOptions,
  summaryPropertyId,
  writeLinkedText,
} from "../publish/basesValues";

/**
 * The Bases view type the publisher reads rows through.
 *
 * Obsidian hands a registered view the full result of its query -- every
 * row, filtered, sorted and grouped -- regardless of how much of it would fit
 * on screen, which is the one thing the rendered grid cannot give us. This
 * view writes that result out as the static table, cards or list the site
 * publishes, in the layout `osp-layout` names, with the summary row
 * `osp-summaries` carries. It is only ever placed on a page by
 * `rewriteBasesForCapture`, during a build.
 *
 * Registration is visible: Obsidian lists registered view types in its view
 * picker, so this one appears there while the plugin is loaded. Picked by
 * hand, it shows the same static table, which is harmless.
 *
 * The API arrived in Obsidian 1.10 and the plugin supports older versions, so
 * nothing here is touched unless the API is present: the class is defined
 * inside the function, because `class extends BasesView` would throw at load
 * on an app where `BasesView` does not exist.
 */

let available = false;

/** True once the capture view is registered and can be used. */
export function basesCaptureAvailable(): boolean {
  return available;
}

export function registerCaptureView(plugin: Plugin): boolean {
  // Obsidian's own version check, rather than testing for the classes: it is
  // what the plugin review's lint recognises as a guard, and everything that
  // touches the 1.10 API has to sit inside it, the class included.
  if (requireApiVersion("1.10.0")) {
    class CaptureView extends BasesView {
      type = CAPTURE_VIEW_TYPE;
      private readonly host: HTMLElement;
      private readonly controller: QueryController;

      constructor(controller: QueryController, containerEl: HTMLElement) {
        super(controller);
        this.controller = controller;
        this.host = containerEl;
      }

      /** Writes a value: links by hand, everything else as Obsidian draws it. */
      private writeValue(cell: HTMLElement, value: Value | null, sourcePath: string): void {
        if (!value) return;
        const text = value.toString();
        if (hasWikilink(text)) {
          writeLinkedText(cell, text, (linkpath) => {
            const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
            if (!file) return null;
            return {
              path: file.path,
              title: file.extension === "md" ? file.basename : file.name,
            };
          });
          return;
        }
        try {
          value.renderTo(cell, { hoverPopover: null });
        } catch {
          // A value that will not render itself still has a text form.
          cell.textContent = text;
        }
      }

      onDataUpdated(): void {
        const doc = this.host.ownerDocument;
        const get = (key: string): unknown => this.config.get(key);
        const layout = get("osp-layout");
        const order = this.config.getOrder();
        const columns = order.map((id) => ({ id, label: this.config.getDisplayName(id) }));
        const imageId = layout === "cards" ? this.config.getAsPropertyId("image") : null;

        const groups = this.data.groupedData.map((group) => ({
          label: group.hasKey() ? (group.key?.toString() ?? "") : null,
          rows: group.entries.map((entry): CapturedRow => {
            const sourcePath = entry.file.path;
            let cover: CapturedRow["cover"] = null;
            if (imageId) {
              const src = coverSource(entry.getValue(imageId)?.toString() ?? "", (linkpath) => {
                const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
                return file
                  ? { extension: file.extension, url: this.app.vault.getResourcePath(file) }
                  : null;
              });
              if (src) cover = { src, alt: entry.file.basename };
            }
            return {
              path: entry.file.path,
              // Bases' own name for the file: `.md` hidden, other extensions
              // shown, so a `.base` row reads "Bulk.base", not "Bulk".
              title: entry.getValue("file.name")?.toString() ?? entry.file.name,
              cover,
              render: (cell, columnId) =>
                this.writeValue(cell, entry.getValue(columnId as BasesPropertyId), sourcePath),
            };
          }),
        }));
        const single = groups.length === 1 && groups[0].label === null;
        // A grouped view puts entries with no value for the key in a group of
        // their own, which needs a heading like any other.
        const labelled = single ? groups : groups.map((g) => ({ ...g, label: g.label ?? "(none)" }));

        const base = { name: this.config.name, columns, groups: labelled };
        const figure =
          layout === "cards"
            ? buildCapturedCards(doc, { ...base, ...cardOptions(get) })
            : layout === "list"
              ? buildCapturedList(doc, { ...base, ...listOptions(get) })
              : buildCapturedTable(doc, { ...base, summaries: this.summaries(order) });
        this.host.empty();
        this.host.append(figure);
      }

      /** The summary row, from the copy the source rewrite made of it. */
      private summaries(order: BasesPropertyId[]): CapturedSummary[] {
        const wanted = this.config.get("osp-summaries");
        if (!wanted || typeof wanted !== "object") return [];
        const out: CapturedSummary[] = [];
        for (const [name, key] of Object.entries(wanted as Record<string, unknown>)) {
          if (typeof key !== "string") continue;
          const id = summaryPropertyId(name) as BasesPropertyId;
          if (!order.includes(id)) continue;
          let value: Value | null = null;
          try {
            value = this.data.getSummaryValue(this.controller, this.data.data, id, key);
          } catch {
            continue;
          }
          out.push({
            columnId: id,
            label: key,
            render: (cell) => this.writeValue(cell, value, ""),
          });
        }
        return out;
      }
    }

    available = plugin.registerBasesView(CAPTURE_VIEW_TYPE, {
      name: "Static view (Vault Publisher)",
      icon: "table",
      factory: (controller, containerEl) => new CaptureView(controller, containerEl),
    });
  }
  return available;
}

/** What `rewriteBasesForCapture` needs from the running app. */
export function basesSourceDeps(app: App): BasesSourceDeps {
  return {
    async loadBase(linkpath: string, sourcePath: string): Promise<BaseConfig | null> {
      const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      if (!(file instanceof TFile) || file.extension !== "base") return null;
      try {
        const parsed: unknown = parseYaml(await app.vault.cachedRead(file));
        return parsed && typeof parsed === "object" ? (parsed as BaseConfig) : null;
      } catch {
        return null;
      }
    },
    parseYaml,
  };
}
