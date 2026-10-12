import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AlacDecoder, parseAlacConfig, type AlacConfig } from "../../src/alac/decoder";
import { readAlacTrack, type AlacTrack, type ByteSource } from "../../src/alac/mp4";
import { openDecodedFile, type DecodableTrack } from "../../src/decode/tracks";
import { frameIndexForSample, parseRange, wavHeader, wavLayout, wavStream } from "../../src/decode/wav";

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private count = 0;

  put(value: number, bits: number): this {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      if (++this.count === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.count = 0;
      }
    }
    return this;
  }

  finish(): Uint8Array {
    while (this.count) this.put(0, 1);
    return Uint8Array.from(this.bytes);
  }
}

const FRAME_LENGTH = 4096;

function config(bitDepth: number, numChannels: number): AlacConfig {
  return { frameLength: FRAME_LENGTH, bitDepth, pb: 40, mb: 10, kb: 14, numChannels, maxRun: 255, sampleRate: 44100 };
}

function configBytes(c: AlacConfig): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, c.frameLength);
  bytes.set([0, c.bitDepth, c.pb, c.mb, c.kb, c.numChannels], 4);
  view.setUint16(10, c.maxRun);
  view.setUint32(20, c.sampleRate);
  return bytes;
}

function signal(channel: number, i: number, bitDepth: number): number {
  const base = channel === 0 ? ((i * 97) % 4001) - 2000 : ((i * 53) % 3001) - 1500;
  return base * (bitDepth === 16 ? 8 : 2000);
}

function escapeFrame(c: AlacConfig, start: number, samples: number): Uint8Array {
  const bits = new BitWriter();
  const element = c.numChannels === 2 ? 1 : 0;
  const partial = samples !== c.frameLength;
  bits.put(element, 3).put(0, 4).put(0, 12).put(partial ? 1 : 0, 1).put(0, 2).put(1, 1);
  if (partial) bits.put(samples, 32);
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < c.numChannels; ch++) {
      const v = signal(ch, start + i, c.bitDepth);
      bits.put(v < 0 ? v + 2 ** c.bitDepth : v, c.bitDepth);
    }
  }
  return bits.put(7, 3).finish();
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  let offset = 8;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}

function buildM4a(c: AlacConfig, totalSamples: number, codec = "alac", moovFirst = true) {
  const frames: Uint8Array[] = [];
  for (let start = 0; start < totalSamples; start += c.frameLength) {
    frames.push(escapeFrame(c, start, Math.min(c.frameLength, totalSamples - start)));
  }
  const full = Math.floor(totalSamples / c.frameLength);
  const rest = totalSamples % c.frameLength;
  const sampleEntry = box(codec, new Uint8Array(6), new Uint8Array([0, 1]), new Uint8Array(8), u32((c.numChannels << 16) | 16, 0, c.sampleRate * 65536), box("alac", new Uint8Array(4), configBytes(c)));
  const stsd = box("stsd", u32(0, 1), sampleEntry);
  const stts = box("stts", u32(0, rest ? 2 : 1, full, c.frameLength, ...(rest ? [1, rest] : [])));
  const stsc = box("stsc", u32(0, 1, 1, 1, 1));
  const stsz = box("stsz", u32(0, 0, frames.length, ...frames.map((f) => f.length)));
  const mdatPayload = new Uint8Array(frames.reduce((sum, f) => sum + f.length, 0));
  let offset = 0;
  for (const f of frames) {
    mdatPayload.set(f, offset);
    offset += f.length;
  }
  const moov = (base: number) => {
    const chunkOffsets: number[] = [];
    let position = base;
    for (const f of frames) {
      chunkOffsets.push(position);
      position += f.length;
    }
    const stco = box("stco", u32(0, frames.length, ...chunkOffsets));
    return box("moov", box("trak", box("mdia", box("minf", box("stbl", stsd, stts, stsc, stsz, stco)))));
  };
  const ftyp = box("ftyp", new Uint8Array([77, 52, 65, 32]), u32(0));
  const moovSize = moov(0).length;
  const bytes = moovFirst
    ? concat(ftyp, moov(ftyp.length + moovSize + 8), box("mdat", mdatPayload))
    : concat(ftyp, box("mdat", mdatPayload), moov(ftyp.length + 8));
  return { bytes, frames };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function memorySource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  return concat(...chunks);
}

function decodable(track: AlacTrack): DecodableTrack {
  return {
    sampleRate: track.config.sampleRate,
    channels: track.config.numChannels,
    bitDepth: track.config.bitDepth,
    totalSamples: track.totalSamples,
    skipSamples: 0,
    frameStarts: track.frameStarts,
    frameOffsets: track.frameOffsets,
    frameSizes: track.frameSizes,
    preroll: 0,
    createDecoder: async () => {
      const decoder = new AlacDecoder(track.config);
      return { decode: (frame) => decoder.decode(frame), close: () => {} };
    },
  };
}

describe("AlacDecoder", () => {
  it("decodes uncompressed stereo 16-bit frames, including a short last frame", () => {
    const c = config(16, 2);
    const decoder = new AlacDecoder(c);
    const full = decoder.decode(escapeFrame(c, 0, FRAME_LENGTH));
    expect(full.samples).toBe(FRAME_LENGTH);
    expect(full.channels[0][123]).toBe(signal(0, 123, 16));
    expect(full.channels[1][4095]).toBe(signal(1, 4095, 16));
    const last = decoder.decode(escapeFrame(c, FRAME_LENGTH, 500));
    expect(last.samples).toBe(500);
    expect(Array.from(last.channels[0].slice(0, 3))).toEqual([0, 1, 2].map((i) => signal(0, FRAME_LENGTH + i, 16)));
  });

  it("decodes uncompressed mono 24-bit frames", () => {
    const c = config(24, 1);
    const frame = new AlacDecoder(c).decode(escapeFrame(c, 0, 300));
    expect(frame.channels).toHaveLength(1);
    expect(Array.from(frame.channels[0].slice(10, 13))).toEqual([10, 11, 12].map((i) => signal(0, i, 24)));
  });

  it("decodes a compressed frame header and rice-coded residuals", () => {
    const c = config(16, 1);
    const frame = (code: number[]) => {
      const bits = new BitWriter().put(0, 3).put(0, 4).put(0, 12).put(1, 1).put(0, 2).put(0, 1).put(1, 32);
      bits.put(0, 8).put(0, 8).put(0, 4).put(0, 4).put(4, 3).put(0, 5);
      code.forEach((b) => bits.put(b, 1));
      return bits.put(7, 3).finish();
    };
    expect(new AlacDecoder(c).decode(frame([1, 1, 1, 1, 0])).channels[0][0]).toBe(2);
    expect(new AlacDecoder(c).decode(frame([1, 1, 1, 1, 1, 0])).channels[0][0]).toBe(-3);
  });

  it("rejects broken frames", () => {
    const c = config(16, 2);
    expect(() => new AlacDecoder(c).decode(escapeFrame(c, 0, 100).slice(0, 20))).toThrow();
    expect(() => new AlacDecoder(c).decode(new Uint8Array([0x20, 0xff, 0xff]))).toThrow();
  });

  it("reads the magic cookie", () => {
    expect(parseAlacConfig(configBytes(config(24, 2)))).toEqual(config(24, 2));
  });
});

describe("readAlacTrack", () => {
  it("finds the ALAC track and its frames with moov before or after mdat", async () => {
    for (const moovFirst of [true, false]) {
      const { bytes, frames } = buildM4a(config(16, 2), 5000, "alac", moovFirst);
      const track = await readAlacTrack(memorySource(bytes));
      expect(track?.config).toEqual(config(16, 2));
      expect(track?.totalSamples).toBe(5000);
      expect(Array.from(track!.frameStarts)).toEqual([0, 4096]);
      expect(Array.from(track!.frameSizes)).toEqual(frames.map((f) => f.length));
      expect(bytes.slice(track!.frameOffsets[1], track!.frameOffsets[1] + 4)).toEqual(frames[1].slice(0, 4));
    }
  });

  it("returns null for AAC and for files that are not MP4", async () => {
    expect(await readAlacTrack(memorySource(buildM4a(config(16, 2), 100, "mp4a").bytes))).toBeNull();
    expect(await readAlacTrack(memorySource(new TextEncoder().encode("RIFF....WAVEfmt ")))).toBeNull();
  });
});

describe("wavStream", () => {
  const c = config(16, 2);
  const { bytes } = buildM4a(c, 5000);

  async function stream(first: number, last: number) {
    const track = decodable((await readAlacTrack(memorySource(bytes)))!);
    let closed = false;
    const data = await readAll(wavStream(track, memorySource(bytes), first, last, () => (closed = true), () => {}));
    return { track, data, closed };
  }

  it("serves a WAV with the header and interleaved samples", async () => {
    const { track, data, closed } = await stream(0, 44 + 5000 * 4 - 1);
    expect(closed).toBe(true);
    expect(data.length).toBe(wavLayout(track).totalBytes);
    expect(data.slice(0, 44)).toEqual(wavHeader(track.sampleRate, wavLayout(track)));
    const view = new DataView(data.buffer);
    expect(view.getInt16(44 + 4500 * 4, true)).toBe(signal(0, 4500, 16));
    expect(view.getInt16(44 + 4500 * 4 + 2, true)).toBe(signal(1, 4500, 16));
  });

  it("serves any byte range as the same bytes as the whole file", async () => {
    const whole = (await stream(0, 44 + 5000 * 4 - 1)).data;
    for (const [first, last] of [[10, 100], [45, 16429], [16427, 16500], [19999, 20043]]) {
      expect((await stream(first, last)).data).toEqual(whole.slice(first, last + 1));
    }
  });

  it("finds the frame that holds a sample", async () => {
    const { track } = await stream(0, 0);
    expect(frameIndexForSample(track, 0)).toBe(0);
    expect(frameIndexForSample(track, 4095)).toBe(0);
    expect(frameIndexForSample(track, 4096)).toBe(1);
    expect(frameIndexForSample(track, 4999)).toBe(1);
  });
});

describe("wavHeader", () => {
  it("caps the sizes of files over 4 GB and marks live streams as endless", () => {
    const layout = wavLayout({ channels: 2, bitDepth: 16, totalSamples: 1_200_000_000 });
    const view = new DataView(wavHeader(44100, layout).buffer);
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(view.getUint32(40, true)).toBe(0xffffffff);
    const live = new DataView(wavHeader(44100, wavLayout({ channels: 2, bitDepth: 16, totalSamples: 0 }), true).buffer);
    expect(live.getUint32(40, true)).toBe(0xffffffff);
  });
});

describe("openDecodedFile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waveamp-test-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("opens an ALAC .m4a and serves it as WAV", async () => {
    const c = config(16, 2);
    const file = path.join(dir, "album.m4a");
    fs.writeFileSync(file, buildM4a(c, 5000).bytes);
    const opened = (await openDecodedFile(file))!;
    expect(opened.track.sampleRate).toBe(44100);
    expect(opened.track.totalSamples).toBe(5000);
    let closed = false;
    const data = await readAll(wavStream(opened.track, opened.source, 0, 44 + 5000 * 4 - 1, () => ((closed = true), opened.close()), () => {}));
    expect(closed).toBe(true);
    expect(new DataView(data.buffer).getInt16(44 + 100 * 4, true)).toBe(signal(0, 100, 16));
  });

  it("returns null for files without a supported audio track", async () => {
    const file = path.join(dir, "notes.m4a");
    fs.writeFileSync(file, "not an mp4 file");
    expect(await openDecodedFile(file)).toBeNull();
  });
});

describe("parseRange", () => {
  it("reads open, closed and suffix ranges", () => {
    expect(parseRange(null, 1000)).toEqual({ first: 0, last: 999 });
    expect(parseRange("bytes=0-", 1000)).toEqual({ first: 0, last: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ first: 100, last: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ first: 900, last: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ first: 900, last: 999 });
  });

  it("rejects ranges outside the file", () => {
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=5-1", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});
