import { isHttpUrl } from "./shared/streamUrl";
import type { FavoriteStation } from "./shared/messages";

export const FAVORITES_LIMIT = 1000;
const ID_LIMIT = 100;
const TEXT_LIMIT = 500;
const URL_LIMIT = 2048;

const text = (value: unknown, limit = TEXT_LIMIT) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const link = (value: unknown) => (typeof value === "string" && value.length <= URL_LIMIT && isHttpUrl(value) ? value : "");

export function normalizeFavorites(raw: unknown): FavoriteStation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const favorites: FavoriteStation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const stationuuid = text(s.stationuuid, ID_LIMIT);
    const url = link(s.url);
    if (!stationuuid || !url || seen.has(stationuuid)) continue;
    seen.add(stationuuid);
    const sourceUrl = link(s.sourceUrl);
    favorites.push({
      stationuuid,
      name: text(s.name) || url,
      url,
      favicon: link(s.favicon),
      tags: text(s.tags),
      country: text(s.country),
      countrycode: text(s.countrycode, 2),
      state: text(s.state),
      bitrate: typeof s.bitrate === "number" && Number.isFinite(s.bitrate) && s.bitrate > 0 ? Math.round(s.bitrate) : 0,
      codec: text(s.codec, 20),
      ...(s.custom === true ? { custom: true as const } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
    if (favorites.length >= FAVORITES_LIMIT) break;
  }
  return favorites;
}
