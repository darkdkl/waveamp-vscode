import { describe, expect, it } from "vitest";
import { FAVORITES_LIMIT, normalizeFavorites } from "../src/favorites";

const station = (id: string, extra: Record<string, unknown> = {}) => ({
  stationuuid: id,
  name: `Station ${id}`,
  url: `http://radio.test/${id}`,
  favicon: "",
  tags: "jazz",
  country: "Norway",
  countrycode: "NO",
  state: "",
  bitrate: 128,
  codec: "MP3",
  ...extra,
});

describe("normalizeFavorites", () => {
  it("keeps catalog and custom stations as they are", () => {
    const custom = station("custom-1", { custom: true, sourceUrl: "http://radio.test/listen.pls" });
    expect(normalizeFavorites([station("a"), custom])).toEqual([station("a"), custom]);
  });

  it("drops broken entries, duplicates and unsafe links", () => {
    const favorites = normalizeFavorites([
      null,
      "station",
      station(""),
      station("bad-url", { url: "javascript:alert(1)" }),
      station("a"),
      station("a", { name: "Copy" }),
      station("b", { favicon: "file:///etc/passwd", sourceUrl: "ftp://radio.test/" }),
    ]);
    expect(favorites.map((s) => s.stationuuid)).toEqual(["a", "b"]);
    expect(favorites[1].favicon).toBe("");
    expect(favorites[1]).not.toHaveProperty("sourceUrl");
  });

  it("cleans up text fields and numbers", () => {
    const [favorite] = normalizeFavorites([
      { stationuuid: " x ", url: "https://radio.test/x", name: "  Harbor FM  ", countrycode: "NOR", bitrate: -5, extra: "dropped" },
    ]);
    expect(favorite).toEqual({
      stationuuid: "x",
      name: "Harbor FM",
      url: "https://radio.test/x",
      favicon: "",
      tags: "",
      country: "",
      countrycode: "NO",
      state: "",
      bitrate: 0,
      codec: "",
    });
  });

  it("keeps at most the limit and returns an empty list for anything but an array", () => {
    const many = Array.from({ length: FAVORITES_LIMIT + 10 }, (_, i) => station(String(i)));
    expect(normalizeFavorites(many)).toHaveLength(FAVORITES_LIMIT);
    expect(normalizeFavorites({ favorites: [] })).toEqual([]);
  });
});
