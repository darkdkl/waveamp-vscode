import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AacDecoder } from "../../src/aac/faad";
import { baseLayerConfig } from "../../src/aac/config";
import { ADTS_SAMPLES_PER_BLOCK, findAdtsSync, id3Size, parseAdtsHeader } from "../../src/decode/adts";
import { LiveAacToWav } from "../../src/decode/wav";

const SILENT_STEREO_FRAME = [0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80];
const RATE_44100 = 4;

function adtsFrame(payload: number[], rateIndex = RATE_44100, channels = 2, blocks = 1): Uint8Array {
  const length = 7 + payload.length;
  return Uint8Array.from([
    0xff,
    0xf1,
    (1 << 6) | (rateIndex << 2) | (channels >> 2),
    ((channels & 3) << 6) | ((length >> 11) & 3),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc | (blocks - 1),
    ...payload,
  ]);
}

function adtsStream(frames: number): Buffer {
  return Buffer.concat(Array.from({ length: frames }, () => adtsFrame(SILENT_STEREO_FRAME)));
}

function bits(...fields: [number, number][]): Uint8Array {
  const all = fields.flatMap(([value, count]) => Array.from({ length: count }, (_, i) => (value >> (count - 1 - i)) & 1));
  const out = new Uint8Array(Math.ceil(all.length / 8));
  all.forEach((bit, i) => (out[i >> 3] |= bit << (7 - (i & 7))));
  return out;
}

beforeAll(() => {
  const readFileSync = fs.readFileSync;
  const wasm = path.join(__dirname, "../../vendor/faad2/faad.wasm");
  vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) =>
    (readFileSync as (...args: unknown[]) => unknown)(String(file).endsWith("faad.wasm") ? wasm : file, ...rest)) as typeof fs.readFileSync);
});

afterAll(() => vi.restoreAllMocks());

describe("ADTS", () => {
  it("reads the frame header", () => {
    expect(parseAdtsHeader(adtsFrame(SILENT_STEREO_FRAME), 0)).toEqual({ length: 16, sampleRate: 44100, channels: 2, blocks: 1 });
    expect(parseAdtsHeader(adtsFrame([1, 2], 3, 1, 2), 0)).toEqual({ length: 9, sampleRate: 48000, channels: 1, blocks: 2 });
    expect(parseAdtsHeader(new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0]), 0)).toBeNull();
  });

  it("finds a sync word only where the next frame follows", () => {
    const stream = Buffer.concat([Buffer.from([0xff, 0xf1, 0, 0, 0, 0, 0, 0x12]), adtsStream(3)]);
    expect(findAdtsSync(stream, 0)).toBe(8);
  });

  it("measures an ID3 tag in front of the audio", () => {
    expect(id3Size(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 1, 0]))).toBe(10 + 128);
    expect(id3Size(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 5]))).toBe(10 + 5 + 10);
    expect(id3Size(adtsFrame(SILENT_STEREO_FRAME))).toBe(0);
  });
});

describe("baseLayerConfig", () => {
  it("keeps an AAC-LC config as it is", () => {
    const lc = bits([2, 5], [RATE_44100, 4], [2, 4], [0, 3]);
    expect(baseLayerConfig(lc)).toBe(lc);
  });

  it("turns HE-AAC and HE-AAC v2 configs into their AAC-LC core", () => {
    const sbr = bits([5, 5], [6, 4], [2, 4], [3, 4], [2, 5], [0, 3]);
    expect(baseLayerConfig(sbr)).toEqual(bits([2, 5], [6, 4], [2, 4], [0, 3]));
    const ps = bits([29, 5], [6, 4], [1, 4], [3, 4], [2, 5], [0, 3]);
    expect(baseLayerConfig(ps)).toEqual(bits([2, 5], [6, 4], [1, 4], [0, 3]));
  });
});

describe("AacDecoder", () => {
  it("decodes AAC-LC frames to PCM", async () => {
    const decoder = await AacDecoder.create();
    const stream = adtsStream(4);
    expect(decoder.initStream(stream)).toMatchObject({ sampleRate: 44100, channels: 2 });
    let samples = 0;
    for (let offset = 0; offset < stream.length; offset += 16) {
      const output = decoder.decode(stream.subarray(offset, offset + 16));
      expect(output.error).toBe(0);
      samples += output.pcm.length;
    }
    expect(samples).toBeGreaterThanOrEqual(3 * ADTS_SAMPLES_PER_BLOCK * 2);
    decoder.close();
  });

  it("can be closed more than once", async () => {
    const decoder = await AacDecoder.create();
    decoder.close();
    expect(() => decoder.close()).not.toThrow();
  });
});

describe("LiveAacToWav", () => {
  function play(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const converter = new LiveAacToWav();
      converter.on("data", (chunk: Buffer) => chunks.push(chunk));
      converter.on("close", () => resolve(Buffer.concat(chunks)));
      converter.on("error", reject);
      Readable.from([input.subarray(0, 37), input.subarray(37)]).pipe(converter);
    });
  }

  it("turns ADTS into an endless WAV stream", async () => {
    const wav = await play(adtsStream(10));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(40)).toBe(0xffffffff);
    expect(wav.length).toBeGreaterThan(44 + 8 * ADTS_SAMPLES_PER_BLOCK * 4);
  });

  it("stops when the station switches to another sample rate", async () => {
    const switched = Buffer.concat([adtsStream(5), ...Array.from({ length: 5 }, () => adtsFrame(SILENT_STEREO_FRAME, 3))]);
    await expect(play(switched)).rejects.toThrow("AAC stream changed its sample rate");
  });

  it("keeps decoding after earlier streams have ended", async () => {
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) sizes.push((await play(adtsStream(10))).length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeGreaterThan(44);
  });
});
