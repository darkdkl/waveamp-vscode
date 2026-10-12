import { describe, expect, it } from "vitest";
import { displayName, formatTime, stationHost, stationMeta } from "../../src/webview/format";

const station = (extra: Record<string, unknown> = {}) => ({
  stationuuid: "a",
  name: "Harbor FM",
  url: "http://radio.test/live",
  favicon: "",
  tags: "",
  country: "Norway",
  countrycode: "NO",
  state: "",
  bitrate: 192,
  codec: "MP3",
  ...extra,
});

describe("formatTime", () => {
  it("shows minutes and seconds, also past an hour", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(75.9)).toBe("01:15");
    expect(formatTime(3725)).toBe("62:05");
  });

  it("shows zero for missing or broken values", () => {
    expect(formatTime(undefined)).toBe("00:00");
    expect(formatTime(null)).toBe("00:00");
    expect(formatTime(NaN)).toBe("00:00");
    expect(formatTime(Infinity)).toBe("00:00");
    expect(formatTime(-5)).toBe("00:00");
  });
});

describe("displayName", () => {
  it("prefers artist and title from the tags", () => {
    const tags = { title: "Highway Lights", artist: "Night Route", album: null, duration: null };
    expect(displayName({ name: "01 track", tags })).toBe("Night Route — Highway Lights");
    expect(displayName({ name: "01 track", tags: { ...tags, artist: null } })).toBe("Highway Lights");
    expect(displayName({ name: "01 track" })).toBe("01 track");
  });
});

describe("stations", () => {
  it("describes catalog stations by country and quality", () => {
    expect(stationMeta(station())).toBe("Norway · MP3 192 kbps");
    expect(stationMeta(station({ country: "", bitrate: 0 }))).toBe("MP3");
  });

  it("describes custom stations by their host", () => {
    expect(stationMeta(station({ custom: true, sourceUrl: "https://radio.test:8443/listen.pls" }))).toBe("radio.test:8443");
    expect(stationHost("not a url")).toBe("not a url");
  });
});
