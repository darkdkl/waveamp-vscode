export interface CueTrack {
  number: number;
  title: string | null;
  performer: string | null;
  start: number;
}

export interface CueFile {
  name: string;
  tracks: CueTrack[];
}

export interface CueSheet {
  title: string | null;
  performer: string | null;
  files: CueFile[];
}

const FRAMES_PER_SECOND = 75;

export function parseCueTime(value: string): number | null {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!match) return null;
  const [, minutes, seconds, frames] = match.map(Number);
  if (seconds >= 60 || frames >= FRAMES_PER_SECOND) return null;
  return minutes * 60 + seconds + frames / FRAMES_PER_SECOND;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"(.*)"/.exec(trimmed);
  return (quoted ? quoted[1] : trimmed).trim();
}

function fileName(rest: string): string {
  const trimmed = rest.trim();
  const quoted = /^"(.*)"/.exec(trimmed);
  if (quoted) return quoted[1].trim();
  return trimmed.replace(/\s+\S+$/, "").trim();
}

export function parseCue(text: string): CueSheet {
  const sheet: CueSheet = { title: null, performer: null, files: [] };
  let file: CueFile | null = null;
  let track: (Omit<CueTrack, "start"> & { start: number | null }) | null = null;

  const closeTrack = () => {
    if (file && track && track.start !== null) file.tracks.push({ ...track, start: track.start });
    track = null;
  };

  for (const line of text.replace(/^﻿/, "").split(/\r?\n|\r/)) {
    const match = /^\s*(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const command = match[1].toUpperCase();
    const rest = match[2];
    if (command === "FILE") {
      closeTrack();
      file = { name: fileName(rest), tracks: [] };
      if (file.name) sheet.files.push(file);
    } else if (command === "TRACK") {
      closeTrack();
      const number = parseInt(rest, 10);
      if (file && /\bAUDIO\b/i.test(rest) && Number.isFinite(number)) {
        track = { number, title: null, performer: null, start: null };
      }
    } else if (command === "TITLE") {
      if (track) track.title = unquote(rest) || null;
      else if (!file) sheet.title = unquote(rest) || null;
    } else if (command === "PERFORMER") {
      if (track) track.performer = unquote(rest) || null;
      else if (!file) sheet.performer = unquote(rest) || null;
    } else if (command === "INDEX" && track) {
      const [number, time] = rest.trim().split(/\s+/);
      if (parseInt(number, 10) === 1) track.start = parseCueTime(time ?? "");
    }
  }
  closeTrack();
  sheet.files = sheet.files.filter((f) => f.tracks.length > 0);
  return sheet;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const cp1251Decoder = new TextDecoder("windows-1251");

export function decodeCueText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return cp1251Decoder.decode(bytes);
  }
}

const PLAYABLE_EXT_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/i;

function stem(name: string): string {
  return name.replace(/\.[^./\\]+$/, "").toLowerCase();
}

export function resolveCueFileName(referenced: string, dirEntries: string[]): string | null {
  const base = referenced.split(/[\\/]/).pop() ?? referenced;
  if (dirEntries.includes(base)) return base;
  const lower = base.toLowerCase();
  const sameName = dirEntries.find((entry) => entry.toLowerCase() === lower);
  if (sameName) return sameName;
  return dirEntries.find((entry) => PLAYABLE_EXT_RE.test(entry) && stem(entry) === stem(base)) ?? null;
}

export interface CueSegment {
  number: number;
  start: number;
  end: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
}

export function cueSegments(sheet: CueSheet, file: CueFile, fileDuration: number | null): CueSegment[] {
  const tracks = [...file.tracks].sort((a, b) => a.start - b.start);
  return tracks.map((track, i) => ({
    number: track.number,
    start: track.start,
    end: i + 1 < tracks.length ? tracks[i + 1].start : fileDuration,
    title: track.title,
    artist: track.performer ?? sheet.performer,
    album: sheet.title,
  }));
}
