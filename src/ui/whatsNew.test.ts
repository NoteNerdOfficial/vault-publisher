import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELEASES as SHIPPED,
  Release,
  compareVersions,
  latestRelease,
  releaseToShow,
} from "./whatsNew";

const notes = (version: string): Release => ({ version, title: version, lede: "", points: [] });
const RELEASES = [notes("0.2.0"), notes("0.3.0")];

describe("what's new", () => {
  it("compares versions part by part, not as text", () => {
    expect(compareVersions("0.1.14", "0.2.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
  });

  it("shows a release's notes once, after updating to it", () => {
    expect(releaseToShow("0.2.0", "0.1.14", false, RELEASES)?.version).toBe("0.2.0");
    expect(releaseToShow("0.2.0", "0.2.0", false, RELEASES)).toBeNull();
  });

  it("says nothing to a fresh install", () => {
    expect(releaseToShow("0.2.0", undefined, true, RELEASES)).toBeNull();
  });

  it("shows the newest notes when versions were skipped, and none from the future", () => {
    expect(releaseToShow("0.3.1", "0.1.14", false, RELEASES)?.version).toBe("0.3.0");
    expect(releaseToShow("0.2.5", "0.1.14", false, RELEASES)?.version).toBe("0.2.0");
    expect(releaseToShow("0.2.1", "0.2.0", false, RELEASES)).toBeNull();
  });

  it("finds the latest notes for the command, whatever was seen", () => {
    expect(latestRelease("0.2.0", RELEASES)?.version).toBe("0.2.0");
  });

  // A release that only fixes things adds no notes of its own, and must not
  // take the last ones away: the command still has to have something to show.
  it("has notes for the version being shipped, if only the last release's", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "../../manifest.json"), "utf8")) as {
      version: string;
    };
    const newest = [...SHIPPED].sort((a, b) => compareVersions(b.version, a.version))[0];
    expect(latestRelease(manifest.version)?.version).toBe(newest?.version);
  });
});
