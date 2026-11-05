/**
 * Generates a large test vault for the scale run.
 *
 * The question this vault exists to answer is not "can we render 300 notes"
 * but "does rendering 300 notes get slower as it goes". A long publish is a
 * long session, and a long session is exactly what degraded one test vault
 * during development: a plain prose note's render climbed from 886ms to
 * 6,989ms with no change to the note.
 *
 * So the mix matters less than the control. Every tenth note is an identical
 * copy of the same plain prose note, with no plugin content at all. If those
 * copies take longer at the end of the run than at the start, the renderer is
 * leaking, and the per-note numbers for everything else are not trustworthy.
 *
 * The mix is still roughly vault-shaped, because a vault of nothing but
 * Dataview queries would answer a question nobody asked:
 *
 *   ~10%  control notes (identical plain prose)
 *   ~55%  ordinary prose, varying length, with wikilinks
 *   ~15%  Dataview queries
 *    ~5%  dataviewjs
 *    ~5%  Mermaid
 *    ~5%  embeds and transclusion
 *    ~5%  Bases
 *
 * The vault is generated rather than committed: it is 300+ files of filler,
 * and a seed makes it reproducible without storing it.
 *
 * Usage: node scripts/make-scale-vault.mjs [count] <path>
 *
 * The path is required and has no default. This script begins by deleting
 * the directory it is given, recursively and with force, so a default would
 * be a guess at what to destroy -- and the guess it used to make was one
 * person's own folder layout, written into committed source. Name the target
 * or get an error; those are better odds than the alternative.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const count = Number(process.argv[2] ?? 300);
const root = process.argv[3] ?? process.env.VAULT_PUBLISHER_SCALE_VAULT;

if (!root) {
  console.error("No path given, and this script deletes the path it is given.");
  console.error("");
  console.error("  node scripts/make-scale-vault.mjs 300 /path/to/scale-vault");
  console.error("");
  console.error("Pick somewhere disposable: the directory is removed first.");
  process.exit(1);
}

/** Deterministic PRNG, so two runs of this script produce the same vault. */
let seed = 20261018;
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (list) => list[Math.floor(random() * list.length)];

const TOPICS = [
  "attention", "bootstrapping", "cadence", "dependencies", "elegance",
  "failure modes", "granularity", "heuristics", "interfaces", "jargon",
  "knowledge", "latency", "measurement", "naming", "observability",
  "provenance", "queues", "refactoring", "simplicity", "tradeoffs",
];

const WORDS = `the idea here is that a system which has to explain itself
tends to become simpler over time because every explanation is a small act of
design review and the parts that resist description are usually the parts that
were never really understood in the first place so writing it down is less a
record than a test and the test is cheap to run`.split(/\s+/);

function paragraph(sentences) {
  const out = [];
  for (let i = 0; i < sentences; i++) {
    const length = 12 + Math.floor(random() * 18);
    const words = [];
    for (let w = 0; w < length; w++) words.push(pick(WORDS));
    const text = words.join(" ");
    out.push(text[0].toUpperCase() + text.slice(1) + ".");
  }
  return out.join(" ");
}

function prose(paragraphs, linkTargets) {
  const parts = [];
  for (let i = 0; i < paragraphs; i++) {
    let text = paragraph(2 + Math.floor(random() * 3));
    if (linkTargets.length && random() < 0.4) {
      text += ` See [[${pick(linkTargets)}]].`;
    }
    parts.push(text);
  }
  return parts.join("\n\n");
}

// --- the control note ------------------------------------------------------

/**
 * Identical every time, deliberately. It contains nothing asynchronous, so
 * its render time is a measurement of the environment and nothing else.
 */
const CONTROL_BODY = `---
title: Control
publish: true
---

# Control

This note is identical everywhere it appears and contains no plugin content.
Its render time measures the environment, not the note. If copies late in a
build are slower than copies early in it, the renderer is leaking state.

${(() => {
  // Generated once, at module load, from a fixed point in the sequence.
  const saved = seed;
  seed = 999;
  const body = prose(4, []);
  seed = saved;
  return body;
})()}

- A list, to give the parser something ordinary to do
- With three items
- And no queries

> A blockquote, for the same reason.
`;

// --- note kinds ------------------------------------------------------------

function dataviewNote(index, topic) {
  return `---
title: Dataview ${index}
publish: true
topic: ${topic}
---

# Dataview ${index}

${prose(1, [])}

\`\`\`dataview
TABLE author, rating, pages
FROM "library"
SORT rating DESC
LIMIT 5
\`\`\`

${prose(1, [])}

\`\`\`dataview
LIST
FROM "library"
WHERE rating >= 4
\`\`\`
`;
}

function dataviewjsNote(index, topic) {
  return `---
title: Dataviewjs ${index}
publish: true
topic: ${topic}
---

# Dataviewjs ${index}

${prose(1, [])}

\`\`\`dataviewjs
const pages = dv.pages('"library"').sort((p) => p.rating, 'desc');
dv.table(
  ["File", "Author", "Rating"],
  pages.map((p) => [p.file.link, p.author, p.rating]),
);
\`\`\`
`;
}

function mermaidNote(index, topic) {
  return `---
title: Mermaid ${index}
publish: true
topic: ${topic}
---

# Mermaid ${index}

${prose(1, [])}

\`\`\`mermaid
graph TD
  A[Start ${index}] --> B{Decision}
  B -->|yes| C[Path one]
  B -->|no| D[Path two]
  C --> E[End]
  D --> E
\`\`\`
`;
}

function embedNote(index, topic, linkTargets) {
  const target = pick(linkTargets);
  return `---
title: Embeds ${index}
publish: true
topic: ${topic}
---

# Embeds ${index}

${prose(1, [])}

![[${target}]]

${prose(1, [])}
`;
}

function basesNote(index, topic) {
  return `---
title: Bases ${index}
publish: true
topic: ${topic}
---

# Bases ${index}

${prose(1, [])}

![[Reading.base]]
`;
}

function proseNote(index, topic, linkTargets) {
  return `---
title: ${topic[0].toUpperCase() + topic.slice(1)} ${index}
publish: true
topic: ${topic}
---

# ${topic[0].toUpperCase() + topic.slice(1)} ${index}

${prose(2 + Math.floor(random() * 4), linkTargets)}

## A section

${prose(1 + Math.floor(random() * 2), linkTargets)}
`;
}

// --- library the queries read ---------------------------------------------

const BOOKS = [
  ["notes-on-the-synthesis", "Christopher Alexander", 3, 216],
  ["pattern-language", "Christopher Alexander", 5, 1171],
  ["the-glass-bead-game", "Hermann Hesse", 5, 558],
  ["the-mythical-man-month", "Fred Brooks", 4, 322],
  ["understanding-comics", "Scott McCloud", 5, 216],
  ["thinking-in-systems", "Donella Meadows", 5, 240],
  ["the-timeless-way", "Christopher Alexander", 4, 552],
  ["godel-escher-bach", "Douglas Hofstadter", 5, 777],
];

const READING_BASE = `filters:
  and:
    - 'file.inFolder("library")'
formulas:
  weight: 'if(pages, (pages / 100).round(1), "")'
properties:
  note.author:
    displayName: author
views:
  - type: table
    name: All books
    order:
      - file.name
      - note.author
      - note.rating
      - note.pages
      - formula.weight
`;

// --- generate --------------------------------------------------------------

rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "notes"), { recursive: true });
mkdirSync(join(root, "library"), { recursive: true });

for (const [name, author, rating, pages] of BOOKS) {
  writeFileSync(
    join(root, "library", `${name}.md`),
    `---\nauthor: ${author}\nrating: ${rating}\npages: ${pages}\n---\n\n# ${name}\n\n${prose(1, [])}\n`,
  );
}
writeFileSync(join(root, "library", "Reading.base"), READING_BASE);

const linkTargets = BOOKS.map(([name]) => `library/${name}`);
const tally = {};
const record = (kind) => (tally[kind] = (tally[kind] ?? 0) + 1);

for (let i = 1; i <= count; i++) {
  const topic = pick(TOPICS);
  const pad = String(i).padStart(4, "0");
  let name;
  let body;

  if (i % 10 === 0) {
    // The control. Its position is encoded in the filename only: the body
    // must be byte-identical everywhere, or the thing being compared is not
    // purely the environment.
    name = `control-${pad}`;
    body = CONTROL_BODY;
    record("control");
  } else {
    const roll = random();
    if (roll < 0.17) {
      name = `dataview-${pad}`;
      body = dataviewNote(i, topic);
      record("dataview");
    } else if (roll < 0.23) {
      name = `dataviewjs-${pad}`;
      body = dataviewjsNote(i, topic);
      record("dataviewjs");
    } else if (roll < 0.29) {
      name = `mermaid-${pad}`;
      body = mermaidNote(i, topic);
      record("mermaid");
    } else if (roll < 0.35) {
      name = `embeds-${pad}`;
      body = embedNote(i, topic, linkTargets);
      record("embeds");
    } else if (roll < 0.4) {
      name = `bases-${pad}`;
      body = basesNote(i, topic);
      record("bases");
    } else {
      name = `note-${pad}`;
      body = proseNote(i, topic, linkTargets);
      record("prose");
    }
  }

  writeFileSync(join(root, "notes", `${name}.md`), body);
}

console.log(`generated ${count} notes in ${root}/notes`);
console.log(`library: ${BOOKS.length} books + Reading.base`);
console.log("mix:", tally);
console.log("");
console.log("Open this folder as a vault in Obsidian, install Dataview,");
console.log("then: node scripts/deploy.mjs " + root);
