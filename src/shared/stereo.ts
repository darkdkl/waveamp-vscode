export type ChannelLayout = "stereo" | "mono";

export const STEREO_STRENGTH_DEFAULT = 50;

const WIDTH_MIN = 1.15;
const WIDTH_MAX = 2;
const PSEUDO_MIN = 0.25;
const PSEUDO_MAX = 0.6;

const SILENCE_ENERGY = 1e-6;
const MONO_BELOW = 0.0005;
const STEREO_ABOVE = 0.002;

export function normalizeStereoStrength(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : STEREO_STRENGTH_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export function stereoWidth(strength: number): number {
  return WIDTH_MIN + ((WIDTH_MAX - WIDTH_MIN) * normalizeStereoStrength(strength)) / 100;
}

export function pseudoStereoAmount(strength: number): number {
  return PSEUDO_MIN + ((PSEUDO_MAX - PSEUDO_MIN) * normalizeStereoStrength(strength)) / 100;
}

export function classifyChannels(previous: ChannelLayout | null, sideEnergy: number, midEnergy: number): ChannelLayout | null {
  if (midEnergy < SILENCE_ENERGY) return previous;
  const ratio = sideEnergy / midEnergy;
  if (ratio < MONO_BELOW) return "mono";
  if (ratio > STEREO_ABOVE) return "stereo";
  return previous ?? (ratio < (MONO_BELOW + STEREO_ABOVE) / 2 ? "mono" : "stereo");
}
