import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * The vault's folders, suggested as a folder setting is typed, the way
 * Obsidian's own settings suggest them. Picking one fills the field and
 * saves it through the field's own change handler, so the setting needs no
 * second path for a picked value.
 */
export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private readonly input: HTMLInputElement,
  ) {
    super(app, input);
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .map((folder) => folder.path)
      .filter((path) => path.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 50);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.setValue(path);
    // The field's onChange listens for input, so a pick saves like typing.
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}
