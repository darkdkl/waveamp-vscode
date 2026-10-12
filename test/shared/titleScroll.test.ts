import { describe, expect, it } from "vitest";
import {
  normalizeTitleScrollMode,
  normalizeTitleScrollSpeed,
  titleScrollPlan,
  TITLE_SCROLL_DEFAULT,
  TITLE_SCROLL_SPEED_DEFAULT,
} from "../../src/shared/titleScroll";

describe("title scroll settings", () => {
  it("accept the known modes and fall back to back and forth", () => {
    expect(normalizeTitleScrollMode("loop")).toBe("loop");
    expect(normalizeTitleScrollMode("off")).toBe("off");
    expect(normalizeTitleScrollMode("sideways")).toBe(TITLE_SCROLL_DEFAULT);
    expect(normalizeTitleScrollMode(undefined)).toBe("bounce");
  });

  it("keep the speed a whole number from 10 to 50 px/s", () => {
    expect(normalizeTitleScrollSpeed(24.6)).toBe(25);
    expect(normalizeTitleScrollSpeed(5)).toBe(10);
    expect(normalizeTitleScrollSpeed(99)).toBe(50);
    expect(normalizeTitleScrollSpeed("fast")).toBe(TITLE_SCROLL_SPEED_DEFAULT);
  });
});

describe("titleScrollPlan", () => {
  it("does nothing when scrolling is off or the title fits", () => {
    expect(titleScrollPlan("off", 120, 400, 30)).toBeNull();
    expect(titleScrollPlan("bounce", 0, 400, 30)).toBeNull();
    expect(titleScrollPlan("loop", -3, 400, 30)).toBeNull();
  });

  it("loops one full lap at the chosen speed, forever", () => {
    const plan = titleScrollPlan("loop", 120, 400, 40)!;
    expect(plan.durationMs).toBe(10_000);
    expect(plan.iterations).toBe(Infinity);
    expect(plan.keyframes).toEqual([{ offset: 0, x: 0 }, { offset: 1, x: -400 }]);
  });

  it("goes back and forth with a 2 s pause at each end", () => {
    const plan = titleScrollPlan("bounce", 60, 400, 30)!;
    expect(plan.durationMs).toBe(8000);
    expect(plan.iterations).toBe(Infinity);
    expect(plan.keyframes.map((k) => k.x)).toEqual([0, 0, -60, -60, 0]);
    expect(plan.keyframes.map((k) => k.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("scrolls once with a short pause before and after", () => {
    const plan = titleScrollPlan("once", 30, 400, 30)!;
    expect(plan.durationMs).toBe(3000);
    expect(plan.iterations).toBe(1);
    expect(plan.keyframes.map((k) => k.x)).toEqual([0, 0, -30, -30]);
  });
});
