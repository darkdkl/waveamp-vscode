import { describe, expect, it } from "vitest";
import { t } from "../../src/i18n";
import { BANDS, PRESETS, RANGE_DB, clampDb, findPreset, formatBand, formatDb, presetPreampDb } from "../../src/webview/eqPresets";

describe("EQ presets", () => {
  it("have unique ids and a gain for every band within the slider range", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      expect(preset.bands, preset.id).toHaveLength(BANDS.length);
      for (const db of preset.bands) expect(Math.abs(db), preset.id).toBeLessThanOrEqual(RANGE_DB);
    }
  });

  it("have a name in the UI strings", () => {
    for (const preset of PRESETS) expect(t[preset.nameKey as keyof typeof t], preset.id).toBeTruthy();
  });

  it("are found by id", () => {
    expect(findPreset("rock")?.nameKey).toBe("eqPresetRock");
    expect(findPreset("custom")).toBeUndefined();
  });
});

describe("presetPreampDb", () => {
  it("is zero for presets without boosts", () => {
    expect(presetPreampDb([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(Object.is(presetPreampDb([-5, -5, 0, 0, 0, 0, 0, 0, 0, 0]), 0)).toBe(true);
  });

  it("lowers the preamp by the largest boost, at most by the headroom cap", () => {
    expect(presetPreampDb([0, 2, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(-2);
    expect(presetPreampDb([0, 10, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(-3);
  });
});

describe("EQ values", () => {
  it("clamps and rounds saved gains", () => {
    expect(clampDb(4.6)).toBe(5);
    expect(clampDb(40)).toBe(RANGE_DB);
    expect(clampDb(-40)).toBe(-RANGE_DB);
    expect(clampDb("3")).toBe(0);
    expect(clampDb(NaN)).toBe(0);
  });

  it("formats gains and band labels", () => {
    expect(formatDb(3)).toBe("+3");
    expect(formatDb(-2)).toBe("-2");
    expect(formatBand(600)).toBe("600");
    expect(formatBand(12000)).toBe("12K");
  });
});
