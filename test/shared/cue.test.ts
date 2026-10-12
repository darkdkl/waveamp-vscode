import { describe, expect, it } from "vitest";
import { cueSegments, decodeCueText, parseCue, parseCueTime, resolveCueFileName } from "../../src/shared/cue";

const SHEET = `REM GENRE Rock
PERFORMER "Night Drive"
TITLE "Open Road"
FILE "Night Drive - Open Road.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Ignition"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Long Way Home"
    PERFORMER "Night Drive feat. Echo"
    INDEX 00 04:10:50
    INDEX 01 04:12:00
  TRACK 03 AUDIO
    TITLE "Last Exit"
    INDEX 01 09:30:37
`;

describe("parseCueTime", () => {
  it("reads minutes, seconds and CD frames", () => {
    expect(parseCueTime("04:12:00")).toBe(252);
    expect(parseCueTime("00:01:75")).toBeNull();
    expect(parseCueTime("120:00:15")).toBeCloseTo(7200.2);
    expect(parseCueTime("bad")).toBeNull();
  });
});

describe("parseCue", () => {
  it("reads the album, files and tracks with INDEX 01 as the start", () => {
    const sheet = parseCue(SHEET);
    expect(sheet.title).toBe("Open Road");
    expect(sheet.performer).toBe("Night Drive");
    expect(sheet.files).toHaveLength(1);
    expect(sheet.files[0].name).toBe("Night Drive - Open Road.wav");
    expect(sheet.files[0].tracks.map((t) => [t.number, t.title, t.start])).toEqual([
      [1, "Ignition", 0],
      [2, "Long Way Home", 252],
      [3, "Last Exit", 570 + 37 / 75],
    ]);
    expect(sheet.files[0].tracks[1].performer).toBe("Night Drive feat. Echo");
  });

  it("handles CRLF, a BOM, unquoted names and several files", () => {
    const text = '\uFEFFFILE track1.flac WAVE\r\n  TRACK 01 AUDIO\r\n    INDEX 01 00:00:00\r\nFILE "track2.flac" WAVE\r\n  TRACK 02 AUDIO\r\n    INDEX 01 00:00:00\r\n';
    const sheet = parseCue(text);
    expect(sheet.files.map((f) => f.name)).toEqual(["track1.flac", "track2.flac"]);
  });

  it("skips data tracks and tracks without INDEX 01", () => {
    const text = 'FILE "a.flac" WAVE\n TRACK 01 MODE1/2352\n  INDEX 01 00:00:00\n TRACK 02 AUDIO\n  INDEX 00 01:00:00\n TRACK 03 AUDIO\n  INDEX 01 02:00:00\n';
    expect(parseCue(text).files[0].tracks.map((t) => t.number)).toEqual([3]);
  });
});

describe("cueSegments", () => {
  it("ends each track where the next starts and the last at the file end", () => {
    const sheet = parseCue(SHEET);
    const segments = cueSegments(sheet, sheet.files[0], 800);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 252],
      [252, 570 + 37 / 75],
      [570 + 37 / 75, 800],
    ]);
    expect(segments[0].artist).toBe("Night Drive");
    expect(segments[1].artist).toBe("Night Drive feat. Echo");
    expect(segments[2].album).toBe("Open Road");
    expect(cueSegments(sheet, sheet.files[0], null)[2].end).toBeNull();
  });
});

describe("resolveCueFileName", () => {
  const entries = ["Night Drive - Open Road.flac", "cover.jpg", "Open Road.cue"];

  it("finds the file exactly, ignoring case, or by name with another audio extension", () => {
    expect(resolveCueFileName("Night Drive - Open Road.flac", entries)).toBe("Night Drive - Open Road.flac");
    expect(resolveCueFileName("night drive - open road.FLAC", entries)).toBe("Night Drive - Open Road.flac");
    expect(resolveCueFileName("Night Drive - Open Road.wav", entries)).toBe("Night Drive - Open Road.flac");
    expect(resolveCueFileName("C:\\Rips\\Night Drive - Open Road.wav", entries)).toBe("Night Drive - Open Road.flac");
  });

  it("returns null when the file is missing", () => {
    expect(resolveCueFileName("Other.flac", entries)).toBeNull();
    expect(resolveCueFileName("cover.wav", entries)).toBeNull();
  });
});

describe("decodeCueText", () => {
  it("reads UTF-8 with and without a BOM", () => {
    const utf8 = new TextEncoder().encode('TITLE "Маяк"');
    expect(decodeCueText(utf8)).toBe('TITLE "Маяк"');
    expect(decodeCueText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('TITLE "Маяк"');
  });

  it("falls back to cp1251 for old Russian sheets", () => {
    const cp1251 = new Uint8Array([0x54, 0x49, 0x54, 0x4c, 0x45, 0x20, 0x22, 0xcc, 0xe0, 0xff, 0xea, 0x22]);
    expect(decodeCueText(cp1251)).toBe('TITLE "Маяк"');
  });

  it("reads UTF-16 with a BOM", () => {
    const text = 'TITLE "Маяк"';
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      le[2 + i * 2] = text.charCodeAt(i) & 0xff;
      le[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    expect(decodeCueText(le)).toBe(text);
  });
});
