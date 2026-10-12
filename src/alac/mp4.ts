import { parseAlacConfig, type AlacConfig } from "./decoder";

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface FrameTable {
  frameOffsets: Float64Array;
  frameSizes: Uint32Array;
  frameStarts: Float64Array;
}

export interface AlacTrack extends FrameTable {
  config: AlacConfig;
  totalSamples: number;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

const MAX_MOOV_BYTES = 64 * 1024 * 1024;

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function* childBoxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return;
    yield { type: boxType(bytes, offset + 4), start: offset + header, end: offset + size };
    offset += size;
  }
}

function findChild(bytes: Uint8Array, parent: Box, type: string): Box | null {
  for (const box of childBoxes(bytes, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

function findPath(bytes: Uint8Array, parent: Box, path: string[]): Box | null {
  let box: Box | null = parent;
  for (const type of path) {
    box = box && findChild(bytes, box, type);
  }
  return box;
}

function findAlacConfig(bytes: Uint8Array, stsd: Box): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const entry of childBoxes(bytes, stsd.start + 8, stsd.end)) {
    if (entry.type !== "alac") continue;
    for (let offset = entry.start + 28; offset + 36 <= entry.end; offset++) {
      if (view.getUint32(offset) === 36 && boxType(bytes, offset + 4) === "alac") {
        return bytes.subarray(offset + 12, offset + 36);
      }
    }
  }
  return null;
}

function readDescriptorLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  let length = 0;
  let next = offset;
  for (let i = 0; i < 4 && next < bytes.length; i++) {
    const byte = bytes[next++];
    length = length * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return { length, next };
}

function parseEsds(bytes: Uint8Array, start: number, end: number): Uint8Array | null {
  let offset = start + 4;
  while (offset + 2 <= end) {
    const tag = bytes[offset];
    const { length, next } = readDescriptorLength(bytes, offset + 1);
    if (tag === 0x03) {
      const flags = bytes[next + 2];
      offset = next + 3 + (flags & 0x80 ? 2 : 0);
      if (flags & 0x40) offset += 1 + bytes[offset];
      if (flags & 0x20) offset += 2;
    } else if (tag === 0x04) {
      offset = next + 13;
    } else if (tag === 0x05) {
      return next + length <= end ? bytes.slice(next, next + length) : null;
    } else {
      offset = next + length;
    }
  }
  return null;
}

function findAacConfig(bytes: Uint8Array, stsd: Box): Uint8Array | null {
  for (const entry of childBoxes(bytes, stsd.start + 8, stsd.end)) {
    if (entry.type !== "mp4a") continue;
    for (let offset = entry.start + 28; offset + 8 <= entry.end; offset++) {
      if (boxType(bytes, offset + 4) !== "esds") continue;
      const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
      if (size < 12 || offset + size > entry.end) continue;
      const config = parseEsds(bytes, offset + 8, offset + size);
      if (config) return config;
    }
  }
  return null;
}

async function readTopLevel(source: ByteSource): Promise<Uint8Array | null> {
  let offset = 0;
  while (offset + 8 <= source.size) {
    const header = await source.read(offset, 16);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let size = view.getUint32(0);
    let headerSize = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = source.size - offset;
    }
    if (size < headerSize) return null;
    if (boxType(header, 4) === "moov") {
      if (size > MAX_MOOV_BYTES) return null;
      return source.read(offset, size);
    }
    offset += size;
  }
  return null;
}

function sampleTable(bytes: Uint8Array, stbl: Box, frameLength: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stsz = findChild(bytes, stbl, "stsz");
  const stsc = findChild(bytes, stbl, "stsc");
  const stts = findChild(bytes, stbl, "stts");
  const stco = findChild(bytes, stbl, "stco") ?? findChild(bytes, stbl, "co64");
  if (!stsz || !stsc || !stco) throw new Error("MP4 sample table is incomplete");

  const uniformSize = view.getUint32(stsz.start + 4);
  const frameCount = view.getUint32(stsz.start + 8);
  const frameSizes = Uint32Array.from({ length: frameCount }, (_, i) =>
    uniformSize || view.getUint32(stsz.start + 12 + i * 4)
  );

  const wide = boxType(bytes, stco.start - 4) === "co64";
  const chunkCount = view.getUint32(stco.start + 4);
  const chunkOffsets = Array.from({ length: chunkCount }, (_, i) =>
    wide ? Number(view.getBigUint64(stco.start + 8 + i * 8)) : view.getUint32(stco.start + 8 + i * 4)
  );

  const runs = Array.from({ length: view.getUint32(stsc.start + 4) }, (_, i) => ({
    firstChunk: view.getUint32(stsc.start + 8 + i * 12) - 1,
    perChunk: view.getUint32(stsc.start + 12 + i * 12),
  }));
  const frameOffsets = new Float64Array(frameCount);
  let placed = 0;
  for (let r = 0; r < runs.length && placed < frameCount; r++) {
    const lastChunk = r + 1 < runs.length ? runs[r + 1].firstChunk : chunkCount;
    for (let chunk = runs[r].firstChunk; chunk < lastChunk && placed < frameCount; chunk++) {
      let offset = chunkOffsets[chunk];
      for (let s = 0; s < runs[r].perChunk && placed < frameCount; s++) {
        frameOffsets[placed] = offset;
        offset += frameSizes[placed++];
      }
    }
  }
  if (placed !== frameCount) throw new Error("MP4 chunk table does not cover all frames");

  const frameStarts = new Float64Array(frameCount);
  let timed = 0;
  let totalSamples = 0;
  if (stts) {
    const entries = view.getUint32(stts.start + 4);
    for (let e = 0; e < entries; e++) {
      const count = view.getUint32(stts.start + 8 + e * 8);
      const delta = view.getUint32(stts.start + 12 + e * 8);
      for (let i = 0; i < count && timed < frameCount; i++) {
        frameStarts[timed++] = totalSamples;
        totalSamples += delta;
      }
    }
  }
  while (timed < frameCount) {
    frameStarts[timed++] = totalSamples;
    totalSamples += frameLength;
  }
  return { frameOffsets, frameSizes, frameStarts, totalSamples };
}

export interface Mp4Edit {
  skip: number;
  duration: number | null;
  mediaTimescale: number;
  movieTimescale: number;
}

export interface Mp4Gapless {
  delay: number;
  samples: number;
}

export interface Mp4FrameTable extends FrameTable {
  edit: Mp4Edit | null;
  gapless: Mp4Gapless | null;
  totalSamples: number;
}

export type Mp4AudioTrack =
  | ({ codec: "alac"; config: AlacConfig } & Mp4FrameTable)
  | ({ codec: "aac"; config: Uint8Array } & Mp4FrameTable);

const AAC_FRAME_LENGTH = 1024;

function timescale(bytes: Uint8Array, box: Box | null): number {
  if (!box) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(box.start + (bytes[box.start] === 1 ? 20 : 12));
}

function readEdit(bytes: Uint8Array, root: Box, trak: Box): Mp4Edit | null {
  const elst = findPath(bytes, trak, ["edts", "elst"]);
  const mediaTimescale = timescale(bytes, findPath(bytes, trak, ["mdia", "mdhd"]));
  const movieTimescale = timescale(bytes, findChild(bytes, root, "mvhd"));
  if (!elst || !mediaTimescale || !movieTimescale) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wide = bytes[elst.start] === 1;
  const count = view.getUint32(elst.start + 4);
  const size = wide ? 20 : 12;
  for (let i = 0; i < count; i++) {
    const at = elst.start + 8 + i * size;
    const duration = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
    const mediaTime = wide ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
    if (mediaTime < 0) continue;
    return { skip: mediaTime, duration: duration || null, mediaTimescale, movieTimescale };
  }
  return null;
}

function readGapless(bytes: Uint8Array): Mp4Gapless | null {
  const name = new TextEncoder().encode("iTunSMPB");
  for (let i = 0; i + name.length <= bytes.length; i++) {
    if (!name.every((byte, j) => bytes[i + j] === byte)) continue;
    const at = i + name.length;
    if (boxType(bytes, at + 4) !== "data") return null;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
    const text = new TextDecoder().decode(bytes.subarray(at + 16, at + size));
    const fields = text.trim().split(/\s+/).map((field) => parseInt(field, 16));
    if (fields.length < 4 || fields.slice(1, 4).some((n) => !Number.isFinite(n))) return null;
    return { delay: fields[1], samples: fields[3] };
  }
  return null;
}

export async function readMp4AudioTrack(source: ByteSource): Promise<Mp4AudioTrack | null> {
  const moov = await readTopLevel(source);
  if (!moov) return null;
  const root: Box = { type: "moov", start: new DataView(moov.buffer, moov.byteOffset).getUint32(0) === 1 ? 16 : 8, end: moov.length };
  for (const trak of childBoxes(moov, root.start, root.end)) {
    if (trak.type !== "trak") continue;
    const stbl = findPath(moov, trak, ["mdia", "minf", "stbl"]);
    const stsd = stbl && findChild(moov, stbl, "stsd");
    if (!stbl || !stsd) continue;
    const alac = findAlacConfig(moov, stsd);
    if (alac) {
      const config = parseAlacConfig(alac);
      return { codec: "alac", config, edit: null, gapless: null, ...sampleTable(moov, stbl, config.frameLength) };
    }
    const aac = findAacConfig(moov, stsd);
    if (aac) {
      const table = sampleTable(moov, stbl, AAC_FRAME_LENGTH);
      return { codec: "aac", config: aac, edit: readEdit(moov, root, trak), gapless: readGapless(moov), ...table };
    }
  }
  return null;
}

export async function readAlacTrack(source: ByteSource): Promise<AlacTrack | null> {
  const track = await readMp4AudioTrack(source);
  return track?.codec === "alac" ? track : null;
}
