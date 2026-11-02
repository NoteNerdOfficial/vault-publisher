import { describe, expect, it } from "vitest";
import { UNLOCK_SCRIPT } from "./unlockScript";

describe("the unlock reader", () => {
  it("is valid JavaScript", () => {
    expect(() => new Function(UNLOCK_SCRIPT)).not.toThrow();
  });

  // It goes inside a file served as a script, but the shell embeds a JSON
  // payload in a script element: a closing tag in either would end the
  // element early and spill the rest into the document as markup.
  it("carries no closing script tag", () => {
    expect(UNLOCK_SCRIPT.toLowerCase()).not.toContain("</script");
  });

  /*
   * The regression this exists for.
   *
   * `document.open` is specified to do nothing while a parser is still
   * active, and the automatic unlock -- the one that runs when the key is
   * already in this tab -- starts during parsing. It failed silently: no
   * error, no page, just the form still sitting there, while typing the
   * password worked because a submit always happens after the load.
   */
  it("waits for the parser before replacing the document", () => {
    expect(UNLOCK_SCRIPT).toContain('document.readyState === "loading"');
    expect(UNLOCK_SCRIPT).toContain("DOMContentLoaded");
  });

  // Per tab, and the derived bits rather than the password: what is sitting
  // there cannot be typed into anything else.
  it("caches a key for the tab and never the password", () => {
    expect(UNLOCK_SCRIPT).toContain("sessionStorage");
    expect(UNLOCK_SCRIPT).not.toContain("localStorage");
    expect(UNLOCK_SCRIPT).toContain("deriveBits");
  });

  // A wrong password and a damaged file fail identically, because AES-GCM
  // authenticates. The cached key is dropped either way, or a bad one would
  // keep failing silently on every page.
  it("forgets a key that stops working", () => {
    expect(UNLOCK_SCRIPT).toContain("removeItem");
  });

  // The cost is carried by the payload, so a site published before the
  // figure was raised still opens.
  it("derives from what the payload says rather than its own figure", () => {
    expect(UNLOCK_SCRIPT).toContain("payload.iterations");
    expect(UNLOCK_SCRIPT).not.toMatch(/iterations:\s*\d/);
  });
});
