/**
 * A runtime stand-in for the `obsidian` module.
 *
 * The real package ships type declarations and nothing else -- the
 * implementation lives inside the app, and esbuild marks it external. That is
 * correct for the bundle and leaves a test runner with an import it cannot
 * resolve, so this provides the few names the module graph mentions.
 *
 * Nothing here is constructed at import time by the code under test: these
 * exist so the graph loads, not so it runs. A test that needs App or TFile
 * behaviour builds its own stub and passes it in.
 */

export class Component {
  load(): void {}
  unload(): void {}
}

export class MarkdownRenderer {
  static async render(): Promise<void> {}
}

export class Notice {
  constructor(public message?: string) {}
}

export class Plugin {}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(
    public app: unknown,
    public plugin: unknown,
  ) {
    this.containerEl = document.createElement("div");
  }
  display(): void {}
  hide(): void {}
}

/**
 * A settings row, built close enough to Obsidian's own that a rendered panel
 * can be read back: one `.setting-item` per row, carrying its name, its
 * description and whatever controls were added to it, and `.setting-item-heading`
 * on the ones that are section headings.
 *
 * It is a stand-in, not a replica. What a test asks of it is the shape of the
 * panel -- which sections exist, in what order, which rows are in them, what
 * each row says, and whether its button is live -- so that is what it keeps.
 */
export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.settingEl = doc.createElement("div");
    this.settingEl.className = "setting-item";
    this.nameEl = doc.createElement("div");
    this.nameEl.className = "setting-item-name";
    this.descEl = doc.createElement("div");
    this.descEl.className = "setting-item-description";
    this.controlEl = doc.createElement("div");
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
    container.appendChild(this.settingEl);
  }

  setName(value: string): this {
    this.nameEl.textContent = value;
    return this;
  }
  setDesc(value: string): this {
    this.descEl.textContent = value;
    return this;
  }
  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }
  addText(build: (text: any) => unknown): this {
    build(new StubText(this.controlEl));
    return this;
  }
  addTextArea(build: (text: any) => unknown): this {
    build(new StubTextArea(this.controlEl));
    return this;
  }
  addToggle(build: (toggle: any) => unknown): this {
    build(new StubToggle(this.controlEl));
    return this;
  }
  addDropdown(build: (dropdown: any) => unknown): this {
    build(new StubDropdown(this.controlEl));
    return this;
  }
  addButton(build: (button: any) => unknown): this {
    build(new StubButton(this.controlEl));
    return this;
  }
  addExtraButton(build: (button: any) => unknown): this {
    build(new StubButton(this.controlEl));
    return this;
  }
}

export class Modal {}
export class TFile {}
export class TFolder {}

export const apiVersion = "0.0.0-test";

/**
 * Obsidian's icon painter, which in the app looks a Lucide name up in a
 * registry and writes an `<svg class="svg-icon">` into the element. Here it
 * records which name was asked for, so a test can check a row carries the
 * icon it meant to without the registry existing.
 */
export function setIcon(element: HTMLElement, name: string): void {
  element.setAttribute("data-icon", name);
  const svg = element.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  svg.setAttribute("class", "svg-icon");
  element.appendChild(svg);
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Obsidian's HTTP call, replaceable per test.
 *
 * Declared with `let` and exported directly so that `setRequestUrl` is seen
 * by modules that already imported it: an ES module export is a live binding,
 * not a copy. Anything reached through `GitHubClient` therefore uses whatever
 * the current test installed, with no seam needed in the client itself.
 */
export let requestUrl: (options: any) => Promise<any> = async () => {
  throw new Error(
    "requestUrl was called without setRequestUrl: install a fake first.",
  );
};

/** Installs a fake. Returns a function restoring the previous one. */
export function setRequestUrl(fake: (options: any) => Promise<any>): () => void {
  const previous = requestUrl;
  requestUrl = fake;
  return () => {
    requestUrl = previous;
  };
}

/* --- enough of the settings UI to render one and read it back --------- */

/**
 * Obsidian's own additions to `HTMLElement`.
 *
 * The app patches these onto the prototype at startup, and the settings tab
 * uses them throughout. jsdom has no idea about them, so a test that renders
 * the panel has to put them there first.
 *
 * Installed by a call rather than at import time: most of this suite runs in
 * plain Node with no `HTMLElement` to patch, and reaching for one on import
 * would break every file that only wanted the module graph to resolve.
 */
export function installObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.createDiv) return;

  function make(
    this: HTMLElement,
    tag: string,
    options?: string | { cls?: string; text?: string },
  ): HTMLElement {
    const node = this.ownerDocument.createElement(tag);
    const opts = typeof options === "string" ? { cls: options } : (options ?? {});
    if (opts.cls) node.className = opts.cls;
    if (opts.text) node.textContent = opts.text;
    this.appendChild(node);
    return node;
  }

  proto.createEl = function (this: HTMLElement, tag: string, options?: never) {
    return make.call(this, tag, options);
  };
  proto.createDiv = function (this: HTMLElement, options?: never) {
    return make.call(this, "div", options);
  };
  proto.createSpan = function (this: HTMLElement, options?: never) {
    return make.call(this, "span", options);
  };
  proto.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
  };
  proto.addClass = function (this: HTMLElement, ...names: string[]) {
    this.classList.add(...names);
  };
  proto.removeClass = function (this: HTMLElement, ...names: string[]) {
    this.classList.remove(...names);
  };
  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  // Obsidian also exposes `createDiv` as a global, which makes a detached
  // element rather than appending to one. The real signature is wider than
  // anything here calls, so this takes the shape that is actually used.
  (globalThis as Record<string, unknown>).createDiv = (options?: {
    cls?: string;
    attr?: Record<string, string>;
  }) => {
    const node = document.createElement("div");
    if (options?.cls) node.className = options.cls;
    for (const [key, value] of Object.entries(options?.attr ?? {})) {
      node.setAttribute(key, String(value));
    }
    return node;
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

class StubText {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.inputEl = parent.ownerDocument.createElement("input");
    parent.appendChild(this.inputEl);
  }
  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  onChange(handler: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", () => void handler(this.inputEl.value));
    return this;
  }
}

/**
 * The multi-line field. Same three methods as the single-line one, over a
 * `<textarea>`, which is what the panel reads back when a test asks what is
 * in a list somebody typed.
 */
class StubTextArea {
  inputEl: HTMLTextAreaElement;
  constructor(parent: HTMLElement) {
    this.inputEl = parent.ownerDocument.createElement("textarea");
    parent.appendChild(this.inputEl);
  }
  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  onChange(handler: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", () => void handler(this.inputEl.value));
    return this;
  }
}

class StubToggle {
  el: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.el = parent.ownerDocument.createElement("input");
    this.el.type = "checkbox";
    parent.appendChild(this.el);
  }
  setValue(on: boolean): this {
    this.el.checked = on;
    return this;
  }
  onChange(handler: (on: boolean) => unknown): this {
    this.el.addEventListener("change", () => void handler(this.el.checked));
    return this;
  }
}

class StubDropdown {
  el: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.el = parent.ownerDocument.createElement("select");
    parent.appendChild(this.el);
  }
  addOption(value: string, label: string): this {
    const option = this.el.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = label;
    this.el.appendChild(option);
    return this;
  }
  setValue(value: string): this {
    this.el.value = value;
    return this;
  }
  onChange(handler: (value: string) => unknown): this {
    this.el.addEventListener("change", () => void handler(this.el.value));
    return this;
  }
}

/**
 * A button, carrying the one fact these tests are mostly about: whether it
 * is disabled, and therefore whether the row above it is offering an action
 * or explaining why it cannot.
 */
class StubButton {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.ownerDocument.createElement("button");
    parent.appendChild(this.buttonEl);
  }
  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }
  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }
  setWarning(): this {
    this.buttonEl.classList.add("mod-warning");
    return this;
  }
  setIcon(name: string): this {
    this.buttonEl.setAttribute("data-icon", name);
    return this;
  }
  setTooltip(text: string): this {
    this.buttonEl.setAttribute("aria-label", text);
    return this;
  }
  setDisabled(on: boolean): this {
    this.buttonEl.disabled = on;
    return this;
  }
  onClick(handler: () => unknown): this {
    this.buttonEl.addEventListener("click", () => void handler());
    return this;
  }
}
