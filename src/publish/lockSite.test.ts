import { describe, expect, it } from "vitest";
import { deriveKey, fromBase64, unlockText } from "./encrypt";
import { isPage, lockSite, staysClear } from "./lockSite";
import type { PublishFile } from "../github/client";

const FAST = 1000;

function built(): PublishFile[] {
  return [
    { path: "index.html", content: "<!doctype html><title>Acme Q3</title><nav>Clients/Acme</nav>" },
    { path: "notes/plan.html", content: "<!doctype html><title>Q3 Plan</title><p>Revenue is down.</p>" },
    { path: "assets/chart.png", content: new Uint8Array([1, 2, 3, 4]).buffer },
    { path: "assets/site.css", content: "body{}" },
    { path: "assets/site.js", content: "console.log(1)" },
    { path: "assets/font.woff2", content: new Uint8Array([9]).buffer },
    { path: ".nojekyll", content: "" },
    { path: "CNAME", content: "example.com\n" },
  ];
}

async function lockFixture() {
  const result = await lockSite(built(), "open sesame", FAST);
  const by = new Map(result.files.map((file) => [file.path, file]));
  return { result, by };
}

describe("lockSite", () => {
  /*
   * The claim the whole feature rests on: what is published carries none
   * of the writing, none of the titles and none of the vault's shape.
   *
   * Searched with the base64 fields taken out first. Ciphertext is random
   * to look at, so a short string like "Q3" turns up inside it by pure
   * chance -- which is what a first version of this test did, and it told
   * us nothing about leaking. What is worth asserting is that none of the
   * content is in the parts of the output that are actually readable.
   */
  it("publishes no readable trace of the content", async () => {
    const { result } = await lockFixture();
    const readable = result.files
      .map((file) => (typeof file.content === "string" ? file.content : ""))
      .join("\n")
      // The three base64 fields, and the payload's own quoted values.
      .replace(/"(?:data|iv|salt)":"[^"]*"/g, '"<ciphertext>"');

    for (const secret of ["Acme", "Q3", "Revenue is down", "open sesame", "plan.html"]) {
      expect(readable, secret).not.toContain(secret);
    }
  });

  /*
   * And the ciphertext itself holds none of it either, which is the other
   * half of the same claim and the one base64 noise cannot fake: the bytes
   * that come back out are only reachable through the key.
   */
  it("holds none of the plaintext in the ciphertext", async () => {
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);
    const payload = JSON.parse(
      shell.slice(
        shell.indexOf('type="application/json">') + 'type="application/json">'.length,
        shell.indexOf("</script>"),
      ),
    );

    const cipher = new TextDecoder("latin1").decode(fromBase64(payload.data));
    expect(cipher).not.toContain("Revenue is down");
    expect(cipher).not.toContain("Q3 Plan");
  });

  it("tells the reader what to do, and says nothing about the site", async () => {
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);

    expect(shell).toContain("Password needed");
    // The one thing a reader who is stuck can act on.
    expect(shell).toContain("Ask whoever sent you the link");
    // Words nobody should have to look up. The first draft of this screen
    // explained the mechanism and used all three.
    for (const jargon of ["ciphertext", "decrypt", "AES", "PBKDF2"]) {
      expect(shell.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
    expect(shell).toContain("noindex");
    expect(shell).toContain("<title>Protected</title>");
    // Not the site's own name or the page's: both are the author's wording.
    expect(shell).not.toContain("Q3 Plan");
    // Nor anything else a crawler or a shared link could read a title out of.
    expect(shell).not.toContain('name="description"');
    expect(shell).not.toContain("og:");
    // Relative to the page, so a page one folder down reaches the reader.
    expect(shell).toContain('src="../assets/unlock.js"');
  });

  it("asks nobody else for anything", async () => {
    // The stylesheet and the script of the real site are encrypted, so this
    // page carries its own. A web font would be a request to someone else's
    // server from the one page whose whole purpose is privacy.
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);

    expect(shell).not.toMatch(/https?:\/\//);
    expect(shell).not.toContain("@import");
    expect(shell).not.toContain("<link");
  });

  it("keeps every hook the unlock script reaches for", async () => {
    // `unlockScript.ts` finds exactly these by id. A redesign that renamed
    // one would publish a lock screen that cannot be unlocked.
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);

    for (const id of [
      'id="osp-locked"',
      'id="osp-unlock-form"',
      'id="osp-unlock-password"',
      'id="osp-unlock-error"',
      'id="osp-unlock-button"',
    ]) {
      expect(shell).toContain(id);
    }
    expect(shell).toContain("<noscript>");
  });

  it("ships the failure hidden, and keeps it hidden", async () => {
    // `[hidden]` is a UA rule at attribute specificity, so the class that
    // lays this row out beats it unless the stylesheet says otherwise. It
    // did, once, and put "that password did not work" on a page nobody had
    // typed into.
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);

    expect(shell).toMatch(/id="osp-unlock-error"[^>]*hidden/);
    expect(shell).toContain(".err[hidden] { display: none; }");
    expect(shell.indexOf(".err[hidden]")).toBeLessThan(shell.indexOf(".err { display: flex"));
  });

  it("separates the action from the failure, and reports the wait", async () => {
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);

    // One colour for what is wrong, another for what to press. They used
    // to be the same `--ink`.
    expect(shell).toContain("--bad:");
    expect(shell).toContain(".err { display: flex");
    expect(shell).toContain("color: var(--bad)");
    // Deriving the key is 600,000 iterations. `disabled` on the button is
    // the only hook the script sets, so everything else hangs off it.
    expect(shell).toContain("form:has(button:disabled) .track");
    expect(shell).toContain("prefers-reduced-motion");
  });

  it("gives the real document back to the right password", async () => {
    const { by } = await lockFixture();
    const shell = String(by.get("notes/plan.html")?.content);
    const payload = JSON.parse(
      shell.slice(
        shell.indexOf('type="application/json">') + 'type="application/json">'.length,
        shell.indexOf("</script>"),
      ),
    );

    const key = await deriveKey("open sesame", fromBase64(payload.salt), payload.iterations);
    const inner = JSON.parse(await unlockText(payload, key));
    expect(inner.html).toContain("Revenue is down");
    // The page is told which of its own references were encrypted, so it
    // can fetch and decrypt them once it is up.
    expect(inner.assets).toContain("assets/chart.png");
  });

  // An encrypted image cannot be fetched as an image, so it moves aside and
  // the reader finds it from the reference the page already has.
  it("moves an attachment to a .enc beside its own name", async () => {
    const { by } = await lockFixture();
    expect(by.has("assets/chart.png")).toBe(false);
    expect(by.has("assets/chart.png.enc")).toBe(true);
  });

  /*
   * The reader has to run before the password is known, and the
   * stylesheets and fonts say nothing about the vault.
   */
  it("leaves readable only what has to be readable", async () => {
    const { by } = await lockFixture();
    for (const path of [
      "assets/site.css",
      "assets/site.js",
      "assets/font.woff2",
      ".nojekyll",
      "CNAME",
      "assets/unlock.js",
    ]) {
      expect(by.has(path), path).toBe(true);
    }
    expect(String(by.get("CNAME")?.content)).toBe("example.com\n");
  });

  it("counts what it locked", async () => {
    const { result } = await lockFixture();
    expect(result.pages).toBe(2);
    expect(result.assets).toBe(1);
  });

  // One salt per build, one IV per file: the same bytes twice must not
  // produce the same ciphertext twice.
  it("uses one salt for the build and a fresh IV for every file", async () => {
    const same: PublishFile[] = [
      { path: "a.html", content: "identical" },
      { path: "b.html", content: "identical" },
    ];
    const { files } = await lockSite(same, "pw", FAST);
    const payloads = files
      .filter((file) => isPage(file.path))
      .map((file) => {
        const text = String(file.content);
        return JSON.parse(
          text.slice(
            text.indexOf('type="application/json">') + 'type="application/json">'.length,
            text.indexOf("</script>"),
          ),
        );
      });

    expect(payloads[0].salt).toBe(payloads[1].salt);
    expect(payloads[0].iv).not.toBe(payloads[1].iv);
    expect(payloads[0].data).not.toBe(payloads[1].data);
  });

  // The cost travels with the file, so raising it later strands nothing.
  it("writes the iteration count into every payload", async () => {
    const { by } = await lockFixture();
    const asset = JSON.parse(String(by.get("assets/chart.png.enc")?.content));
    expect(asset.iterations).toBe(FAST);
  });
});

describe("what gets locked", () => {
  it("knows a page from an attachment", () => {
    expect(isPage("notes/plan.html")).toBe(true);
    expect(isPage("a.htm")).toBe(true);
    expect(isPage("assets/chart.png")).toBe(false);
  });

  it("keeps the reader and the chrome readable, and nothing under assets besides", () => {
    expect(staysClear("assets/unlock.js")).toBe(true);
    expect(staysClear("assets/site.css")).toBe(true);
    expect(staysClear("assets/x.woff2")).toBe(true);
    // The attachments are the content most worth protecting, and they live
    // in the same folder as the chrome.
    expect(staysClear("assets/diagram.png")).toBe(false);
  });
});

/**
 * The screen in front of the site opens the way the site does.
 *
 * A site pinned to dark used to unlock from a prompt that followed the
 * visitor's system, so a reader on a light machine got a light page, typed
 * a password, and was dropped into a dark one. A flash of the wrong page at
 * the one moment they are looking straight at it.
 */
describe("the lock screen's opening mode", () => {
  const shellFor = async (startTheme?: "light" | "dark") => {
    const { files } = await lockSite(built(), "open sesame", FAST, startTheme);
    return String(files.find((file) => file.path === "notes/plan.html")?.content);
  };

  it("follows the visitor's system when the author chose nothing", async () => {
    const shell = await shellFor();
    const tag = shell.slice(shell.indexOf("<html"), shell.indexOf(">", shell.indexOf("<html")) + 1);
    expect(tag).toBe('<html lang="en">');
    // The media query is still what answers, so the palette is theirs.
    expect(shell).toContain("@media (prefers-color-scheme: dark)");
  });

  it("pins the prompt dark when the site opens dark", async () => {
    const shell = await shellFor("dark");
    expect(shell).toContain('<html lang="en" data-theme="dark">');
    expect(shell).toContain('[data-theme="dark"] { color-scheme: dark;');
  });

  it("pins it light, which is the half that needs the guard", async () => {
    // A light-pinned site on a dark machine would otherwise still open dark,
    // because the media query would answer first.
    const shell = await shellFor("light");
    expect(shell).toContain('<html lang="en" data-theme="light">');
    expect(shell).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])');
  });

  it("gives the two modes the same palette, from one source", async () => {
    // Emitted twice, so they can drift. They are built from one string.
    const shell = await shellFor("dark");
    const media = shell.slice(shell.indexOf(':root:not([data-theme="light"])'));
    const pinned = shell.slice(shell.indexOf('[data-theme="dark"] { color-scheme'));
    const tokens = (text: string) =>
      (text.slice(0, text.indexOf("}")).match(/--[a-z-]+: #[0-9a-f]+/g) ?? []).join(" ");
    expect(tokens(media)).not.toBe("");
    expect(tokens(media)).toBe(tokens(pinned));
  });
});
