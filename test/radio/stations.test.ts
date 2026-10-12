import { describe, expect, it } from "vitest";
import {
  countTags,
  filterStationsByTag,
  stationSummary,
  toCountryOptions,
  toStateOptions,
  toTagOptions,
} from "../../src/radio/stations";

describe("stationSummary", () => {
  it("prefers the resolved URL and keeps only known fields", () => {
    const fromApi = {
      stationuuid: "abc",
      name: "Radio",
      url: "http://r.example/listen.pls",
      url_resolved: "http://s.example/live",
      favicon: "http://r.example/icon.png",
      tags: "jazz,blues",
      country: "France",
      countrycode: "FR",
      state: "Paris",
      bitrate: 128,
      codec: "MP3",
      votes: 1000,
    };
    expect(stationSummary(fromApi)).toEqual({
      stationuuid: "abc",
      name: "Radio",
      url: "http://s.example/live",
      favicon: "http://r.example/icon.png",
      tags: "jazz,blues",
      country: "France",
      countrycode: "FR",
      state: "Paris",
      bitrate: 128,
      codec: "MP3",
    });
  });

  it("falls back to url and fills empty defaults", () => {
    expect(stationSummary({ stationuuid: "x", name: "Bare", url: "http://s.example/live" })).toEqual({
      stationuuid: "x",
      name: "Bare",
      url: "http://s.example/live",
      favicon: "",
      tags: "",
      country: "",
      countrycode: "",
      state: "",
      bitrate: 0,
      codec: "",
    });
  });
});

function station(tags: string, name = tags) {
  return stationSummary({ stationuuid: name, name, url: "http://s.example/" + name, tags });
}

describe("filterStationsByTag", () => {
  it("matches whole tags case-insensitively and keeps order", () => {
    const stations = [station("Pop,rock", "a"), station("synthpop", "b"), station(" pop ", "c"), station("jazz", "d")];
    expect(filterStationsByTag(stations, "pop", 10).map((s) => s.name)).toEqual(["a", "c"]);
  });

  it("respects the limit", () => {
    const stations = [station("pop", "a"), station("pop", "b"), station("pop", "c")];
    expect(filterStationsByTag(stations, "POP", 2).map((s) => s.name)).toEqual(["a", "b"]);
  });
});

describe("filter options", () => {
  it("builds every country with a code, sorted by name without a leading The", () => {
    const data = [
      { name: "The United States Of America", iso_3166_1: "US", stationcount: 6000 },
      { name: "France", iso_3166_1: "FR", stationcount: 10 },
      { name: "Nowhere", iso_3166_1: "", stationcount: 99 },
      { name: "Empty", iso_3166_1: "EM", stationcount: 0 },
      { name: " ", iso_3166_1: "XX", stationcount: 1 },
      { name: "israel", iso_3166_1: "IL", stationcount: 181 },
      { name: "The Netherlands", iso_3166_1: "NL", stationcount: 900 },
      { name: "Germany", iso_3166_1: "DE", stationcount: 30 },
    ];
    expect(toCountryOptions(data).map((c) => c.code)).toEqual(["FR", "DE", "IL", "NL", "US"]);
    expect(toCountryOptions(data)[0]).toEqual({ code: "FR", name: "France", count: 10 });
  });

  it("builds every region alphabetically, skipping empty names and counts", () => {
    const data = [
      { name: "Bavaria", stationcount: 5 },
      { name: "", stationcount: 9 },
      { name: "Berlin", stationcount: 7 },
      { name: "Ghost", stationcount: 0 },
      { name: " Saarland", stationcount: 1 },
    ];
    expect(toStateOptions(data)).toEqual([
      { name: "Bavaria", count: 5 },
      { name: "Berlin", count: 7 },
      { name: "Saarland", count: 1 },
    ]);
  });

  it("keeps the API's tag order", () => {
    expect(toTagOptions([{ name: "rock", stationcount: 9 }, { name: "", stationcount: 5 }, { name: "pop", stationcount: 12 }])).toEqual([
      { name: "rock", count: 9 },
      { name: "pop", count: 12 },
    ]);
  });

  it("counts tags across stations", () => {
    const stations = [{ tags: "rock, pop" }, { tags: "pop,,jazz" }, { tags: "" }, {}, { tags: "pop" }];
    expect(countTags(stations, 2)).toEqual([
      { name: "pop", count: 3 },
      { name: "rock", count: 1 },
    ]);
  });
});
