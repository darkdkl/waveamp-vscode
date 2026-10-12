import type { TrackTags } from "../shared/types";
import type { FavoriteStation } from "../shared/messages";

export function formatTime(seconds: number | null | undefined): string {
  const s = typeof seconds === "number" && isFinite(seconds) && seconds >= 0 ? seconds : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function displayName(track: { name: string; tags?: TrackTags | null }): string {
  const { title, artist } = track.tags ?? {};
  if (title && artist) return `${artist} — ${title}`;
  return title || track.name;
}

export function stationHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function stationMeta(station: FavoriteStation): string {
  if (station.custom) return stationHost(station.sourceUrl || station.url);
  const quality = [station.codec, station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" ");
  return [station.country, quality].filter(Boolean).join(" · ");
}
