import { describe, expect, it } from "vitest";
import { contrastRatio, dimLightness, hslLuminance } from "../../src/shared/contrast";

describe("hslLuminance", () => {
  it("matches the sRGB luminance of known colors", () => {
    expect(hslLuminance(0, 0, 0)).toBe(0);
    expect(hslLuminance(0, 0, 100)).toBeCloseTo(1, 6);
    expect(hslLuminance(0, 100, 50)).toBeCloseTo(0.2126, 4);
    expect(hslLuminance(120, 100, 50)).toBeCloseTo(0.7152, 4);
    expect(hslLuminance(240, 100, 50)).toBeCloseTo(0.0722, 4);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white in any order", () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 6);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6);
  });
});

describe("dimLightness", () => {
  it("brightens the dim color more for dark hues", () => {
    expect(dimLightness(134, 96)).toBeCloseTo(30.8, 1);
    expect(dimLightness(270, 80)).toBeCloseTo(44.8, 1);
    expect(dimLightness(352, 85)).toBeCloseTo(42.5, 1);
    expect(dimLightness(0, 0)).toBeCloseTo(37.1, 1);
  });

  it("reaches the target contrast against the display background for any color", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const saturation of [0, 40, 80, 100]) {
        const lightness = dimLightness(hue, saturation);
        const ratio = contrastRatio(hslLuminance(hue, saturation * 0.4, lightness), hslLuminance(hue, saturation * 0.3, 6));
        expect(ratio).toBeGreaterThanOrEqual(3);
        expect(ratio).toBeLessThan(3.1);
      }
    }
  });
});
