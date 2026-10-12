export type DiscoverySource = { type: "dns-srv"; name: string } | { type: "http"; url: string };

export interface RadioSources {
  discovery: DiscoverySource[];
  fallback: string[];
  refreshHours: number;
}

export interface MirrorCache {
  updatedAt: string;
  mirrors: string[];
  lastGood: string | null;
}

export interface SrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const SRV_NAME = /^(_[a-z0-9-]+\.){2}[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const DEFAULT_REFRESH_HOURS = 24;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class CatalogUnavailableError extends Error {
  constructor() {
    super("No radio catalog mirror answered");
    this.name = "CatalogUnavailableError";
  }
}

export function mirrorUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !HOSTNAME.test(url.hostname)) return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueMirrors(values: unknown[]): string[] {
  return [...new Set(values.map(mirrorUrl).filter((url): url is string => url !== null))];
}

function discoverySource(value: unknown): DiscoverySource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.type === "dns-srv" && typeof source.name === "string" && SRV_NAME.test(source.name)) {
    return { type: "dns-srv", name: source.name };
  }
  if (source.type === "http" && typeof source.url === "string") {
    try {
      const url = new URL(source.url);
      if (url.protocol === "https:") return { type: "http", url: url.href };
    } catch {
      return null;
    }
  }
  return null;
}

export function parseSources(raw: unknown): RadioSources | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const discovery = Array.isArray(data.discovery)
    ? data.discovery.map(discoverySource).filter((source): source is DiscoverySource => source !== null)
    : [];
  const fallback = Array.isArray(data.fallback) ? uniqueMirrors(data.fallback) : [];
  if (!discovery.length && !fallback.length) return null;
  const hours = Number(data.refreshHours);
  return { discovery, fallback, refreshHours: hours > 0 ? hours : DEFAULT_REFRESH_HOURS };
}

export function parseCache(raw: unknown): MirrorCache | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const mirrors = Array.isArray(data.mirrors) ? uniqueMirrors(data.mirrors) : [];
  if (!mirrors.length || typeof data.updatedAt !== "string" || Number.isNaN(Date.parse(data.updatedAt))) return null;
  const lastGood = mirrorUrl(data.lastGood);
  return { updatedAt: data.updatedAt, mirrors, lastGood: lastGood && mirrors.includes(lastGood) ? lastGood : null };
}

export function isCacheFresh(cache: MirrorCache | null, refreshHours: number, now: number): boolean {
  if (!cache) return false;
  const age = now - Date.parse(cache.updatedAt);
  return age >= 0 && age < refreshHours * 3_600_000;
}

export function mirrorsFromSrv(records: SrvRecord[]): string[] {
  const sorted = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  return uniqueMirrors(sorted.map((record) => (record.port === 443 ? `https://${record.name}` : `https://${record.name}:${record.port}`)));
}

export function mirrorsFromServerList(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return uniqueMirrors(data.map((server) => (server && typeof server === "object" ? `https://${(server as { name?: unknown }).name}` : null)));
}

export function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function mirrorOrder(cache: MirrorCache, random: () => number): string[] {
  const rest = cache.mirrors.filter((mirror) => mirror !== cache.lastGood);
  return cache.lastGood ? [cache.lastGood, ...shuffled(rest, random)] : shuffled(rest, random);
}

export function sameSources(a: RadioSources, b: RadioSources): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface MirrorClientDeps {
  loadUserSources: () => RadioSources;
  loadBundledSources: () => RadioSources;
  loadCache: () => MirrorCache | null;
  saveCache: (cache: MirrorCache) => void;
  discover: (source: DiscoverySource) => Promise<string[]>;
  skipReason: (source: DiscoverySource) => string | null;
  isMirrorFailure: (err: unknown) => boolean;
  log: (level: "info" | "warn" | "error", message: string) => void;
  now: () => number;
  random: () => number;
}

export function createMirrorClient(deps: MirrorClientDeps) {
  let cache: MirrorCache | null | undefined;
  let userSources: RadioSources | undefined;
  let refreshing: Promise<string[]> | null = null;
  let rescuing: Promise<string[]> | null = null;

  function currentUserSources(): RadioSources {
    if (!userSources) userSources = deps.loadUserSources();
    return userSources;
  }

  function currentCache(): MirrorCache | null {
    if (cache === undefined) cache = deps.loadCache();
    return cache;
  }

  function storeCache(next: MirrorCache): void {
    cache = next;
    deps.saveCache(next);
  }

  async function discoverMirrors(sources: RadioSources, label: string): Promise<string[]> {
    for (const source of sources.discovery) {
      const reason = deps.skipReason(source);
      if (reason) {
        deps.log("info", `Skipped mirror discovery via ${source.type} (${label}): ${reason}`);
        continue;
      }
      try {
        const mirrors = await deps.discover(source);
        if (mirrors.length) {
          deps.log("info", `Found ${mirrors.length} mirrors via ${source.type} (${label})`);
          return mirrors;
        }
        deps.log("warn", `No mirrors via ${source.type} (${label})`);
      } catch (err) {
        deps.log("warn", `Mirror discovery via ${source.type} (${label}) failed: ${errorMessage(err)}`);
      }
    }
    return sources.fallback;
  }

  function refreshFromUserSources(): Promise<string[]> {
    if (!refreshing) {
      refreshing = discoverMirrors(currentUserSources(), "user list")
        .then((mirrors) => {
          if (mirrors.length) storeCache({ updatedAt: new Date(deps.now()).toISOString(), mirrors, lastGood: null });
          return mirrors;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  function discoverFromBundled(bundled: RadioSources): Promise<string[]> {
    if (!rescuing) {
      rescuing = discoverMirrors(bundled, "built-in list").finally(() => {
        rescuing = null;
      });
    }
    return rescuing;
  }

  async function tryMirrors<T>(
    mirrors: string[],
    tried: Set<string>,
    label: string,
    request: (base: string) => Promise<T>
  ): Promise<{ base: string; value: T } | null> {
    for (const base of mirrors) {
      if (tried.has(base)) continue;
      tried.add(base);
      try {
        return { base, value: await request(base) };
      } catch (err) {
        if (!deps.isMirrorFailure(err)) throw err;
        deps.log("warn", `Mirror ${base} failed for ${label}: ${errorMessage(err)}`);
      }
    }
    return null;
  }

  function remember(base: string): void {
    const known = currentCache();
    if (known && known.mirrors.includes(base) && known.lastGood !== base) storeCache({ ...known, lastGood: base });
  }

  async function request<T>(label: string, fn: (base: string) => Promise<T>): Promise<T> {
    const tried = new Set<string>();
    let refreshed = false;
    let known = currentCache();
    if (!isCacheFresh(known, currentUserSources().refreshHours, deps.now())) {
      await refreshFromUserSources();
      refreshed = true;
      known = currentCache();
    }

    if (known) {
      const hit = await tryMirrors(mirrorOrder(known, deps.random), tried, label, fn);
      if (hit) {
        remember(hit.base);
        return hit.value;
      }
    }

    if (!refreshed) {
      const mirrors = await refreshFromUserSources();
      const hit = await tryMirrors(shuffled(mirrors, deps.random), tried, label, fn);
      if (hit) {
        remember(hit.base);
        return hit.value;
      }
    }

    const bundled = deps.loadBundledSources();
    if (!sameSources(currentUserSources(), bundled)) {
      const mirrors = await discoverFromBundled(bundled);
      const hit = await tryMirrors(shuffled(mirrors, deps.random), tried, label, fn);
      if (hit) {
        const current = currentCache();
        if (current?.lastGood !== hit.base || !current.mirrors.includes(hit.base)) {
          deps.log("warn", `User radio sources failed, connected via the built-in list (${hit.base})`);
          storeCache({ updatedAt: new Date(deps.now()).toISOString(), mirrors, lastGood: hit.base });
        }
        return hit.value;
      }
    }

    deps.log("error", `No radio catalog mirror answered for ${label}`);
    throw new CatalogUnavailableError();
  }

  function currentMirror(): string | null {
    return currentCache()?.lastGood ?? null;
  }

  function refresh<T>(label: string, fn: (base: string) => Promise<T>): Promise<T> {
    const previous = currentCache();
    userSources = undefined;
    cache = null;
    return request(label, fn).catch((err: unknown) => {
      if (previous) storeCache(previous);
      throw err;
    });
  }

  return { request, refresh, currentMirror };
}
