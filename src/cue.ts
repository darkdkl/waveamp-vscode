import path from "node:path";
import fs from "node:fs/promises";
import { cueSegments, decodeCueText, parseCue, resolveCueFileName, type CueSheet } from "./shared/cue";
import type { PlaylistEntry } from "./shared/types";
import { loadMusicMetadata } from "./tags";
import { writeLog } from "./log";

const CUE_EXT_RE = /\.cue$/i;
const CUE_MAX_BYTES = 512 * 1024;

interface ResolvedCue {
  sheet: CueSheet;
  files: { path: string; index: number }[];
}

async function readDir(dir: string, cache: Map<string, Promise<string[]>>): Promise<string[]> {
  let pending = cache.get(dir);
  if (!pending) {
    pending = fs.readdir(dir).catch(() => []);
    cache.set(dir, pending);
  }
  return pending;
}

async function readCue(cuePath: string, dirs: Map<string, Promise<string[]>>): Promise<ResolvedCue | null> {
  try {
    const stat = await fs.stat(cuePath);
    if (!stat.isFile() || stat.size > CUE_MAX_BYTES) return null;
    const sheet = parseCue(decodeCueText(await fs.readFile(cuePath)));
    const dir = path.dirname(cuePath);
    const entries = await readDir(dir, dirs);
    const files = sheet.files.flatMap((file, index) => {
      const name = resolveCueFileName(file.name, entries);
      return name ? [{ path: path.join(dir, name), index }] : [];
    });
    return files.length ? { sheet, files } : null;
  } catch (err) {
    writeLog("warn", "cue", `Could not read "${cuePath}": ${(err as Error).message}`);
    return null;
  }
}

async function fileDuration(filePath: string): Promise<number | null> {
  try {
    const { parseFile } = await loadMusicMetadata();
    const { format } = await parseFile(filePath, { skipCovers: true });
    return typeof format.duration === "number" && Number.isFinite(format.duration) ? format.duration : null;
  } catch {
    return null;
  }
}

async function segmentEntries(cue: ResolvedCue, filePath: string, index: number): Promise<PlaylistEntry[]> {
  const segments = cueSegments(cue.sheet, cue.sheet.files[index], await fileDuration(filePath));
  return segments.map((segment) => ({
    path: filePath,
    start: segment.start,
    end: segment.end,
    tags: {
      title: segment.title,
      artist: segment.artist,
      album: segment.album,
      duration: segment.end === null ? null : segment.end - segment.start,
    },
  }));
}

export async function expandPlaylistPaths(paths: string[]): Promise<PlaylistEntry[]> {
  const dirs = new Map<string, Promise<string[]>>();
  const cues = new Map<string, Promise<ResolvedCue | null>>();
  const loadCue = (cuePath: string) => {
    let pending = cues.get(cuePath);
    if (!pending) {
      pending = readCue(cuePath, dirs);
      cues.set(cuePath, pending);
    }
    return pending;
  };
  const findCueFor = async (filePath: string) => {
    const dir = path.dirname(filePath);
    const cueNames = (await readDir(dir, dirs)).filter((name) => CUE_EXT_RE.test(name)).sort();
    for (const name of cueNames) {
      const cue = await loadCue(path.join(dir, name));
      const file = cue?.files.find((f) => f.path === filePath);
      if (cue && file) return { cue, index: file.index };
    }
    return null;
  };

  const added = new Set<string>();
  const result: PlaylistEntry[] = [];
  for (const filePath of paths) {
    if (CUE_EXT_RE.test(filePath)) {
      const cue = await loadCue(filePath);
      for (const file of cue?.files ?? []) {
        if (added.has(file.path)) continue;
        added.add(file.path);
        result.push(...(await segmentEntries(cue as ResolvedCue, file.path, file.index)));
      }
      continue;
    }
    if (added.has(filePath)) continue;
    added.add(filePath);
    const match = await findCueFor(filePath);
    result.push(...(match ? await segmentEntries(match.cue, filePath, match.index) : [{ path: filePath }]));
  }
  return result;
}
