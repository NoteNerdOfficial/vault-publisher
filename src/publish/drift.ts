/**
 * Detecting a build that degrades as it runs.
 *
 * A publish of several hundred notes is a long-lived session doing the same
 * thing over and over, and the spike already produced one environment that
 * got dramatically slower the longer it was used: in the Demo vault a plain
 * prose note's render climbed from 886ms to 6,989ms with no change to the
 * note. That turned out to be caused by repeated plugin reloads rather than
 * by the renderer, but the shape of the failure is exactly what a leaking
 * render loop would look like, and we cannot currently tell the two apart.
 *
 * So the build measures itself. Control notes are byte-identical notes with
 * no asynchronous content, scattered through the vault; their render time is
 * a measurement of the environment and nothing else. If the last ones are
 * meaningfully slower than the first ones, something is accumulating.
 *
 * This is deliberately a measurement and not a fix. Knowing whether the
 * problem exists has to come before deciding how to structure the render loop
 * around it.
 */

export interface DriftSample {
  path: string;
  /** Position in the build, 0-based. */
  index: number;
  renderMs: number;
  /** JS heap in bytes when this note finished, where the runtime reports it. */
  heapBytes: number | null;
}

export interface DriftReport {
  samples: DriftSample[];
  /** Mean render time of the first third of controls, in ms. */
  firstMs: number | null;
  /** Mean render time of the last third of controls, in ms. */
  lastMs: number | null;
  /** lastMs / firstMs. Above 1 means the build slowed down. */
  ratio: number | null;
  /** Heap growth from the first control to the last, in bytes. */
  heapGrowthBytes: number | null;
  /**
   * True when the slowdown is large enough that per-note timings elsewhere in
   * the build should not be trusted.
   */
  degraded: boolean;
}

/**
 * Ratio past which we stop believing the build's own numbers.
 *
 * 1.5 is a judgement call, not a measurement. Render times are noisy at the
 * tens-of-milliseconds scale a plain note occupies, and a machine doing other
 * work will wobble well beyond a few percent. Half again as slow is far
 * outside that noise while still catching a leak long before it reaches the
 * 8x the Demo vault managed.
 */
const DEGRADED_RATIO = 1.5;

/** A note with no async content, used to measure the environment. */
export function isControlNote(path: string): boolean {
  return /(^|\/)control-\d+\.md$/i.test(path);
}

/** Current JS heap, where the runtime exposes it. Electron does; not all do. */
export function heapBytes(): number | null {
  const memory = (performance as unknown as {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return typeof memory?.usedJSHeapSize === "number"
    ? memory.usedJSHeapSize
    : null;
}

export function summarizeDrift(samples: DriftSample[]): DriftReport {
  const empty: DriftReport = {
    samples,
    firstMs: null,
    lastMs: null,
    ratio: null,
    heapGrowthBytes: null,
    degraded: false,
  };

  // Three controls is the minimum that can show a trend rather than a pair of
  // readings; below that, reporting a ratio would dress noise up as a finding.
  if (samples.length < 3) return empty;

  const ordered = [...samples].sort((a, b) => a.index - b.index);
  const span = Math.max(1, Math.floor(ordered.length / 3));
  const head = ordered.slice(0, span);
  const tail = ordered.slice(-span);

  const mean = (list: DriftSample[]) =>
    list.reduce((sum, s) => sum + s.renderMs, 0) / list.length;

  const firstMs = mean(head);
  const lastMs = mean(tail);
  const ratio = firstMs > 0 ? lastMs / firstMs : null;

  const firstHeap = ordered.find((s) => s.heapBytes !== null)?.heapBytes ?? null;
  const lastHeap =
    [...ordered].reverse().find((s) => s.heapBytes !== null)?.heapBytes ?? null;

  return {
    samples: ordered,
    firstMs,
    lastMs,
    ratio,
    heapGrowthBytes:
      firstHeap !== null && lastHeap !== null ? lastHeap - firstHeap : null,
    degraded: ratio !== null && ratio >= DEGRADED_RATIO,
  };
}

/** Human-readable byte count, for the report. */
export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (value < 1024 || unit === "GB") {
      return `${sign}${value.toFixed(unit === "B" ? 0 : 1)}${unit}`;
    }
    value /= 1024;
  }
  return `${sign}${value}B`;
}
