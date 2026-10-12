import { describe, expect, it } from "vitest";
import { isHttpUrl, playlistKind, parsePlaylistStreamUrl } from "../../src/shared/streamUrl";

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://radio.example/stream")).toBe(true);
    expect(isHttpUrl("https://radio.example:8443/live.mp3")).toBe(true);
  });

  it("rejects other schemes and garbage", () => {
    expect(isHttpUrl("ftp://radio.example/stream")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("radio.example/stream")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("playlistKind", () => {
  it("recognizes .pls and .m3u by path, ignoring case and query", () => {
    expect(playlistKind("http://r.example/listen.pls")).toBe("pls");
    expect(playlistKind("http://r.example/LISTEN.M3U")).toBe("m3u");
    expect(playlistKind("http://r.example/listen.pls?sid=1")).toBe("pls");
  });

  it("leaves direct streams and HLS alone", () => {
    expect(playlistKind("http://r.example/stream")).toBeNull();
    expect(playlistKind("http://r.example/live.mp3")).toBeNull();
    expect(playlistKind("http://r.example/live.m3u8")).toBeNull();
    expect(playlistKind("http://r.example/stream?format=.pls")).toBeNull();
  });
});

describe("parsePlaylistStreamUrl", () => {
  const base = "http://r.example/dir/listen.pls";

  it("takes the first File entry of a PLS playlist", () => {
    const pls = "[playlist]\nNumberOfEntries=2\nFile1=http://s1.example:8000/live\nTitle1=One\nFile2=http://s2.example/live\n";
    expect(parsePlaylistStreamUrl(pls, "pls", base)).toBe("http://s1.example:8000/live");
  });

  it("handles CRLF, a BOM and spaces around =", () => {
    const pls = "﻿[playlist]\r\nFile1 = https://s.example/a.mp3\r\n";
    expect(parsePlaylistStreamUrl(pls, "pls", base)).toBe("https://s.example/a.mp3");
  });

  it("detects PLS content behind an .m3u link", () => {
    const pls = "[playlist]\nFile1=http://s.example/live\n";
    expect(parsePlaylistStreamUrl(pls, "m3u", base)).toBe("http://s.example/live");
  });

  it("skips M3U comments and resolves relative entries", () => {
    const m3u = "#EXTM3U\n#EXTINF:-1,Station\nstream/live.mp3\n";
    expect(parsePlaylistStreamUrl(m3u, "m3u", base)).toBe("http://r.example/dir/stream/live.mp3");
  });

  it("skips entries that are not http(s)", () => {
    const m3u = "#EXTM3U\nrtsp://s.example/live\nhttp://s.example/live\n";
    expect(parsePlaylistStreamUrl(m3u, "m3u", base)).toBe("http://s.example/live");
  });

  it("returns null when there is no stream", () => {
    expect(parsePlaylistStreamUrl("#EXTM3U\n", "m3u", base)).toBeNull();
    expect(parsePlaylistStreamUrl("[playlist]\nNumberOfEntries=0\n", "pls", base)).toBeNull();
    expect(parsePlaylistStreamUrl("", "pls", base)).toBeNull();
  });
});
