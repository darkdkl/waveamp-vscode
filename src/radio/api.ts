import fs from "node:fs";
import path from "node:path";
import { Resolver } from "node:dns/promises";
import { HttpStatusError, requestJson, requestText } from "../net";
import { writeLog } from "../log";
import { isDirectMode } from "../proxy";
import {
  CatalogUnavailableError,
  createMirrorClient,
  mirrorsFromServerList,
  mirrorsFromSrv,
  parseCache,
  parseSources,
  type DiscoverySource,
  type MirrorCache,
  type RadioSources,
} from "./mirrors";
import { isHttpUrl, parsePlaylistStreamUrl, playlistKind } from "../shared/streamUrl";
import {
  countTags,
  filterStationsByTag,
  stationSummary,
  toCountryOptions,
  toStateOptions,
  toTagOptions,
  type RadioBrowserNamedCount,
  type RadioBrowserStation,
} from "./stations";
import type { CountedOption, CountryOption, Station, StationSearchParams } from "../shared/types";
import { CATALOG_UNAVAILABLE, HLS_NOT_SUPPORTED } from "../shared/messages";

const DNS_TIMEOUT_MS = 3000;
const PLAYLIST_MAX_BYTES = 256 * 1024;
const TAG_MATCH_SAMPLE_SIZE = 250;
const TAG_LIMIT = 30;
const TAG_SAMPLE_SIZE = 500;

let bundledSourcesPath = "";
let userSourcesPath = "";
let mirrorCachePath = "";

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadBundledSources(): RadioSources {
  const sources = parseSources(readJson(bundledSourcesPath));
  if (!sources) throw new Error("The built-in radio-sources.json has no usable sources");
  return sources;
}

function loadUserSources(): RadioSources {
  if (!fs.existsSync(userSourcesPath)) {
    try {
      fs.mkdirSync(path.dirname(userSourcesPath), { recursive: true });
      fs.copyFileSync(bundledSourcesPath, userSourcesPath);
      writeLog("info", "radio-api", `Created ${userSourcesPath} from the built-in list`);
    } catch (err) {
      writeLog("warn", "radio-api", `Could not create ${userSourcesPath}: ${(err as Error).message}`);
    }
    return loadBundledSources();
  }
  try {
    const sources = parseSources(readJson(userSourcesPath));
    if (sources) return sources;
    writeLog("warn", "radio-api", `${userSourcesPath} has no usable sources, using the built-in list`);
  } catch (err) {
    writeLog("warn", "radio-api", `Could not read ${userSourcesPath}, using the built-in list: ${(err as Error).message}`);
  }
  return loadBundledSources();
}

function loadMirrorCache(): MirrorCache | null {
  try {
    return parseCache(readJson(mirrorCachePath));
  } catch {
    return null;
  }
}

function saveMirrorCache(cache: MirrorCache): void {
  try {
    fs.mkdirSync(path.dirname(mirrorCachePath), { recursive: true });
    fs.writeFileSync(mirrorCachePath, JSON.stringify(cache, null, 2));
  } catch (err) {
    writeLog("warn", "radio-api", `Could not save the mirror cache: ${(err as Error).message}`);
  }
}

async function discoverMirrors(source: DiscoverySource): Promise<string[]> {
  if (source.type === "dns-srv") {
    const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    return mirrorsFromSrv(await resolver.resolveSrv(source.name));
  }
  return mirrorsFromServerList(await requestJson<unknown>(source.url));
}

const mirrors = createMirrorClient({
  loadUserSources,
  loadBundledSources,
  loadCache: loadMirrorCache,
  saveCache: saveMirrorCache,
  discover: discoverMirrors,
  skipReason: (source) => (source.type === "dns-srv" && !isDirectMode() ? "DNS would bypass the proxy" : null),
  isMirrorFailure: (err) => !(err instanceof HttpStatusError && err.status >= 400 && err.status < 500 && err.status !== 429),
  log: (level, message) => writeLog(level, "radio-api", message),
  now: Date.now,
  random: Math.random,
});

export function initRadioMirrors(storageDir: string, bundledPath: string): void {
  bundledSourcesPath = bundledPath;
  userSourcesPath = path.join(storageDir, "radio-sources.json");
  mirrorCachePath = path.join(storageDir, "radio-mirrors-cache.json");
}

export function radioSourcesFile(): string {
  loadUserSources();
  return userSourcesPath;
}

export function currentRadioMirror(): string | null {
  return mirrors.currentMirror();
}

export async function refreshRadioMirrors(): Promise<string | null> {
  try {
    await mirrors.refresh("/json/stats", (base) => requestJson<unknown>(`${base}/json/stats`));
    return mirrors.currentMirror();
  } catch (err) {
    writeLog("warn", "radio-api", `Mirror refresh failed: ${(err as Error).message}`);
    return null;
  }
}

async function radioApi<T>(pathAndQuery: string): Promise<T> {
  try {
    return await mirrors.request(pathAndQuery, (base) => requestJson<T>(base + pathAndQuery));
  } catch (err) {
    throw err instanceof CatalogUnavailableError ? new Error(CATALOG_UNAVAILABLE) : err;
  }
}

const isHls = (url: string) => new URL(url).pathname.toLowerCase().endsWith(".m3u8");

export async function resolveStreamUrl(url: string): Promise<string | null> {
  if (!isHttpUrl(url)) return null;
  const resolved = await resolvePlaylist(url);
  if (resolved && isHls(resolved)) throw new Error(HLS_NOT_SUPPORTED);
  return resolved;
}

async function resolvePlaylist(url: string): Promise<string | null> {
  const kind = playlistKind(url);
  if (!kind) return url;
  try {
    return parsePlaylistStreamUrl(await requestText(url, undefined, PLAYLIST_MAX_BYTES), kind, url);
  } catch (err) {
    writeLog("warn", "radio", `Playlist ${url} failed: ${(err as Error).message}`);
    return null;
  }
}

export async function searchStations(params: StationSearchParams = {}): Promise<Station[]> {
  const limit = params.limit || 40;
  const q = new URLSearchParams();
  if (params.name) q.set("name", params.name);
  if (params.country) q.set("countrycode", params.country);
  if (params.state) q.set("state", params.state);
  q.set("limit", String(params.tag ? TAG_MATCH_SAMPLE_SIZE : limit));
  q.set("hidebroken", "true");
  q.set("order", "votes");
  q.set("reverse", "true");
  const stations = (await radioApi<RadioBrowserStation[]>(`/json/stations/search?${q}`)).map(stationSummary);
  return params.tag ? filterStationsByTag(stations, params.tag, limit) : stations;
}

export async function fetchCountries(): Promise<CountryOption[]> {
  return toCountryOptions(await radioApi<RadioBrowserNamedCount[]>("/json/countries"));
}

export async function fetchStates(countryName: string): Promise<CountedOption[]> {
  return toStateOptions(await radioApi<RadioBrowserNamedCount[]>(`/json/states/${encodeURIComponent(countryName)}/`));
}

export async function fetchTags(countryCode = "", state = ""): Promise<CountedOption[]> {
  if (!countryCode && !state) {
    return toTagOptions(await radioApi<RadioBrowserNamedCount[]>(`/json/tags?order=stationcount&reverse=true&limit=${TAG_LIMIT}`));
  }
  const q = new URLSearchParams();
  if (countryCode) q.set("countrycode", countryCode);
  if (state) q.set("state", state);
  q.set("hidebroken", "true");
  q.set("order", "votes");
  q.set("reverse", "true");
  q.set("limit", String(TAG_SAMPLE_SIZE));
  return countTags(await radioApi<RadioBrowserStation[]>(`/json/stations/search?${q}`), TAG_LIMIT);
}

export async function registerStationClick(uuid: string): Promise<void> {
  await radioApi(`/json/url/${encodeURIComponent(uuid)}`).catch(() => undefined);
}
