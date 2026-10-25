/**
 * The local graph: this note and what it is linked to.
 *
 * Laid out at build time and emitted as SVG, because the site makes no
 * external requests and ships no layout library. The layout is a ring rather
 * than a force simulation: a force layout needs iteration to look like
 * anything, it is not deterministic between builds, and for one note and its
 * neighbours a ring says the same thing -- these are adjacent, that one is
 * not -- while being stable enough to diff.
 */

export interface GraphNode {
  url: string;
  title: string;
  /** "in" links here, "out" is linked from here, "both" is mutual. */
  direction: "in" | "out" | "both";
  x: number;
  y: number;
}

export interface LocalGraph {
  nodes: GraphNode[];
  /** Index pairs into `nodes`; -1 is the centre. */
  edges: Array<[number, number]>;
  centre: { title: string; x: number; y: number };
  width: number;
  height: number;
}

export interface GraphInput {
  url: string;
  title: string;
  /** Published URLs this note links to. */
  out: string[];
  /** Published URLs linking to this note. */
  in: string[];
  titles: Map<string, string>;
  /** Most neighbours to draw; beyond this the picture stops being readable. */
  limit?: number;
}

const WIDTH = 240;
const HEIGHT = 170;

export function buildLocalGraph(input: GraphInput): LocalGraph {
  const limit = input.limit ?? 12;
  const directions = new Map<string, "in" | "out" | "both">();

  for (const url of input.out) if (url !== input.url) directions.set(url, "out");
  for (const url of input.in) {
    if (url === input.url) continue;
    directions.set(url, directions.get(url) === "out" ? "both" : "in");
  }

  // Mutual links first: a note that both cites and is cited is the strongest
  // neighbour, and the ring has room for only so many.
  const rank = { both: 0, out: 1, in: 2 } as const;
  const neighbours = Array.from(directions.entries())
    .filter(([url]) => input.titles.has(url))
    .sort((a, b) => rank[a[1]] - rank[b[1]] || (input.titles.get(a[0]) ?? "").localeCompare(input.titles.get(b[0]) ?? ""))
    .slice(0, limit);

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 2 - 22;

  const nodes: GraphNode[] = neighbours.map(([url, direction], i) => {
    // Start at the top and go clockwise, so the first neighbour is always in
    // the same place and a reader can compare two pages' graphs.
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, neighbours.length);
    return {
      url,
      title: input.titles.get(url) ?? url,
      direction,
      x: round(cx + radius * Math.cos(angle)),
      y: round(cy + radius * Math.sin(angle) * 0.82),
    };
  });

  return {
    nodes,
    edges: nodes.map((_, i) => [-1, i] as [number, number]),
    centre: { title: input.title, x: cx, y: cy },
    width: WIDTH,
    height: HEIGHT,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
