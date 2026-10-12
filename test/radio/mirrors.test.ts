import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CatalogUnavailableError,
  createMirrorClient,
  isCacheFresh,
  mirrorOrder,
  mirrorsFromServerList,
  mirrorsFromSrv,
  mirrorUrl,
  parseCache,
  parseSources,
  type DiscoverySource,
  type MirrorCache,
  type MirrorClientDeps,
  type RadioSources,
} from "../../src/radio/mirrors";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-11T12:00:00Z");

describe("parseSources", () => {
  it("accepts the built-in list", () => {
    const sources = parseSources(JSON.parse(fs.readFileSync("media/radio-sources.json", "utf8")));
    expect(sources?.discovery.map((source) => source.type)).toEqual(["dns-srv", "http"]);
    expect(sources?.fallback.length).toBeGreaterThan(0);
    expect(sources?.refreshHours).toBe(24);
  });

  it("drops unusable entries and defaults the refresh period", () => {
    expect(
      parseSources({
        discovery: [{ type: "dns-srv", name: "bad name" }, { type: "http", url: "http://plain.example.org/" }, { type: "ftp" }],
        fallback: ["https://ok.example.org", "http://plain.example.org", "https://ok.example.org/", "https://x.example.org/path"],
        refreshHours: -1,
      })
    ).toEqual({ discovery: [], fallback: ["https://ok.example.org"], refreshHours: 24 });
  });

  it("rejects a list with nothing to use", () => {
    expect(parseSources({ discovery: [], fallback: [] })).toBeNull();
    expect(parseSources("nope")).toBeNull();
    expect(parseSources(null)).toBeNull();
  });
});

describe("mirrorUrl", () => {
  it("keeps only bare https origins", () => {
    expect(mirrorUrl("https://de1.api.radio-browser.info/")).toBe("https://de1.api.radio-browser.info");
    expect(mirrorUrl("https://de1.api.radio-browser.info:8443")).toBe("https://de1.api.radio-browser.info:8443");
    expect(mirrorUrl("http://de1.api.radio-browser.info")).toBeNull();
    expect(mirrorUrl("https://user:pw@de1.api.radio-browser.info")).toBeNull();
    expect(mirrorUrl("https://localhost")).toBeNull();
    expect(mirrorUrl(42)).toBeNull();
  });
});

describe("parseCache", () => {
  it("keeps a valid cache and drops a lastGood that is not listed", () => {
    expect(parseCache({ updatedAt: "2026-10-11T00:00:00Z", mirrors: ["https://a.example.org"], lastGood: "https://b.example.org" })).toEqual({
      updatedAt: "2026-10-11T00:00:00Z",
      mirrors: ["https://a.example.org"],
      lastGood: null,
    });
  });

  it("rejects an empty or undated cache", () => {
    expect(parseCache({ updatedAt: "2026-10-11T00:00:00Z", mirrors: [] })).toBeNull();
    expect(parseCache({ updatedAt: "yesterday", mirrors: ["https://a.example.org"] })).toBeNull();
    expect(parseCache(null)).toBeNull();
  });
});

describe("isCacheFresh", () => {
  const cache = (hoursAgo: number): MirrorCache => ({ updatedAt: new Date(NOW - hoursAgo * HOUR).toISOString(), mirrors: ["https://a.example.org"], lastGood: null });

  it("is fresh within the refresh period only", () => {
    expect(isCacheFresh(cache(1), 24, NOW)).toBe(true);
    expect(isCacheFresh(cache(25), 24, NOW)).toBe(false);
    expect(isCacheFresh(cache(-1), 24, NOW)).toBe(false);
    expect(isCacheFresh(null, 24, NOW)).toBe(false);
  });
});

describe("mirror discovery answers", () => {
  it("turns SRV records into mirrors by priority and weight", () => {
    expect(
      mirrorsFromSrv([
        { name: "b.example.org", port: 443, priority: 2, weight: 1 },
        { name: "a.example.org", port: 8443, priority: 1, weight: 1 },
        { name: "c.example.org", port: 443, priority: 1, weight: 5 },
        { name: "c.example.org", port: 443, priority: 3, weight: 1 },
      ])
    ).toEqual(["https://c.example.org", "https://a.example.org:8443", "https://b.example.org"]);
  });

  it("turns the server list into mirrors and skips junk", () => {
    expect(mirrorsFromServerList([{ name: "de1.api.radio-browser.info", ip: "1.2.3.4" }, { ip: "5.6.7.8" }, null, "x"])).toEqual([
      "https://de1.api.radio-browser.info",
    ]);
    expect(mirrorsFromServerList({ error: "no available server" })).toEqual([]);
  });
});

describe("mirrorOrder", () => {
  it("puts the last working mirror first", () => {
    const order = mirrorOrder({ updatedAt: "", mirrors: ["https://a.example.org", "https://b.example.org", "https://c.example.org"], lastGood: "https://c.example.org" }, () => 0);
    expect(order[0]).toBe("https://c.example.org");
    expect([...order].sort()).toEqual(["https://a.example.org", "https://b.example.org", "https://c.example.org"]);
  });
});

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const USER: RadioSources = {
  discovery: [
    { type: "dns-srv", name: "_api._tcp.user.example.org" },
    { type: "http", url: "https://all.user.example.org/json/servers" },
  ],
  fallback: ["https://fallback.user.example.org"],
  refreshHours: 24,
};

const BUNDLED: RadioSources = {
  discovery: [{ type: "dns-srv", name: "_api._tcp.new.example.org" }],
  fallback: ["https://fallback.new.example.org"],
  refreshHours: 24,
};

function setup(options: {
  cache?: MirrorCache | null;
  user?: RadioSources;
  found?: Record<string, string[] | Error>;
  up?: string[];
  reject?: Record<string, Error>;
  skip?: string[];
}) {
  const saved: MirrorCache[] = [];
  const logs: string[] = [];
  const discovered: string[] = [];
  const requested: string[] = [];
  const key = (source: DiscoverySource) => (source.type === "dns-srv" ? source.name : source.url);
  const deps: MirrorClientDeps = {
    loadUserSources: () => options.user ?? USER,
    loadBundledSources: () => BUNDLED,
    loadCache: () => options.cache ?? null,
    saveCache: (cache) => saved.push(cache),
    discover: async (source) => {
      discovered.push(key(source));
      const answer = options.found?.[key(source)];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    },
    skipReason: (source) => (options.skip?.includes(source.type) ? "proxy is on" : null),
    isMirrorFailure: (err) => !(err instanceof HttpError && err.status === 404),
    log: (level, message) => logs.push(`${level}: ${message}`),
    now: () => NOW,
    random: () => 0.5,
  };
  const client = createMirrorClient(deps);
  const get = (path: string) =>
    client.request(path, async (base) => {
      requested.push(base);
      const rejection = options.reject?.[base];
      if (rejection) throw rejection;
      if (!(options.up ?? []).includes(base)) throw new Error("connect ECONNREFUSED");
      return `${base}${path}`;
    });
  const refresh = () => client.refresh("/json/stats", async (base) => {
    requested.push(base);
    if (!(options.up ?? []).includes(base)) throw new Error("connect ECONNREFUSED");
    return base;
  });
  return { get, refresh, client, saved, logs, discovered, requested };
}

const freshCache = (mirrors: string[], lastGood: string | null = null): MirrorCache => ({
  updatedAt: new Date(NOW - HOUR).toISOString(),
  mirrors,
  lastGood,
});

describe("createMirrorClient", () => {
  it("uses the last working mirror from a fresh cache without discovery", async () => {
    const env = setup({ cache: freshCache(["https://a.example.org", "https://b.example.org"], "https://b.example.org"), up: ["https://b.example.org"] });
    expect(await env.get("/json/tags")).toBe("https://b.example.org/json/tags");
    expect(env.requested).toEqual(["https://b.example.org"]);
    expect(env.discovered).toEqual([]);
    expect(env.saved).toEqual([]);
  });

  it("refreshes a stale cache from the first discovery source and remembers the mirror", async () => {
    const env = setup({
      cache: { ...freshCache(["https://old.example.org"]), updatedAt: new Date(NOW - 30 * HOUR).toISOString() },
      found: { "_api._tcp.user.example.org": ["https://a.example.org"] },
      up: ["https://a.example.org"],
    });
    expect(await env.get("/json/tags")).toBe("https://a.example.org/json/tags");
    expect(env.discovered).toEqual(["_api._tcp.user.example.org"]);
    expect(env.saved.at(-1)).toEqual({ updatedAt: new Date(NOW).toISOString(), mirrors: ["https://a.example.org"], lastGood: "https://a.example.org" });
  });

  it("falls through to the next discovery source and then to the fallback mirrors", async () => {
    const viaHttp = setup({
      found: { "_api._tcp.user.example.org": new Error("ETIMEOUT"), "https://all.user.example.org/json/servers": ["https://h.example.org"] },
      up: ["https://h.example.org"],
    });
    expect(await viaHttp.get("/x")).toBe("https://h.example.org/x");

    const viaFallback = setup({ up: ["https://fallback.user.example.org"] });
    expect(await viaFallback.get("/x")).toBe("https://fallback.user.example.org/x");
    expect(viaFallback.discovered).toEqual(["_api._tcp.user.example.org", "https://all.user.example.org/json/servers"]);
  });

  it("reports the current mirror from the cache", () => {
    expect(setup({ cache: freshCache(["https://a.example.org"], "https://a.example.org") }).client.currentMirror()).toBe("https://a.example.org");
    expect(setup({}).client.currentMirror()).toBeNull();
  });

  it("refresh ignores a fresh cache, rediscovers and remembers the mirror that answers", async () => {
    const env = setup({
      cache: freshCache(["https://old.example.org"], "https://old.example.org"),
      found: { "_api._tcp.user.example.org": ["https://new.example.org"] },
      up: ["https://old.example.org", "https://new.example.org"],
    });
    expect(await env.refresh()).toBe("https://new.example.org");
    expect(env.discovered).toEqual(["_api._tcp.user.example.org"]);
    expect(env.client.currentMirror()).toBe("https://new.example.org");
  });

  it("refresh rejects when nothing answers and keeps the previous cache", async () => {
    const previous = freshCache(["https://old.example.org"], "https://old.example.org");
    const env = setup({ cache: previous });
    await expect(env.refresh()).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(env.client.currentMirror()).toBe("https://old.example.org");
    expect(env.saved.at(-1)).toEqual(previous);
  });

  it("skips a discovery source that would bypass the proxy", async () => {
    const env = setup({
      skip: ["dns-srv"],
      found: { "_api._tcp.user.example.org": ["https://srv.example.org"], "https://all.user.example.org/json/servers": ["https://h.example.org"] },
      up: ["https://srv.example.org", "https://h.example.org"],
    });
    expect(await env.get("/x")).toBe("https://h.example.org/x");
    expect(env.discovered).toEqual(["https://all.user.example.org/json/servers"]);
    expect(env.logs).toContain("info: Skipped mirror discovery via dns-srv (user list): proxy is on");
  });

  it("rediscovers when every cached mirror fails", async () => {
    const env = setup({
      cache: freshCache(["https://dead.example.org"], "https://dead.example.org"),
      found: { "_api._tcp.user.example.org": ["https://dead.example.org", "https://alive.example.org"] },
      up: ["https://alive.example.org"],
    });
    expect(await env.get("/x")).toBe("https://alive.example.org/x");
    expect(env.requested).toEqual(["https://dead.example.org", "https://alive.example.org"]);
    expect(env.saved.at(-1)?.lastGood).toBe("https://alive.example.org");
  });

  it("connects through the built-in list when the user's list is dead and leaves a log line", async () => {
    const env = setup({
      found: { "_api._tcp.new.example.org": ["https://moved.example.org"] },
      up: ["https://moved.example.org"],
    });
    expect(await env.get("/x")).toBe("https://moved.example.org/x");
    expect(env.logs.some((line) => line.startsWith("warn: User radio sources failed"))).toBe(true);
    expect(env.saved.at(-1)).toEqual({ updatedAt: new Date(NOW).toISOString(), mirrors: ["https://moved.example.org"], lastGood: "https://moved.example.org" });
  });

  it("skips the built-in list when it is the same as the user's", async () => {
    const env = setup({ user: BUNDLED });
    await expect(env.get("/x")).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(env.discovered).toEqual(["_api._tcp.new.example.org"]);
  });

  it("reports the catalog as unavailable when nothing answers", async () => {
    const env = setup({ cache: freshCache(["https://a.example.org"]) });
    await expect(env.get("/json/stations/search")).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(env.logs.at(-1)).toBe("error: No radio catalog mirror answered for /json/stations/search");
  });

  it("does not try other mirrors when the request itself is wrong", async () => {
    const env = setup({
      cache: freshCache(["https://a.example.org", "https://b.example.org"], "https://a.example.org"),
      reject: { "https://a.example.org": new HttpError(404) },
      up: ["https://b.example.org"],
    });
    await expect(env.get("/json/states/Nowhere/")).rejects.toThrow("HTTP 404");
    expect(env.requested).toEqual(["https://a.example.org"]);
  });

  it("shares one built-in rescue between requests and warns once", async () => {
    const env = setup({ found: { "_api._tcp.new.example.org": ["https://moved.example.org"] }, up: ["https://moved.example.org"] });
    await Promise.all([env.get("/1"), env.get("/2"), env.get("/3")]);
    expect(env.discovered.filter((name) => name === "_api._tcp.new.example.org")).toHaveLength(1);
    expect(env.logs.filter((line) => line.startsWith("warn: User radio sources failed"))).toHaveLength(1);
  });

  it("shares one discovery between requests that start together", async () => {
    const env = setup({ found: { "_api._tcp.user.example.org": ["https://a.example.org"] }, up: ["https://a.example.org"] });
    await Promise.all([env.get("/1"), env.get("/2"), env.get("/3")]);
    expect(env.discovered).toEqual(["_api._tcp.user.example.org"]);
  });
});
