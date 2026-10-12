import type { CountedOption, CountryOption, Station } from "../shared/types";

export interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  bitrate?: number;
  codec?: string;
}

export function stationSummary(s: RadioBrowserStation): Station {
  return {
    stationuuid: s.stationuuid,
    name: s.name,
    url: s.url_resolved || s.url,
    favicon: s.favicon || "",
    tags: s.tags || "",
    country: s.country || "",
    countrycode: s.countrycode || "",
    state: s.state || "",
    bitrate: s.bitrate || 0,
    codec: s.codec || "",
  };
}

export interface RadioBrowserNamedCount {
  name: string;
  stationcount: number;
  iso_3166_1?: string;
}

export function filterStationsByTag(stations: Station[], tag: string, limit: number): Station[] {
  const wantedTag = tag.toLowerCase();
  return stations
    .filter((s) =>
      s.tags
        .split(",")
        .some((t) => t.trim().toLowerCase() === wantedTag)
    )
    .slice(0, limit);
}

function sortKey(name: string): string {
  return name.replace(/^the\s+/i, "");
}

function byName(a: { name: string }, b: { name: string }): number {
  return sortKey(a.name).localeCompare(sortKey(b.name), "en", { sensitivity: "base" });
}

export function toCountryOptions(data: RadioBrowserNamedCount[]): CountryOption[] {
  return data
    .filter((c): c is RadioBrowserNamedCount & { iso_3166_1: string } => !!c.iso_3166_1 && !!c.name.trim() && c.stationcount > 0)
    .map((c) => ({ code: c.iso_3166_1, name: c.name.trim(), count: c.stationcount }))
    .sort(byName);
}

export function toStateOptions(data: RadioBrowserNamedCount[]): CountedOption[] {
  return data
    .filter((s) => s.name?.trim() && s.stationcount > 0)
    .map((s) => ({ name: s.name.trim(), count: s.stationcount }))
    .sort(byName);
}

export function toTagOptions(data: RadioBrowserNamedCount[]): CountedOption[] {
  return data.filter((t) => t.name).map((t) => ({ name: t.name, count: t.stationcount }));
}

export function countTags(stations: Pick<RadioBrowserStation, "tags">[], limit: number): CountedOption[] {
  const counts = new Map<string, number>();
  for (const s of stations) {
    for (const tag of (s.tags || "").split(",")) {
      const name = tag.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
