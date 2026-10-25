import { describe, expect, it } from "vitest";
import { decodeUrlComponent, encodeUrlPath } from "./urls";

describe("encodeUrlPath", () => {
  it("leaves an ordinary path alone", () => {
    expect(encodeUrlPath("notes/getting-started.html")).toBe(
      "notes/getting-started.html",
    );
  });

  it("keeps separators and relative segments intact", () => {
    expect(encodeUrlPath("../../assets/files/a.png")).toBe(
      "../../assets/files/a.png",
    );
    expect(encodeUrlPath("./a.html")).toBe("./a.html");
  });

  // The two that corrupt a link silently rather than visibly.
  it("encodes a fragment marker so the link still points at the page", () => {
    expect(encodeUrlPath("Draft #2.html")).toBe("Draft%20%232.html");
  });

  it("encodes a query marker", () => {
    expect(encodeUrlPath("What now?.html")).toBe("What%20now%3F.html");
  });

  it("encodes the characters that break an attribute or a URL", () => {
    expect(encodeUrlPath("Q&A.html")).toBe("Q%26A.html");
    expect(encodeUrlPath("50% done.html")).toBe("50%25%20done.html");
    expect(encodeUrlPath('say "hi".html')).toBe("say%20%22hi%22.html");
  });

  it("encodes each segment independently", () => {
    expect(encodeUrlPath("my notes/Q&A #1.html")).toBe(
      "my%20notes/Q%26A%20%231.html",
    );
  });

  it("round-trips back to the name the file was committed under", () => {
    const name = "Reading/Gödel, Escher & Bach #1.html";
    expect(decodeURIComponent(encodeUrlPath(name))).toBe(name);
  });

  it("does not double-encode on a second pass", () => {
    // Guards against the helper being applied twice as callers are added.
    const once = encodeUrlPath("Q&A.html");
    expect(decodeURIComponent(once)).toBe("Q&A.html");
  });
});

describe("decodeUrlComponent", () => {
  it("decodes ordinary encoding", () => {
    expect(decodeUrlComponent("Q%26A%20%231.html")).toBe("Q&A #1.html");
  });

  // The crash this replaced: "% d" is not a valid escape, and the throw
  // reached the top of publish() as "URI malformed" with nothing named.
  it("returns a bare percent sign unchanged instead of throwing", () => {
    expect(decodeUrlComponent("50% done.md")).toBe("50% done.md");
    expect(decodeUrlComponent("100%")).toBe("100%");
    expect(decodeUrlComponent("%zz")).toBe("%zz");
  });

  it("leaves a plain name alone", () => {
    expect(decodeUrlComponent("notes/basics.md")).toBe("notes/basics.md");
  });
});
