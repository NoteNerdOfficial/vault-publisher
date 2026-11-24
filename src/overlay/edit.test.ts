import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STAMP_ATTR,
  applyEdits,
  EditRequest,
  deletionRange,
  elementAt,
  linkedStylesheets,
  planCssRule,
  hashText,
  invertEdits,
  lineAt,
  ruleStart,
  planOp,
  insertMarkup,
  prepareForEditing,
  shiftStamp,
  shiftsOf,
} from "./edit";
import { EditStore, ReviewServer, ReviewStore, editRequest } from "./server";
import { parse } from "parse5";
import { asIsPageContent } from "../publish/buildSite";

/**
 * The edit notch's file half: naming elements by where they start, and
 * turning "delete this" or "hide this" into the smallest change to the file.
 */

const PAGE = [
  "<!doctype html>",
  "<html>",
  "<head><title>Deck</title></head>",
  "<body>",
  "  <section class=\"slide\">",
  "    <h1>Title</h1>",
  "    <p>One<p>Two",
  "    <table><tr><td>cell</td></tr></table>",
  "    <img src=\"a.png\"/>",
  "  </section>",
  "</body>",
  "</html>",
  "",
].join("\n");

function stamps(html: string): number[] {
  return [...html.matchAll(new RegExp(`${STAMP_ATTR}="(\\d+)"`, "g"))].map((m) => Number(m[1]));
}

function offsetOf(source: string, needle: string): number {
  const at = source.indexOf(needle);
  if (at === -1) throw new Error(`no ${needle}`);
  return at;
}

describe("prepareForEditing", () => {
  it("stamps every element under body with where its start tag begins", () => {
    const out = prepareForEditing(PAGE, "<script>x</script>");
    const found = stamps(out);
    for (const at of found) expect(PAGE[at]).toBe("<");
    expect(found).toContain(offsetOf(PAGE, "<section"));
    expect(found).toContain(offsetOf(PAGE, "<h1>"));
    expect(found).toContain(offsetOf(PAGE, "<td>"));
  });

  it("leaves the head, the body, and elements the parser invented alone", () => {
    const out = prepareForEditing(PAGE, "");
    expect(out).toContain("<title>Deck</title>");
    expect(out).toContain("<body>\n");
    // The browser adds a <tbody>; the file has none, so nothing names one.
    expect(out).not.toContain("<tbody");
    expect(stamps(out)).toHaveLength(8);
  });

  it("puts the script first in head, so it runs before the page's own", () => {
    const out = prepareForEditing(PAGE, "<script>boot</script>");
    expect(out).toContain("<head><script>boot</script><title>");
  });

  it("never puts anything ahead of the doctype", () => {
    const out = prepareForEditing("<!doctype html><p>bare</p>", "<script>boot</script>");
    expect(out.startsWith("<!doctype html><script>boot</script>")).toBe(true);
  });

  it("only injects when told not to stamp", () => {
    const out = prepareForEditing(PAGE, "<script>boot</script>", { stamp: false });
    expect(stamps(out)).toHaveLength(0);
    expect(out).toContain("<script>boot</script>");
  });

  it("counts offsets the way the file is indexed, line endings and emoji included", () => {
    const source = "<!doctype html>\r\n<body>\r\n<p>🎉 one</p>\r\n<p>two</p>\r\n</body>";
    const out = prepareForEditing(source, "");
    expect(stamps(out)).toEqual([offsetOf(source, "<p>🎉"), offsetOf(source, "<p>two")]);
  });
});

describe("planOp", () => {
  it("deletes an element along with the line it had to itself", () => {
    const plan = planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<h1>") });
    if (!plan.ok) throw new Error(plan.error);
    const next = applyEdits(PAGE, plan.edits);
    expect(next).toContain('<section class="slide">\n    <p>One');
    expect(next).not.toContain("Title");
  });

  it("deletes only the element when it shares its line", () => {
    const plan = planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<p>Two") });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(PAGE, plan.edits)).toContain("    <p>One\n    <table>");
  });

  it("deletes an element with all of its children", () => {
    const plan = planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<section") });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(PAGE, plan.edits)).toBe(PAGE.replace(/ {2}<section[\s\S]*<\/section>\n/, ""));
  });

  it("hides with a new style attribute, before a self-closing slash", () => {
    const plan = planOp(PAGE, { op: "hide", at: offsetOf(PAGE, "<img") });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(PAGE, plan.edits)).toContain('<img src="a.png" style="display: none"/>');
  });

  it("hides by adding to a style that is already there, keeping its quotes readable", () => {
    const source = `<body><div style='font-family: "Inter"; color: red;'>x</div></body>`;
    const plan = planOp(source, { op: "hide", at: offsetOf(source, "<div") });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(source, plan.edits)).toBe(
      `<body><div style='font-family: "Inter"; color: red; display: none'>x</div></body>`,
    );
  });

  it("refuses an offset that names no element", () => {
    const plan = planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "Title") });
    expect(plan.ok).toBe(false);
  });

  it("refuses the body and the head", () => {
    expect(planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<body>") }).ok).toBe(false);
    expect(planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<title>") }).ok).toBe(false);
  });
});

/*
 * What the page does after an edit, worked here on plain numbers: every stamp
 * shifted, except the subtree that was moved or copied, which is re-stamped
 * by the relocation. It has to land on exactly the stamps a fresh serve of
 * the edited file would hand out, or the next edit names the wrong element.
 */
function pageStampsAfter(source: string, request: EditRequest): { next: string; page: number[] } {
  const plan = planOp(source, request);
  if (!plan.ok) throw new Error(plan.error);
  const next = applyEdits(source, plan.edits);
  const shifts = shiftsOf(plan.edits);
  const before = stamps(prepareForEditing(source, ""));
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const moved = request.op === "move" || request.op === "duplicate";
  const el = elementAt(doc, (request as { at: number }).at)!;
  const [from, to] = [el.sourceCodeLocation!.startOffset, el.sourceCodeLocation!.endOffset];
  const inside = (at: number) => at >= from && at < to;

  const page: number[] = [];
  for (const at of before) {
    if (moved && inside(at)) {
      const pair = plan.relocated!.find(([from]) => from === at);
      if (!pair) throw new Error(`no relocation for ${at}`);
      page.push(pair[1]);
      if (request.op === "duplicate") page.push(at);
      continue;
    }
    const shifted = shiftStamp(at, shifts);
    if (shifted !== null) page.push(shifted);
  }
  return { next, page: page.sort((a, b) => a - b) };
}

const LIST = [
  "<body>",
  "  <ul class=\"a\">",
  "    <li>One</li>",
  "    <li>Two <b>bold</b></li>",
  "    <li>Three</li>",
  "  </ul>",
  "  <div class=\"row\"><span>x</span><span>y</span></div>",
  "  <section>",
  "    <h2>Other</h2>",
  "  </section>",
  "</body>",
].join("\n");

describe("duplicate, move and text", () => {
  it("duplicates an element onto a line of its own beneath it", () => {
    const at = offsetOf(LIST, "<li>Two");
    const { next, page } = pageStampsAfter(LIST, { op: "duplicate", at });
    expect(next).toContain("    <li>Two <b>bold</b></li>\n    <li>Two <b>bold</b></li>\n    <li>Three");
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("duplicates an inline element right after itself", () => {
    const { next, page } = pageStampsAfter(LIST, { op: "duplicate", at: offsetOf(LIST, "<span>y") });
    expect(next).toContain("<span>x</span><span>y</span><span>y</span></div>");
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("duplicates the last line of a file that has no final newline", () => {
    const source = "<body>\n<p>a</p>";
    const { next, page } = pageStampsAfter(source, { op: "duplicate", at: offsetOf(source, "<p>") });
    expect(next).toBe("<body>\n<p>a</p>\n<p>a</p>");
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it.each([
    ["down past the next item", "<li>One", "<li>Two", "after", ["Two", "One", "Three"]],
    ["up to the top", "<li>Three", "<li>One", "before", ["Three", "One", "Two"]],
    ["to the end", "<li>One", "<li>Three", "after", ["Two", "Three", "One"]],
  ] as const)("moves a list item %s", (_why, what, target, place, order) => {
    const { next, page } = pageStampsAfter(LIST, {
      op: "move",
      at: offsetOf(LIST, what),
      target: offsetOf(LIST, target),
      place,
    });
    const items = [...next.matchAll(/<li>(\w+)/g)].map((m) => m[1]);
    expect(items).toEqual(order);
    expect(next).toMatch(/\n {4}<li>/);
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("moves an element into another container, at that container's depth", () => {
    const { next, page } = pageStampsAfter(LIST, {
      op: "move",
      at: offsetOf(LIST, "<ul"),
      target: offsetOf(LIST, "<h2>"),
      place: "after",
    });
    expect(next).toContain("    <h2>Other</h2>\n    <ul class=\"a\">\n      <li>One</li>");
    expect(next).not.toMatch(/^ {2}<ul/m);
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("reorders inline siblings in place", () => {
    const { next, page } = pageStampsAfter(LIST, {
      op: "move",
      at: offsetOf(LIST, "<span>y"),
      target: offsetOf(LIST, "<span>x"),
      place: "before",
    });
    expect(next).toContain('<div class="row"><span>y</span><span>x</span></div>');
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("will not move an element inside itself", () => {
    const plan = planOp(LIST, {
      op: "move",
      at: offsetOf(LIST, "<ul"),
      target: offsetOf(LIST, "<li>Two"),
      place: "after",
    });
    expect(plan.ok).toBe(false);
  });

  it("rewrites only the words, keeping the file's spacing and escaping markup", () => {
    const source = "<body>\n  <h1>\n    Old title\n  </h1>\n</body>";
    const plan = planOp(source, { op: "text", at: offsetOf(source, "<h1>"), text: "  Fish & <chips>  " });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(source, plan.edits)).toBe("<body>\n  <h1>\n    Fish &amp; &lt;chips&gt;\n  </h1>\n</body>");
  });

  it("will not rewrite an element that holds other elements, or a script", () => {
    expect(planOp(LIST, { op: "text", at: offsetOf(LIST, "<li>Two"), text: "x" }).ok).toBe(false);
    const source = "<body><script>let a = 1</script></body>";
    expect(planOp(source, { op: "text", at: offsetOf(source, "<script>"), text: "x" }).ok).toBe(false);
  });

  it("inverts every kind of edit back to the original", () => {
    const requests: EditRequest[] = [
      { op: "duplicate", at: offsetOf(LIST, "<li>Two") },
      { op: "move", at: offsetOf(LIST, "<li>One"), target: offsetOf(LIST, "<li>Three"), place: "after" },
      { op: "move", at: offsetOf(LIST, "<ul"), target: offsetOf(LIST, "<h2>"), place: "before" },
      { op: "text", at: offsetOf(LIST, "<li>One"), text: "Uno" },
    ];
    for (const request of requests) {
      const plan = planOp(LIST, request);
      if (!plan.ok) throw new Error(plan.error);
      const next = applyEdits(LIST, plan.edits);
      expect(applyEdits(next, invertEdits(LIST, plan.edits))).toBe(LIST);
    }
  });
});

describe("editRequest", () => {
  it("accepts each shape and refuses anything else", () => {
    expect(editRequest({ op: "move", at: 1, target: 2, place: "after" })).toEqual({
      op: "move",
      at: 1,
      target: 2,
      place: "after",
    });
    expect(editRequest({ op: "text", at: 1, text: "hi" })).toEqual({ op: "text", at: 1, text: "hi" });
    expect(typeof editRequest({ op: "move", at: 1, target: 2, place: "within" })).toBe("string");
    expect(typeof editRequest({ op: "text", at: 1 })).toBe("string");
    expect(typeof editRequest({ op: "rename", at: 1 })).toBe("string");
    expect(typeof editRequest({ op: "delete", at: -1 })).toBe("string");
  });

  it("checks every declaration, selector and condition a style request carries", () => {
    expect(editRequest({ op: "inline-style", at: 3, props: [["color", "#fff"], ["width", "10px"]] })).toEqual({
      op: "inline-style",
      at: 3,
      props: [["color", "#fff"], ["width", "10px"]],
    });
    expect(editRequest({ op: "add-rule", sheet: null, selector: "li.todo", props: [["color", "red"]], media: "(max-width: 600px)" })).toEqual({
      op: "add-rule",
      sheet: null,
      selector: "li.todo",
      props: [["color", "red"]],
      media: "(max-width: 600px)",
    });
    const refused = [
      { op: "inline-style", at: 3, props: [] },
      { op: "inline-style", at: 3, props: [["color", "red;x:y"]] },
      { op: "inline-style", at: 3, props: [["co lor", "red"]] },
      { op: "inline-style", at: 3, props: Array.from({ length: 33 }, () => ["color", "red"]) },
      { op: "rule-style", sheet: 1, path: [], selector: "a", props: [["color", "red"]] },
      { op: "add-rule", sheet: null, selector: "a{}", props: [["color", "red"]] },
      { op: "add-rule", sheet: null, selector: "a", props: [["color", "red"]], media: "screen" },
    ];
    for (const body of refused) expect(typeof editRequest(body)).toBe("string");
  });
});

describe("undo and the stamps that move", () => {
  it("inverts an edit back to the original text", () => {
    for (const [op, needle] of [
      ["delete", "<h1>"],
      ["hide", "<img"],
      ["delete", "<section"],
    ] as const) {
      const plan = planOp(PAGE, { op, at: offsetOf(PAGE, needle) });
      if (!plan.ok) throw new Error(plan.error);
      const next = applyEdits(PAGE, plan.edits);
      expect(applyEdits(next, invertEdits(PAGE, plan.edits))).toBe(PAGE);
    }
  });

  it("moves every stamp to where its element starts in the edited file", () => {
    const plan = planOp(PAGE, { op: "delete", at: offsetOf(PAGE, "<h1>") });
    if (!plan.ok) throw new Error(plan.error);
    const next = applyEdits(PAGE, plan.edits);
    const shifts = shiftsOf(plan.edits);

    const before = stamps(prepareForEditing(PAGE, ""));
    const after = stamps(prepareForEditing(next, ""));
    const moved = before.map((at) => shiftStamp(at, shifts)).filter((at) => at !== null);
    expect(moved).toEqual(after);
    expect(shiftStamp(offsetOf(PAGE, "<h1>"), shifts)).toBeNull();
  });

  it("moves stamps after an insertion, and not those before it", () => {
    expect(shiftStamp(10, [{ start: 20, end: 20, length: 5 }])).toBe(10);
    expect(shiftStamp(20, [{ start: 20, end: 20, length: 5 }])).toBe(25);
    expect(shiftStamp(30, [{ start: 20, end: 20, length: 5 }])).toBe(35);
  });

  it("keeps the whole line only when the element owns it", () => {
    const source = "a\n  <b>x</b>  \nc";
    expect(deletionRange(source, 4, 12)).toEqual([2, 15]);
    expect(deletionRange("a <b>x</b> c", 2, 10)).toEqual([2, 10]);
  });
});

describe("a published page", () => {
  it("never carries the edit notch, whatever the overlay settings", () => {
    const html = "<!doctype html><html><head></head><body><p>hi</p></body></html>";
    for (const published of [false, true]) {
      const out = asIsPageContent(
        html,
        { url: "proto/index.html", sourcePath: "Protos/index.html" },
        {
          siteName: "Site",
          previewBuild: !published,
          reviewOverlay: { reviewer: "R", published },
        } as Parameters<typeof asIsPageContent>[2],
      );
      expect(out).not.toContain(STAMP_ATTR);
      expect(out).not.toContain("data-osp-edit");
      expect(out).not.toContain("__ospEditBoot");
    }
  });
});

/* --- the server routes -------------------------------------------------- */

const fetch = (url: string | URL, init: RequestInit = {}): Promise<Response> =>
  globalThis.fetch(url, {
    ...init,
    headers: { connection: "close", ...(init.headers as Record<string, string>) },
  });

const APPENDIX = "\n<!-- osp-review:start -->\n<script>overlay</script>\n<!-- osp-review:end -->\n";

describe("the edit routes", () => {
  const TOKEN = "edit-token";
  let server: ReviewServer;
  let base: string;
  let vault: Record<string, string>;
  let preview: Record<string, string>;
  let backups: string[];

  const reviewStore: ReviewStore = {
    readComments: async () => null,
    writeComments: async () => {},
    readPages: async () => null,
    readPreview: async (path) => preview[path] ?? null,
  };

  const editStore: EditStore = {
    sourceFor: (path) => (path === "proto/index.html" ? "Protos/deck.html" : null),
    readSource: async (path) => vault[path] ?? null,
    writeSource: async (path, text) => {
      vault[path] = text;
    },
    writePreview: async (path, text) => {
      preview[path] = text;
    },
    backup: async (path, text) => {
      backups.push(`${path}:${text.length}`);
    },
  };

  beforeEach(async () => {
    vault = { "Protos/deck.html": PAGE };
    preview = { "proto/index.html": PAGE + APPENDIX, "notes/plan.html": "<h1>Plan</h1>" };
    backups = [];
    server = new ReviewServer({ store: reviewStore, edit: editStore, token: TOKEN });
    const address = await server.start();
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie: `osp-review=${TOKEN}` } });
  const edit = (body: unknown) =>
    fetch(`${base}/api/edit`, {
      method: "POST",
      headers: { cookie: `osp-review=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("serves an as-is page stamped, with the edit script and the appendix", async () => {
    const html = await (await get("/proto/index.html")).text();
    expect(stamps(html).length).toBeGreaterThan(0);
    expect(html).toContain("__ospEditBoot");
    expect(html).toContain(hashText(PAGE));
    expect(html.endsWith(APPENDIX)).toBe(true);
  });

  it("serves every other page exactly as built", async () => {
    expect(await (await get("/notes/plan.html")).text()).toBe("<h1>Plan</h1>");
  });

  it("serves a page whose file moved on unstamped, saying why", async () => {
    vault["Protos/deck.html"] = PAGE.replace("Title", "Changed");
    const html = await (await get("/proto/index.html")).text();
    expect(stamps(html)).toHaveLength(0);
    expect(html).toContain('"ok":false');
    expect(html).toContain("Rebuild the preview");
  });

  it("deletes from the vault file and the preview, backs up once, and undoes", async () => {
    const at = offsetOf(PAGE, "<h1>");
    const first = await edit({ page: "proto/index.html", hash: hashText(PAGE), op: "delete", at });
    expect(first.status).toBe(200);
    const done = (await first.json()) as { id: string; hash: string; edits: unknown[] };
    expect(vault["Protos/deck.html"]).not.toContain("Title");
    expect(preview["proto/index.html"]).toBe(vault["Protos/deck.html"] + APPENDIX);
    expect(done.hash).toBe(hashText(vault["Protos/deck.html"]));
    expect(backups).toEqual([`Protos/deck.html:${PAGE.length}`]);

    const hide = await edit({
      page: "proto/index.html",
      hash: done.hash,
      op: "hide",
      at: shiftStamp(offsetOf(PAGE, "<img"), done.edits as never),
    });
    expect(hide.status).toBe(200);
    const hidden = (await hide.json()) as { id: string; hash: string };
    expect(vault["Protos/deck.html"]).toContain('style="display: none"');
    expect(backups).toHaveLength(1);

    const undoHide = await edit({ page: "proto/index.html", hash: hidden.hash, op: "undo", id: hidden.id });
    const afterHide = (await undoHide.json()) as { hash: string };
    const undoDelete = await edit({ page: "proto/index.html", hash: afterHide.hash, op: "undo", id: done.id });
    expect(undoDelete.status).toBe(200);
    expect(vault["Protos/deck.html"]).toBe(PAGE);
    expect(preview["proto/index.html"]).toBe(PAGE + APPENDIX);
  });

  it("duplicates, moves and retypes through the route, and undoes all three", async () => {
    let hash = hashText(PAGE);
    const ids: string[] = [];
    const run = async (body: Record<string, unknown>) => {
      const response = await edit({ page: "proto/index.html", hash, ...body });
      expect(response.status).toBe(200);
      const done = (await response.json()) as { id: string; hash: string; relocated?: Array<[number, number]> };
      hash = done.hash;
      if (done.id && body.op !== "undo" && body.op !== "redo") ids.push(done.id);
      return done;
    };

    const copy = await run({ op: "duplicate", at: offsetOf(PAGE, "<h1>") });
    expect(copy.relocated).toHaveLength(1);
    expect(vault["Protos/deck.html"]).toContain("    <h1>Title</h1>\n    <h1>Title</h1>\n");

    const now = () => vault["Protos/deck.html"];
    await run({ op: "move", at: now().indexOf("<img"), target: now().indexOf("<h1>"), place: "before" });
    expect(now()).toMatch(/<section class="slide">\n {4}<img src="a.png"\/>\n {4}<h1>/);

    await run({ op: "text", at: now().indexOf("<h1>"), text: "Renamed" });
    expect(now()).toContain("<h1>Renamed</h1>");
    expect(preview["proto/index.html"]).toBe(now() + APPENDIX);

    for (const id of ids.reverse()) await run({ op: "undo", id });
    expect(now()).toBe(PAGE);
  });

  it("refuses an edit made against a file that has since changed", async () => {
    vault["Protos/deck.html"] = PAGE + "<!-- edited elsewhere -->";
    const response = await edit({
      page: "proto/index.html",
      hash: hashText(PAGE),
      op: "delete",
      at: offsetOf(PAGE, "<h1>"),
    });
    expect(response.status).toBe(409);
    expect(vault["Protos/deck.html"]).toBe(PAGE + "<!-- edited elsewhere -->");
  });

  it("refuses an undo that is not the last edit", async () => {
    const response = await edit({ page: "proto/index.html", hash: hashText(PAGE), op: "undo", id: "e99" });
    expect(response.status).toBe(409);
    expect(vault["Protos/deck.html"]).toBe(PAGE);
  });

  it("refuses a page with no vault file behind it", async () => {
    const response = await edit({ page: "notes/plan.html", hash: "", op: "delete", at: 0 });
    expect(response.status).toBe(404);
  });

  it("refuses an edit without the token", async () => {
    const response = await fetch(`${base}/api/edit`, {
      method: "POST",
      body: JSON.stringify({ page: "proto/index.html", hash: hashText(PAGE), op: "delete", at: 0 }),
    });
    expect(response.status).toBe(403);
    expect(vault["Protos/deck.html"]).toBe(PAGE);
  });

  it("has no edit route at all without an edit store", async () => {
    const bare = new ReviewServer({ store: reviewStore, token: TOKEN });
    const address = await bare.start();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/edit`, {
        method: "POST",
        headers: { cookie: `osp-review=${TOKEN}` },
        body: "{}",
      });
      expect(response.status).toBe(405);
      const page = await fetch(`http://127.0.0.1:${address.port}/proto/index.html`, {
        headers: { cookie: `osp-review=${TOKEN}` },
      });
      expect(await page.text()).toBe(PAGE + APPENDIX);
    } finally {
      await bare.stop();
    }
  });
});

describe("moving inside, retyping around markup, linked sheets", () => {
  const BOX = ["<body>", "  <section>", "    <h2>Title</h2>", "  </section>", '  <div class="empty">', "  </div>", '  <p class="inline"></p>', "</body>"].join("\n");

  it("moves an element into an empty container, on its own line one step in", () => {
    const { next, page } = pageStampsAfter(BOX, {
      op: "move",
      at: offsetOf(BOX, "<h2>"),
      target: offsetOf(BOX, '<div class="empty">'),
      place: "inside",
    });
    expect(next).toContain('  <div class="empty">\n    <h2>Title</h2>\n  </div>');
    expect(next).toContain("  <section>\n  </section>");
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("moves into a container written on one line, inline", () => {
    const { next, page } = pageStampsAfter(BOX, {
      op: "move",
      at: offsetOf(BOX, "<h2>"),
      target: offsetOf(BOX, '<p class="inline">'),
      place: "inside",
    });
    expect(next).toContain('<p class="inline"><h2>Title</h2></p>');
    expect(page).toEqual(stamps(prepareForEditing(next, "")));
  });

  it("retypes words beside inline markup and keeps the markup", () => {
    const source = '<body><p>Read <a href="/x">the <b>full</b> guide</a> &amp; more.</p></body>';
    const plan = planOp(source, {
      op: "texts",
      at: offsetOf(source, "<p>"),
      texts: ["Open ", "the ", "short", " notes", " & less."],
    });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(source, plan.edits)).toBe(
      '<body><p>Open <a href="/x">the <b>short</b> notes</a> &amp; less.</p></body>',
    );
  });

  it("refuses an edit that changed the markup, not only the words", () => {
    const source = "<body><p>One <b>two</b> three</p></body>";
    const plan = planOp(source, { op: "texts", at: offsetOf(source, "<p>"), texts: ["One two three"] });
    expect(plan.ok).toBe(false);
    const block = "<body><p>One <div>two</div></p></body>";
    expect(planOp(block, { op: "texts", at: offsetOf(block, "<p>"), texts: ["One ", "two"] }).ok).toBe(false);
  });

  it("finds the stylesheets a page links, beside it and above it", () => {
    const source = [
      '<head><link rel="stylesheet" href="style.css">',
      '<link rel="stylesheet" href="../shared/base.css?v=2">',
      '<link rel="stylesheet" href="https://cdn.example/x.css">',
      '<link rel="icon" href="icon.png">',
      '<link rel="stylesheet" href="../../../escape.css"></head>',
    ].join("");
    expect(linkedStylesheets(source, "protos/app/index.html")).toEqual(["protos/app/style.css", "protos/shared/base.css"]);
  });

  it("edits a rule in a stylesheet file", () => {
    const css = ".card {\n  color: red;\n}\n";
    const plan = planCssRule(css, [0], ".card", [["color", "#123"]]);
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(css, plan.edits)).toBe(".card {\n  color: #123;\n}\n");
  });
});

describe("history and linked sheets through the route", () => {
  const TOKEN = "history-token";
  const HTML = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>\n  <h1>Title</h1>\n  <p>Body</p>\n</body></html>';
  const CSS = "h1 {\n  color: red;\n}\n";
  let server: ReviewServer;
  let base: string;
  let vault: Record<string, string>;
  let preview: Record<string, string>;

  beforeEach(async () => {
    vault = { "P/index.html": HTML, "P/style.css": CSS };
    preview = { "p/index.html": HTML, "p/style.css": CSS };
    const sources: Record<string, string> = { "p/index.html": "P/index.html", "p/style.css": "P/style.css" };
    server = new ReviewServer({
      token: TOKEN,
      store: {
        readComments: async () => null,
        writeComments: async () => {},
        readPages: async () => null,
        readPreview: async (path) => preview[path] ?? null,
      },
      edit: {
        sourceFor: (path) => sources[path] ?? null,
        readSource: async (path) => vault[path] ?? null,
        writeSource: async (path, text) => {
          vault[path] = text;
        },
        writePreview: async (path, text) => {
          preview[path] = text;
        },
        backup: async () => {},
      },
    });
    base = `http://127.0.0.1:${(await server.start()).port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const call = async (body: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/edit`, {
      method: "POST",
      headers: { cookie: `osp-review=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ page: "p/index.html", ...body }),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };

  it("says where a layer and its rules are, by file and line", async () => {
    const response = await fetch(`${base}/api/where`, {
      method: "POST",
      headers: { cookie: `osp-review=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        page: "p/index.html",
        hash: hashText(HTML),
        at: HTML.indexOf("<p>"),
        rules: [{ sheet: "p/style.css", path: [0], selector: "h1" }, { sheet: "elsewhere.css", path: [0], selector: "h1" }],
      }),
    });
    expect(await response.json()).toEqual({
      layer: { file: "P/index.html", line: 3, column: 3, editor: null, editorName: null },
      rules: [{ file: "P/style.css", line: 1, column: 1, editor: null, editorName: null }, null],
    });
    const stale = await fetch(`${base}/api/where`, {
      method: "POST",
      headers: { cookie: `osp-review=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ page: "p/index.html", hash: "old", at: 0 }),
    });
    expect(stale.status).toBe(409);
  });

  it("redoes what was undone, and forgets it once something new is done", async () => {
    let hash = hashText(HTML);
    const del = await call({ hash, op: "delete", at: HTML.indexOf("<h1>") });
    hash = del.data.hash as string;
    const undo = await call({ hash, op: "undo", id: del.data.id });
    expect(vault["P/index.html"]).toBe(HTML);
    expect(undo.data).toMatchObject({ undo: 0, redo: 1 });
    hash = undo.data.hash as string;

    const redo = await call({ hash, op: "redo", id: del.data.id });
    expect(redo.status).toBe(200);
    expect(vault["P/index.html"]).not.toContain("<h1>");
    expect(redo.data).toMatchObject({ undo: 1, redo: 0 });
    hash = redo.data.hash as string;

    const back = await call({ hash, op: "undo", id: del.data.id });
    hash = back.data.hash as string;
    const other = await call({ hash, op: "hide", at: HTML.indexOf("<p>") });
    expect(other.data).toMatchObject({ redo: 0 });
  });

  it("undoes blind for a page that reloaded, and tells it to reload", async () => {
    const del = await call({ hash: hashText(HTML), op: "delete", at: HTML.indexOf("<h1>") });
    const page = await (await fetch(`${base}/p/index.html`, { headers: { cookie: `osp-review=${TOKEN}` } })).text();
    expect(page).toContain('"history":{"undo":1,"redo":0}');
    const blind = await call({ hash: del.data.hash, op: "undo" });
    expect(blind.status).toBe(200);
    expect(blind.data.reload).toBe(true);
    expect(vault["P/index.html"]).toBe(HTML);
  });

  it("edits a rule in the page's linked stylesheet, and undoes it from the page", async () => {
    const page = await (await fetch(`${base}/p/index.html`, { headers: { cookie: `osp-review=${TOKEN}` } })).text();
    expect(page).toContain('"sheets":["p/style.css"]');
    const hash = hashText(HTML);
    const set = await call({ hash, op: "rule-style", sheet: "p/style.css", path: [0], selector: "h1", props: [["color", "#0a0"]] });
    expect(set.status).toBe(200);
    expect(vault["P/style.css"]).toBe("h1 {\n  color: #0a0;\n}\n");
    expect(preview["p/style.css"]).toBe(vault["P/style.css"]);
    // The page's own file did not change, so its stamps and hash stand.
    expect(set.data).toMatchObject({ hash, edits: [] });

    await call({ hash, op: "undo", id: set.data.id });
    expect(vault["P/style.css"]).toBe(CSS);
  });

  it("refuses a stylesheet the page does not link", async () => {
    const refused = await call({ hash: hashText(HTML), op: "rule-style", sheet: "q/other.css", path: [0], selector: "h1", props: [["color", "red"]] });
    expect(refused.status).toBe(404);
  });
});

/**
 * Every stamp the page would hold after an edit, worked out the way the
 * page does it, against the stamps a fresh load of the new file would get.
 */
function stampsAgree(source: string, request: EditRequest, keepOriginals = false): string {
  const plan = planOp(source, request);
  if (!plan.ok) throw new Error(plan.error);
  const next = applyEdits(source, plan.edits);
  const shifts = shiftsOf(plan.edits);
  const moved = new Map(plan.relocated ?? []);
  const page: number[] = [];
  for (const at of stamps(prepareForEditing(source, ""))) {
    if (moved.has(at)) {
      page.push(moved.get(at)!);
      if (keepOriginals) page.push(shiftStamp(at, shifts)!);
      continue;
    }
    const shifted = shiftStamp(at, shifts);
    if (shifted !== null) page.push(shifted);
  }
  if (plan.created !== undefined) page.push(plan.created);
  expect([...new Set(page)].sort((a, b) => a - b)).toEqual(stamps(prepareForEditing(next, "")).sort((a, b) => a - b));
  return next;
}

describe("frame selection, ungroup, insert and paste", () => {
  it("wraps sibling lines in an auto layout frame, one step in", () => {
    const next = stampsAgree(LIST, {
      op: "wrap",
      at: offsetOf(LIST, "<li>One"),
      last: offsetOf(LIST, "<li>Two"),
      props: [["display", "flex"], ["gap", "8px"]],
    });
    expect(next).toContain(
      '  <ul class="a">\n    <div style="display: flex; gap: 8px">\n      <li>One</li>\n      <li>Two <b>bold</b></li>\n    </div>\n    <li>Three</li>',
    );
  });

  it("wraps inline siblings in place", () => {
    const next = stampsAgree(LIST, {
      op: "wrap",
      at: offsetOf(LIST, "<span>x"),
      last: offsetOf(LIST, "<span>y"),
      props: [["display", "flex"]],
    });
    expect(next).toContain('<div class="row"><div style="display: flex"><span>x</span><span>y</span></div></div>');
  });

  it("will not frame layers from different parents", () => {
    const plan = planOp(LIST, { op: "wrap", at: offsetOf(LIST, "<li>One"), last: offsetOf(LIST, "<h2>"), props: [] });
    expect(plan.ok).toBe(false);
  });

  it("ungroups a frame, its children moving out a step", () => {
    const next = stampsAgree(LIST, { op: "unwrap", at: offsetOf(LIST, "<ul") });
    expect(next).toContain("<body>\n  <li>One</li>\n  <li>Two <b>bold</b></li>\n  <li>Three</li>\n  <div class=\"row\">");
  });

  it("ungroups an inline frame", () => {
    const next = stampsAgree(LIST, { op: "unwrap", at: offsetOf(LIST, '<div class="row">') });
    expect(next).toContain("  <span>x</span><span>y</span>\n  <section>");
  });

  it("inserts a rectangle after a layer, a text inside a frame, and an image at the end of the page", () => {
    const rect = stampsAgree(LIST, { op: "insert", at: offsetOf(LIST, "<li>Three"), place: "after", kind: "rect" });
    expect(rect).toContain(
      '    <li>Three</li>\n    <div style="width: 100px; height: 100px; background-color: #d9d9d9"></div>\n  </ul>',
    );
    const text = stampsAgree(LIST, { op: "insert", at: offsetOf(LIST, "<section"), place: "inside", kind: "text" });
    expect(text).toContain("    <h2>Other</h2>\n    <p>Text</p>\n  </section>");
    const image = stampsAgree(LIST, { op: "insert", at: null, place: "inside", kind: "image", src: "img/cat.png" });
    expect(image).toContain('  <img src="img/cat.png" alt="" style="width: 240px; height: auto">\n</body>');
  });

  it("inserts the pieces a prototype is made of, in the page's own classes", () => {
    const at = offsetOf(LIST, "<li>Three");
    const button = stampsAgree(LIST, { op: "insert", at, place: "after", kind: "button", like: { cls: "btn btn-primary" } });
    expect(button).toContain('    <li>Three</li>\n    <button type="button" class="btn btn-primary">Button</button>\n');
    const heading = stampsAgree(LIST, { op: "insert", at, place: "before", kind: "heading", like: { tag: "h3", cls: "title" } });
    expect(heading).toContain('    <h3 class="title">Heading</h3>\n    <li>Three</li>');
    // A list's items are stamped by the page from the markup's fixed shape,
    // so only the list itself comes back as created.
    const plan = planOp(LIST, { op: "insert", at, place: "after", kind: "list" });
    if (!plan.ok) throw new Error(plan.error);
    const list = applyEdits(LIST, plan.edits);
    expect(list.slice(plan.created!)).toMatch(/^<ul><li>Item<\/li><li>Item<\/li><li>Item<\/li><\/ul>\n/);
    const items = stamps(prepareForEditing(list, "")).filter((n) => n > plan.created!).slice(0, 3);
    expect(items).toEqual([4, 17, 30].map((d) => plan.created! + d));
    expect(insertMarkup("link")).toBe('<a href="#">Link</a>');
    expect(insertMarkup("input", { like: { cls: "field" } })).toBe('<input class="field" placeholder="Placeholder">');
    expect(insertMarkup("divider")).toBe("<hr>");
  });

  it("gives a drawn frame its size in place of its minimum height", () => {
    expect(insertMarkup("frame", { props: [["width", "240px"], ["height", "120px"]] })).toBe(
      '<div style="display: flex; flex-direction: column; gap: 8px; padding: 16px; background-color: #ffffff; width: 240px; height: 120px"></div>',
    );
    expect(insertMarkup("rect", { props: [["width", "40px"], ["height", "30px"]] })).toBe(
      '<div style="background-color: #d9d9d9; width: 40px; height: 30px"></div>',
    );
  });

  it("pastes a copy of a layer into another frame, leaving the original", () => {
    const next = stampsAgree(
      LIST,
      { op: "copy", at: offsetOf(LIST, "<li>Two"), target: offsetOf(LIST, "<h2>"), place: "after" },
      true,
    );
    expect(next).toContain("    <li>Two <b>bold</b></li>\n    <li>Three</li>");
    expect(next).toContain("    <h2>Other</h2>\n    <li>Two <b>bold</b></li>\n  </section>");
  });
});

describe("insert, groups and removals through the route", () => {
  const TOKEN = "insert-token";
  const HTML = '<!doctype html><html><head></head><body>\n  <h1 style="color: red">Title</h1>\n  <p>Body</p>\n</body></html>';
  let server: ReviewServer;
  let base: string;
  let vault: Record<string, string>;
  let preview: Record<string, string>;
  let copied: string[];

  beforeEach(async () => {
    vault = { "P/index.html": HTML };
    preview = { "p/index.html": HTML };
    copied = [];
    server = new ReviewServer({
      token: TOKEN,
      store: {
        readComments: async () => null,
        writeComments: async () => {},
        readPages: async () => null,
        readPreview: async (path) => preview[path] ?? null,
      },
      edit: {
        sourceFor: (path) => (path === "p/index.html" ? "P/index.html" : null),
        readSource: async (path) => vault[path] ?? null,
        writeSource: async (path, text) => {
          vault[path] = text;
        },
        writePreview: async (path, text) => {
          preview[path] = text;
        },
        backup: async () => {},
        images: async () => ["P/img/cat.png", "P/notes.md", "Other/dog.png"],
        copyToPreview: async (from, to) => {
          copied.push(`${from} -> ${to}`);
        },
        readImage: async (path) => (path === "P/img/cat.png" ? new Uint8Array([137, 80, 78, 71]).buffer : null),
      },
    });
    base = `http://127.0.0.1:${(await server.start()).port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const call = async (body: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/edit`, {
      method: "POST",
      headers: { cookie: `osp-review=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ page: "p/index.html", ...body }),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };

  it("lists only the page's own images, by path from the page", async () => {
    const response = await fetch(`${base}/api/images?page=p/index.html`, { headers: { cookie: `osp-review=${TOKEN}` } });
    expect(await response.json()).toEqual({ images: ["img/cat.png"] });
  });

  it("shows one of them to the picker from the vault, and nothing else", async () => {
    const get = (src: string) =>
      fetch(`${base}/api/image?page=p/index.html&src=${encodeURIComponent(src)}`, { headers: { cookie: `osp-review=${TOKEN}` } });
    const cat = await get("img/cat.png");
    expect(cat.status).toBe(200);
    expect(cat.headers.get("content-type")).toBe("image/png");
    expect(cat.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await cat.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect((await get("../Other/dog.png")).status).toBe(404);
    expect((await get("notes.md")).status).toBe(404);
  });

  it("inserts one of them and copies it into the preview; refuses any other", async () => {
    const bad = await call({ hash: hashText(HTML), op: "insert", at: null, place: "inside", kind: "image", src: "dog.png" });
    expect(bad.status).toBe(404);
    const good = await call({ hash: hashText(HTML), op: "insert", at: null, place: "inside", kind: "image", src: "img/cat.png" });
    expect(good.status).toBe(200);
    expect(vault["P/index.html"]).toContain('<img src="img/cat.png" alt=""');
    expect(copied).toEqual(["P/img/cat.png -> p/img/cat.png"]);
    expect(typeof good.data.created).toBe("number");
  });

  it("copies a look by class names only, and refuses anything else", async () => {
    const at = HTML.indexOf("<p>");
    const sneaky = await call({ hash: hashText(HTML), op: "insert", at, place: "after", kind: "button", like: { cls: '"><script>' } });
    expect(sneaky.status).toBe(400);
    const level = await call({ hash: hashText(HTML), op: "insert", at, place: "after", kind: "heading", like: { tag: "div" } });
    expect(level.status).toBe(400);
    const unknown = await call({ hash: hashText(HTML), op: "insert", at, place: "after", kind: "script" });
    expect(unknown.status).toBe(400);
    const good = await call({ hash: hashText(HTML), op: "insert", at, place: "after", kind: "button", like: { cls: "btn primary" } });
    expect(good.status).toBe(200);
    expect(vault["P/index.html"]).toContain('<p>Body</p>\n  <button type="button" class="btn primary">Button</button>');
  });

  it("takes a declaration away, and the attribute with it", async () => {
    const result = await call({ hash: hashText(HTML), op: "inline-style", at: HTML.indexOf("<h1"), props: [["color", ""]] });
    expect(result.status).toBe(200);
    expect(vault["P/index.html"]).toContain("\n  <h1>Title</h1>");
  });

  it("undoes a whole group at once after a reload", async () => {
    let hash = hashText(HTML);
    const one = await call({ hash, op: "hide", at: HTML.indexOf("<p>"), group: "g1" });
    hash = one.data.hash as string;
    const after = vault["P/index.html"];
    const two = await call({ hash, op: "inline-style", at: after.indexOf("<h1"), props: [["color", "blue"]], group: "g1" });
    hash = two.data.hash as string;
    const back = await call({ hash, op: "undo" });
    expect(back.status).toBe(200);
    expect(back.data).toMatchObject({ reload: true, undo: 0, redo: 2 });
    expect(vault["P/index.html"]).toBe(HTML);
  });
});

describe("where things are", () => {
  it("finds a rule in a page's own style block, and its line", () => {
    const page = "<html><head>\n<style>\na { color: red; }\n\n.b { margin: 0; }\n</style></head><body></body></html>";
    const sheet = page.indexOf("<style>");
    const at = ruleStart(page, sheet, [1], ".b");
    expect(at).toBe(page.indexOf(".b {"));
    expect(lineAt(page, at!)).toEqual({ line: 5, column: 1 });
    expect(ruleStart(page, sheet, [1], ".c")).toBeNull();
  });
});
