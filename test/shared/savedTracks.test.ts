import { describe, expect, it } from "vitest";
import { normalizeSavedTracks, savedTrackKey } from "../../src/shared/savedTracks";

describe("savedTrackKey", () => {
  it("ignores case and extra spaces", () => {
    expect(savedTrackKey("  Night  Route - Highway Lights ")).toBe(savedTrackKey("night route - highway lights"));
  });
});

describe("normalizeSavedTracks", () => {
  it("keeps valid entries and drops broken ones", () => {
    expect(
      normalizeSavedTracks([
        { title: "A - B", station: "Harbor FM", savedAt: 2 },
        { title: "  ", station: "X", savedAt: 1 },
        null,
        { title: "C - D" },
      ])
    ).toEqual([
      { title: "A - B", station: "Harbor FM", savedAt: 2 },
      { title: "C - D", station: "", savedAt: 0 },
    ]);
  });

  it("keeps one entry per track", () => {
    const tracks = normalizeSavedTracks([
      { title: "A - B", station: "Harbor FM", savedAt: 2 },
      { title: "a - b", station: "Midnight Lounge", savedAt: 1 },
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].station).toBe("Harbor FM");
  });

  it("returns an empty list for anything but an array", () => {
    expect(normalizeSavedTracks(undefined)).toEqual([]);
    expect(normalizeSavedTracks({ tracks: [] })).toEqual([]);
  });
});
