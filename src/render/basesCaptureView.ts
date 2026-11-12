import {
  App,
  BasesPropertyId,
  BasesView,
  Plugin,
  QueryController,
  TFile,
  parseYaml,
  requireApiVersion,
} from "obsidian";
import {
  CAPTURE_VIEW_TYPE,
  CapturedRow,
  buildCapturedTable,
} from "../publish/bases";
import { BaseConfig, BasesSourceDeps } from "../publish/basesSource";

/**
 * The Bases view type the publisher reads rows through.
 *
 * Obsidian hands a registered view the full result of its query -- every
 * row, filtered, sorted and grouped -- regardless of how much of it would fit
 * on screen, which is the one thing the rendered grid cannot give us. This
 * view writes that result out as the static table the site publishes. It is
 * only ever placed on a page by `rewriteBasesForCapture`, during a build.
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

      constructor(controller: QueryController, containerEl: HTMLElement) {
        super(controller);
        this.host = containerEl;
      }

      onDataUpdated(): void {
        const order = this.config.getOrder();
        const columns = order.map((id) => ({ id, label: this.config.getDisplayName(id) }));
        const groups = this.data.groupedData.map((group) => ({
          label: group.hasKey() ? (group.key?.toString() ?? "") : null,
          rows: group.entries.map(
            (entry): CapturedRow => ({
              path: entry.file.path,
              // Bases' own name for the file: `.md` hidden, other extensions
              // shown, so a `.base` row reads "Bulk.base", not "Bulk".
              title: entry.getValue("file.name")?.toString() ?? entry.file.name,
              render: (cell, columnId) => {
                const value = entry.getValue(columnId as BasesPropertyId);
                if (!value) return;
                try {
                  value.renderTo(cell, { hoverPopover: null });
                } catch {
                  // A value that will not render itself still has a text form.
                  cell.textContent = value.toString();
                }
              },
            }),
          ),
        }));
        const single = groups.length === 1 && groups[0].label === null;
        const figure = buildCapturedTable(this.host.ownerDocument, {
          name: this.config.name,
          columns,
          // A grouped table puts entries with no value for the key in a group of
          // their own, which needs a heading like any other.
          groups: single ? groups : groups.map((g) => ({ ...g, label: g.label ?? "(none)" })),
        });
        this.host.empty();
        this.host.append(figure);
      }
    }

    available = plugin.registerBasesView(CAPTURE_VIEW_TYPE, {
      name: "Static table (Vault Publisher)",
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
