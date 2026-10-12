import { describe, expect, it } from "vitest";
import {
  classifyChannels,
  normalizeStereoStrength,
  pseudoStereoAmount,
  stereoWidth,
} from "../../src/shared/stereo";

describe("stereo strength", () => {
  it("normalizes to a whole number from 0 to 100", () => {
    expect(normalizeStereoStrength(42.6)).toBe(43);
    expect(normalizeStereoStrength(-5)).toBe(0);
    expect(normalizeStereoStrength(140)).toBe(100);
    expect(normalizeStereoStrength("loud")).toBe(50);
  });

  it("maps strength to a width from 1.15 to 2 and a pseudo-stereo amount", () => {
    expect(stereoWidth(0)).toBeCloseTo(1.15);
    expect(stereoWidth(100)).toBeCloseTo(2);
    expect(stereoWidth(50)).toBeCloseTo(1.575);
    expect(pseudoStereoAmount(0)).toBeCloseTo(0.25);
    expect(pseudoStereoAmount(100)).toBeCloseTo(0.6);
  });
});

describe("classifyChannels", () => {
  it("calls identical channels mono and different ones stereo", () => {
    expect(classifyChannels(null, 0, 1)).toBe("mono");
    expect(classifyChannels(null, 0.05, 1)).toBe("stereo");
  });

  it("keeps the last answer during silence and in the hysteresis band", () => {
    expect(classifyChannels("stereo", 0, 0)).toBe("stereo");
    expect(classifyChannels(null, 0, 0)).toBeNull();
    expect(classifyChannels("mono", 0.001, 1)).toBe("mono");
    expect(classifyChannels("stereo", 0.001, 1)).toBe("stereo");
  });
});
