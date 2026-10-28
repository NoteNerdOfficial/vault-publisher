import { describe, expect, it } from "vitest";
import { noteSource } from "./source";

describe("noteSource", () => {
  it("returns an ordinary note unchanged", () => {
    const note = "# Title\n\nA paragraph, and a [[link]].\n";
    expect(noteSource(note)).toBe("# Title\n\nA paragraph, and a [[link]].");
  });

  /* --- the three things the rendered page does not show ---------------- */

  it("removes the frontmatter the published page already strips", () => {
    const note = "---\npublish: true\nsalary: 90000\n---\n\n# Title\n\nBody.\n";
    expect(noteSource(note)).toBe("# Title\n\nBody.");
  });

  it("removes an empty frontmatter block", () => {
    expect(noteSource("---\n---\nBody.\n")).toBe("Body.");
  });

  it("leaves a rule that is not frontmatter alone", () => {
    expect(noteSource("Intro.\n\n---\n\nMore.\n")).toBe("Intro.\n\n---\n\nMore.");
  });

  it("removes an Obsidian comment", () => {
    expect(noteSource("Before %%check this with legal%% after.")).toBe(
      "Before  after.",
    );
  });

  it("removes a comment that spans lines, and the gap it leaves", () => {
    const note = "Start.\n\n%%\nTodo: ask about the numbers.\n%%\n\nEnd.\n";
    expect(noteSource(note)).toBe("Start.\n\nEnd.");
  });

  it("removes an HTML comment", () => {
    expect(noteSource("Visible.\n\n<!-- not visible -->\n\nAlso visible.\n")).toBe(
      "Visible.\n\nAlso visible.",
    );
  });

  /* --- and the code it must not touch ---------------------------------- */

  // Erlang comments are `%%`, which is the case that turns a careless strip
  // into silent corruption of a published code block.
  it("leaves a fenced code block alone", () => {
    const note = "```erlang\n%% start the server\nstart() -> ok.\n```\n";
    expect(noteSource(note)).toBe(note.trim());
  });

  it("leaves an HTML comment inside a fence alone", () => {
    const note = "```html\n<!-- a comment, as documentation -->\n```\n";
    expect(noteSource(note)).toBe(note.trim());
  });

  it("leaves a tilde fence alone", () => {
    const note = "~~~\n%% kept %%\n~~~\n";
    expect(noteSource(note)).toBe(note.trim());
  });

  it("does not let an inner fence close an outer one", () => {
    const note = "````md\n```\n%% kept %%\n```\n````\n";
    expect(noteSource(note)).toBe(note.trim());
  });

  it("leaves an inline code span alone", () => {
    expect(noteSource("Write `%% x %%` to comment.")).toBe("Write `%% x %%` to comment.");
  });

  it("strips a comment that follows a code span on the same line", () => {
    expect(noteSource("Use `%%` %%ask first%% today.")).toBe("Use `%%`  today.");
  });

  /* --- the malformed cases, which must not eat the note ---------------- */

  it("keeps an unterminated comment as text", () => {
    expect(noteSource("Body with a stray %% in it.")).toBe("Body with a stray %% in it.");
  });

  it("keeps an unterminated HTML comment as text", () => {
    expect(noteSource("Body with <!-- a stray opener.")).toBe(
      "Body with <!-- a stray opener.",
    );
  });

  it("keeps a lone backtick as text", () => {
    expect(noteSource("A ` backtick and %%a comment%% after it.")).toBe(
      "A ` backtick and  after it.",
    );
  });

  it("keeps an unclosed fence from swallowing nothing it should not", () => {
    const note = "```\n%% kept %%\n";
    expect(noteSource(note)).toBe("```\n%% kept %%");
  });

  it("is empty when a note is nothing but frontmatter", () => {
    expect(noteSource("---\ntitle: Secret\n---\n")).toBe("");
  });
});
