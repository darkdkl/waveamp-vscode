import type { SavedTrack } from "./types";

export const SAVED_TRACKS_LIMIT = 10_000;
const TEXT_LIMIT = 500;

export function savedTrackKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function normalizeSavedTracks(raw: unknown): SavedTrack[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tracks: SavedTrack[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { title, station, savedAt } = item as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim()) continue;
    const key = savedTrackKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      title: title.trim().slice(0, TEXT_LIMIT),
      station: typeof station === "string" ? station.trim().slice(0, TEXT_LIMIT) : "",
      savedAt: typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : 0,
    });
    if (tracks.length >= SAVED_TRACKS_LIMIT) break;
  }
  return tracks;
}
