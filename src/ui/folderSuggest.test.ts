// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { FolderSuggest } from "./folderSuggest";

function folder(path: string): TFolder {
  return Object.assign(Object.create(TFolder.prototype) as TFolder, { path, isRoot: () => path === "/" });
}

const app = {
  vault: {
    getAllLoadedFiles: () => [
      folder("/"),
      folder("Projects"),
      folder("Change requests"),
      folder("Projects/Pricing"),
      Object.assign(Object.create(TFile.prototype) as TFile, { path: "Projects/notes.md" }),
    ],
  },
} as unknown as App;

describe("folder suggestions", () => {
  it("lists the vault's folders that match what is typed, never the root or a file", () => {
    const suggest = new FolderSuggest(app, document.createElement("input"));
    expect(suggest.getSuggestions("")).toEqual(["Change requests", "Projects", "Projects/Pricing"]);
    expect(suggest.getSuggestions("pric")).toEqual(["Projects/Pricing"]);
  });

  it("fills the field and saves it as typing would", () => {
    const input = document.createElement("input");
    let typed = "";
    input.addEventListener("input", () => (typed = input.value));
    new FolderSuggest(app, input).selectSuggestion("Projects/Pricing");
    expect(input.value).toBe("Projects/Pricing");
    expect(typed).toBe("Projects/Pricing");
  });
});
