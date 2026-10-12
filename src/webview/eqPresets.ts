export interface EqPreset {
  id: string;
  nameKey: string;
  bands: number[];
}

export const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const PRESETS: EqPreset[] = [
  { id: "flat", nameKey: "eqPresetFlat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "classical", nameKey: "eqPresetClassical", bands: [0, 0, 0, 0, 0, 0, -5, -5, -5, -6] },
  { id: "club", nameKey: "eqPresetClub", bands: [0, 0, 2, 3, 3, 3, 2, 0, 0, 0] },
  { id: "dance", nameKey: "eqPresetDance", bands: [6, 4, 1, 0, 0, -4, -5, -5, 0, 0] },
  { id: "full-bass", nameKey: "eqPresetFullBass", bands: [6, 6, 6, 3, 1, -3, -6, -7, -7, -7] },
  { id: "full-bass-treble", nameKey: "eqPresetFullBassTreble", bands: [4, 3, 0, -5, -3, 1, 5, 7, 7, 7] },
  { id: "full-treble", nameKey: "eqPresetFullTreble", bands: [-6, -6, -6, -3, 2, 7, 10, 10, 10, 10] },
  { id: "laptop", nameKey: "eqPresetLaptop", bands: [3, 7, 3, -3, -2, 1, 3, 6, 8, 9] },
  { id: "large-hall", nameKey: "eqPresetLargeHall", bands: [6, 6, 3, 3, 0, -3, -3, -3, 0, 0] },
  { id: "live", nameKey: "eqPresetLive", bands: [-3, 0, 2, 3, 3, 3, 2, 2, 2, 1] },
  { id: "party", nameKey: "eqPresetParty", bands: [4, 4, 0, 0, 0, 0, 0, 0, 4, 4] },
  { id: "pop", nameKey: "eqPresetPop", bands: [-2, 3, 4, 5, 3, -1, -2, -2, -2, -2] },
  { id: "reggae", nameKey: "eqPresetReggae", bands: [0, 0, -1, -4, 0, 4, 4, 0, 0, 0] },
  { id: "rock", nameKey: "eqPresetRock", bands: [5, 3, -4, -5, -3, 2, 5, 7, 7, 7] },
  { id: "ska", nameKey: "eqPresetSka", bands: [-2, -3, -3, -1, 2, 3, 5, 6, 7, 6] },
  { id: "soft", nameKey: "eqPresetSoft", bands: [3, 1, -1, -2, -1, 2, 5, 6, 7, 7] },
  { id: "soft-rock", nameKey: "eqPresetSoftRock", bands: [2, 2, 1, -1, -3, -4, -3, -1, 2, 5] },
  { id: "techno", nameKey: "eqPresetTechno", bands: [5, 3, 0, -4, -3, 0, 5, 6, 6, 5] },
];
const MAX_HEADROOM_DB = 3;
export const RANGE_DB = 12;

export const findPreset = (id: string) => PRESETS.find((preset) => preset.id === id);
export const presetPreampDb = (bands: number[]) => -Math.min(MAX_HEADROOM_DB, Math.max(0, ...bands)) || 0;
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const formatDb = (db: number) => (db > 0 ? "+" : "") + db;
export const formatBand = (freq: number) => (freq >= 1000 ? freq / 1000 + "K" : String(freq));
export const clampDb = (value: unknown) =>
  typeof value === "number" && isFinite(value) ? Math.max(-RANGE_DB, Math.min(RANGE_DB, Math.round(value))) : 0;
