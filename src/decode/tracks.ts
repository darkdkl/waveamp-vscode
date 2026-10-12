import fs from "node:fs/promises";
import { AlacDecoder, type DecodedFrame } from "../alac/decoder";
import { readMp4AudioTrack, type ByteSource, type FrameTable } from "../alac/mp4";
import { AacDecoder } from "../aac/faad";
import { baseLayerConfig } from "../aac/config";
import { ADTS_SAMPLES_PER_BLOCK, findAdtsSync, id3Size, parseAdtsHeader } from "./adts";

const TRACK_CACHE_LIMIT = 8;
const SCAN_CHUNK_BYTES = 1024 * 1024;
const AAC_PREROLL_FRAMES = 2;

export interface FrameDecoder {
  decode(frame: Uint8Array): DecodedFrame;
  close(): void;
}

export interface DecodableTrack extends FrameTable {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  totalSamples: number;
  skipSamples: number;
  preroll: number;
  createDecoder(): Promise<FrameDecoder>;
}

export function pcmToFrame(pcm: Int16Array, outChannels: number, channels: number): DecodedFrame {
  const samples = outChannels ? Math.floor(pcm.length / outChannels) : 0;
  const out = Array.from({ length: channels }, () => new Int32Array(samples));
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < channels; ch++) out[ch][i] = pcm[i * outChannels + Math.min(ch, outChannels - 1)];
  }
  return { samples, channels: out };
}

function aacDecoder(init: (decoder: AacDecoder) => boolean, channels: number): () => Promise<FrameDecoder> {
  return async () => {
    const decoder = await AacDecoder.create();
    if (!init(decoder)) {
      decoder.close();
      throw new Error("AAC decoder rejected the stream");
    }
    return {
      decode: (frame) => {
        const output = decoder.decode(frame);
        return pcmToFrame(output.pcm, output.channels, channels);
      },
      close: () => decoder.close(),
    };
  };
}

async function probeAac(init: (decoder: AacDecoder) => { sampleRate: number; channels: number } | null) {
  const decoder = await AacDecoder.create();
  try {
    return init(decoder);
  } finally {
    decoder.close();
  }
}

async function mp4Track(source: ByteSource): Promise<DecodableTrack | null> {
  const track = await readMp4AudioTrack(source);
  if (!track) return null;
  const { frameOffsets, frameSizes } = track;
  if (track.codec === "alac") {
    const { config } = track;
    return {
      sampleRate: config.sampleRate,
      channels: config.numChannels,
      bitDepth: config.bitDepth,
      totalSamples: track.totalSamples,
      skipSamples: 0,
      frameStarts: track.frameStarts,
      frameOffsets,
      frameSizes,
      preroll: 0,
      createDecoder: async () => {
        const decoder = new AlacDecoder(config);
        return { decode: (frame) => decoder.decode(frame), close: () => {} };
      },
    };
  }
  const config = baseLayerConfig(track.config);
  const info = await probeAac((decoder) => decoder.initConfig(config));
  if (!info) return null;
  const channels = Math.min(2, Math.max(1, info.channels));
  const decodedSamples = frameSizes.length * ADTS_SAMPLES_PER_BLOCK;
  const { edit, gapless } = track;
  const skipSamples = edit ? Math.round((edit.skip * info.sampleRate) / edit.mediaTimescale) : gapless?.delay ?? 0;
  const playable = edit?.duration
    ? Math.round((edit.duration * info.sampleRate) / edit.movieTimescale)
    : gapless?.samples || Infinity;
  return {
    sampleRate: info.sampleRate,
    channels,
    bitDepth: 16,
    totalSamples: Math.max(0, Math.min(decodedSamples - skipSamples, playable)),
    skipSamples,
    frameStarts: Float64Array.from(frameSizes, (_, i) => i * ADTS_SAMPLES_PER_BLOCK),
    frameOffsets,
    frameSizes,
    preroll: AAC_PREROLL_FRAMES,
    createDecoder: aacDecoder((decoder) => !!decoder.initConfig(config), channels),
  };
}

async function adtsTrack(source: ByteSource): Promise<DecodableTrack | null> {
  const head = await source.read(0, Math.min(source.size, 64 * 1024));
  const skip = id3Size(head);
  const firstChunk = skip ? await source.read(skip, Math.min(source.size - skip, 64 * 1024)) : head;
  const start = findAdtsSync(firstChunk, 0);
  if (start < 0) return null;
  const first = skip + start;
  const header = parseAdtsHeader(firstChunk, start);
  if (!header) return null;
  const info = await probeAac((decoder) => decoder.initStream(firstChunk.subarray(start)));
  if (!info) return null;
  const frameOffsets: number[] = [];
  const frameSizes: number[] = [];
  const frameStarts: number[] = [];
  let totalSamples = 0;
  let offset = first;
  while (offset < source.size) {
    const chunk = await source.read(offset, Math.min(SCAN_CHUNK_BYTES, source.size - offset));
    let position = 0;
    while (position + 7 <= chunk.length) {
      const frame = parseAdtsHeader(chunk, position);
      if (!frame) break;
      if (position + frame.length > chunk.length && offset + position + frame.length <= source.size) break;
      frameOffsets.push(offset + position);
      frameSizes.push(frame.length);
      frameStarts.push(totalSamples);
      totalSamples += frame.blocks * ADTS_SAMPLES_PER_BLOCK;
      position += frame.length;
    }
    if (position === 0) break;
    offset += position;
  }
  if (!frameOffsets.length) return null;
  const channels = Math.min(2, Math.max(1, info.channels));
  return {
    sampleRate: info.sampleRate,
    channels,
    bitDepth: 16,
    totalSamples,
    skipSamples: 0,
    frameStarts: Float64Array.from(frameStarts),
    frameOffsets: Float64Array.from(frameOffsets),
    frameSizes: Uint32Array.from(frameSizes),
    preroll: AAC_PREROLL_FRAMES,
    createDecoder: aacDecoder((decoder) => !!decoder.initStream(firstChunk.subarray(start)), channels),
  };
}

interface CachedTrack {
  mtimeMs: number;
  size: number;
  track: DecodableTrack | null;
}

const trackCache = new Map<string, CachedTrack>();

function fileSource(handle: fs.FileHandle, size: number): ByteSource {
  return {
    size,
    async read(offset, length) {
      const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      await handle.read(buffer, 0, buffer.length, offset);
      return buffer;
    },
  };
}

export async function openDecodedFile(
  filePath: string
): Promise<{ track: DecodableTrack; source: ByteSource; close: () => void } | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const source = fileSource(handle, stat.size);
    let cached = trackCache.get(filePath);
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      const track = /\.aac$/i.test(filePath) ? await adtsTrack(source) : await mp4Track(source);
      cached = { mtimeMs: stat.mtimeMs, size: stat.size, track };
      trackCache.delete(filePath);
      trackCache.set(filePath, cached);
      if (trackCache.size > TRACK_CACHE_LIMIT) trackCache.delete(trackCache.keys().next().value as string);
    }
    if (!cached.track) {
      await handle.close();
      return null;
    }
    return { track: cached.track, source, close: () => void handle.close().catch(() => {}) };
  } catch (err) {
    await handle.close().catch(() => {});
    throw err;
  }
}
