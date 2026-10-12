import { fixMojibake } from "./textEncoding";
import type { TrackTags } from "./shared/types";

type MusicMetadata = typeof import("music-metadata", { with: { "resolution-mode": "import" } });

let musicMetadata: MusicMetadata | null = null;

export async function loadMusicMetadata(): Promise<MusicMetadata> {
  musicMetadata ??= await import("music-metadata");
  return musicMetadata;
}

export async function readTrackTags(filePath: string): Promise<TrackTags> {
  const { parseFile } = await loadMusicMetadata();
  const { common, format } = await parseFile(filePath, { skipCovers: true });
  return {
    title: fixMojibake(common.title) || null,
    artist: fixMojibake(common.artist || common.albumartist) || null,
    album: fixMojibake(common.album) || null,
    duration: typeof format.duration === "number" && Number.isFinite(format.duration) ? format.duration : null,
  };
}
