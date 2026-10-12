import * as vscode from "vscode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeLog } from "./log";
import type { MediaServer } from "./server";
import type { PlayerTrack } from "./shared/messages";
import type { PlaylistEntry, TrackTags } from "./shared/types";
import { readTrackTags } from "./tags";

export const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "m4b", "aac", "weba"];
const AUDIO_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join("|")}|cue)$`, "i");
const TAG_READ_CONCURRENCY = 4;
const TAG_BATCH_SIZE = 100;
const TAG_BATCH_DELAY_MS = 200;

export type StoredTrack = PlaylistEntry & { name?: string };

export function trackFor(server: MediaServer, filePath: string, entry: StoredTrack = { path: filePath }): PlayerTrack {
  const fileName = path.basename(filePath).replace(/\.[^.]+$/, "");
  const segment = typeof entry.start === "number" && entry.start >= 0;
  const end = segment && typeof entry.end === "number" && entry.end > entry.start! ? entry.end : null;
  return {
    path: filePath,
    name: entry.name || (segment && entry.tags?.title) || fileName,
    url: server.fileUrl(filePath),
    decodedUrl: /\.(m4a|m4b|mp4|aac)$/i.test(filePath) ? server.decodedUrl(filePath) : null,
    ...(segment
      ? { start: entry.start, end, tags: entry.tags, duration: end === null ? null : end - entry.start! }
      : entry.tags
        ? { tags: entry.tags, duration: entry.tags.duration }
        : {}),
  };
}

export async function audioFilesIn(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (AUDIO_RE.test(entry.name)) found.push(full);
    }
  };
  await walk(folder);
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function localFiles(uris: readonly vscode.Uri[] | undefined): string[] {
  return (uris ?? []).filter((uri) => uri.scheme === "file").map((uri) => uri.fsPath);
}

export const localDialogStart = () => (vscode.env.remoteName ? { defaultUri: vscode.Uri.file(os.homedir()) } : {});

export async function readTagsInBatches(
  tracks: { path: string; start?: number; tags?: TrackTags }[],
  onBatch: (items: { path: string; tags: TrackTags }[]) => void
): Promise<void> {
  const pending = [...new Set(tracks.filter((track) => track.start == null && !track.tags).map((track) => track.path))];
  let batch: { path: string; tags: TrackTags }[] = [];
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (batch.length) onBatch(batch);
    batch = [];
  };
  const worker = async () => {
    for (let filePath = pending.shift(); filePath; filePath = pending.shift()) {
      const tags = await readTrackTags(filePath).catch((err: Error) => {
        writeLog("warn", "tags", `Could not read tags for "${filePath}": ${err.message}`);
        return null;
      });
      if (!tags) continue;
      batch.push({ path: filePath, tags });
      if (batch.length >= TAG_BATCH_SIZE) flush();
      else timer ??= setTimeout(flush, TAG_BATCH_DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: TAG_READ_CONCURRENCY }, worker));
  flush();
}
