import { describe, expect, it } from "vitest";
import { EDITORS, editorChoice, editorLink } from "./editorLinks";

const PLACE = { path: "/srv/vaults/My Vault/Protos/deck.html", file: "Protos/deck.html", vault: "My Vault", line: 12, column: 5 };

describe("links to the reader's editor", () => {
  it("opens VS Code at the line by default", () => {
    const choice = editorChoice(undefined, undefined)!;
    expect(choice.name).toBe("VS Code");
    expect(editorLink(choice.template, PLACE)).toBe("vscode://file/srv/vaults/My%20Vault/Protos/deck.html:12:5");
  });

  it("has a link for every listed editor", () => {
    for (const choice of EDITORS) expect(editorLink(choice.template, PLACE)).toMatch(/^[a-z-]+:\/\//);
    expect(editorLink(editorChoice("obsidian", "")!.template, PLACE)).toBe("obsidian://open?vault=My%20Vault&file=Protos%2Fdeck.html");
  });

  it("fills in a custom template, and offers none when asked for none", () => {
    const custom = editorChoice("custom", "myeditor://open?path={path}&line={line}")!;
    expect(editorLink(custom.template, PLACE)).toBe("myeditor://open?path=/srv/vaults/My%20Vault/Protos/deck.html&line=12");
    expect(editorChoice("custom", "  ")).toBeNull();
    expect(editorChoice("none", "")).toBeNull();
  });

  it("refuses a link that would run code, has no scheme, or needs a path it lacks", () => {
    expect(editorLink("javascript:alert({line})", PLACE)).toBeNull();
    expect(editorLink("data:text/html,{file}", PLACE)).toBeNull();
    expect(editorLink("{path}:{line}", PLACE)).toBeNull();
    expect(editorLink("vscode://file{path}:{line}", { ...PLACE, path: null })).toBeNull();
  });
});
