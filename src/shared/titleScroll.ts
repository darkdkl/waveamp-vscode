export type TitleScrollMode = "off" | "loop" | "bounce" | "once";

export const TITLE_SCROLL_MODES: TitleScrollMode[] = ["off", "loop", "bounce", "once"];
export const TITLE_SCROLL_DEFAULT: TitleScrollMode = "bounce";
export const TITLE_SCROLL_SPEED_MIN = 10;
export const TITLE_SCROLL_SPEED_MAX = 50;
export const TITLE_SCROLL_SPEED_DEFAULT = 30;
export const TITLE_SCROLL_SEPARATOR = "   •   ";

const EDGE_PAUSE_MS = 2000;
const ONCE_PAUSE_MS = 1000;

export interface TitleScrollPlan {
  keyframes: { offset: number; x: number }[];
  durationMs: number;
  iterations: number;
}

export function normalizeTitleScrollMode(value: unknown): TitleScrollMode {
  return TITLE_SCROLL_MODES.includes(value as TitleScrollMode) ? (value as TitleScrollMode) : TITLE_SCROLL_DEFAULT;
}

export function normalizeTitleScrollSpeed(value: unknown): number {
  const speed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : TITLE_SCROLL_SPEED_DEFAULT;
  return Math.min(TITLE_SCROLL_SPEED_MAX, Math.max(TITLE_SCROLL_SPEED_MIN, speed));
}

export function titleScrollPlan(mode: TitleScrollMode, overflowPx: number, loopLapPx: number, speed: number): TitleScrollPlan | null {
  if (mode === "off" || overflowPx <= 0) return null;
  const pxPerMs = normalizeTitleScrollSpeed(speed) / 1000;
  if (mode === "loop") {
    return { keyframes: [{ offset: 0, x: 0 }, { offset: 1, x: -loopLapPx }], durationMs: loopLapPx / pxPerMs, iterations: Infinity };
  }
  const moveMs = overflowPx / pxPerMs;
  if (mode === "bounce") {
    const total = 2 * EDGE_PAUSE_MS + 2 * moveMs;
    return {
      keyframes: [
        { offset: 0, x: 0 },
        { offset: EDGE_PAUSE_MS / total, x: 0 },
        { offset: (EDGE_PAUSE_MS + moveMs) / total, x: -overflowPx },
        { offset: (2 * EDGE_PAUSE_MS + moveMs) / total, x: -overflowPx },
        { offset: 1, x: 0 },
      ],
      durationMs: total,
      iterations: Infinity,
    };
  }
  const total = 2 * ONCE_PAUSE_MS + moveMs;
  return {
    keyframes: [
      { offset: 0, x: 0 },
      { offset: ONCE_PAUSE_MS / total, x: 0 },
      { offset: (ONCE_PAUSE_MS + moveMs) / total, x: -overflowPx },
      { offset: 1, x: -overflowPx },
    ],
    durationMs: total,
    iterations: 1,
  };
}
