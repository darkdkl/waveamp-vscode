import { Transform, type TransformCallback } from "node:stream";
import type { DecodedFrame } from "../alac/decoder";
import type { ByteSource } from "../alac/mp4";
import type { DecodableTrack, FrameDecoder } from "./tracks";
import { pcmToFrame } from "./tracks";
import { AacDecoder } from "../aac/faad";
import { findAdtsSync, parseAdtsHeader } from "./adts";

const WAV_HEADER_BYTES = 44;
const LIVE_BUFFER_LIMIT = 256 * 1024;
const FRAMES_PER_STEP = 32;

export interface WavLayout {
  channels: number;
  bytesPerSample: number;
  blockAlign: number;
  dataBytes: number;
  totalBytes: number;
}

export function wavLayout(track: Pick<DecodableTrack, "channels" | "bitDepth" | "totalSamples">): WavLayout {
  const bytesPerSample = track.bitDepth === 16 ? 2 : track.bitDepth === 32 ? 4 : 3;
  const blockAlign = track.channels * bytesPerSample;
  const dataBytes = track.totalSamples * blockAlign;
  return { channels: track.channels, bytesPerSample, blockAlign, dataBytes, totalBytes: WAV_HEADER_BYTES + dataBytes };
}

export function wavHeader(sampleRate: number, layout: WavLayout, live = false): Uint8Array {
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, live ? 0xffffffff : Math.min(0xffffffff, layout.totalBytes - 8), true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, layout.channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * layout.blockAlign, true);
  view.setUint16(32, layout.blockAlign, true);
  view.setUint16(34, layout.bytesPerSample * 8, true);
  ascii(36, "data");
  view.setUint32(40, live ? 0xffffffff : Math.min(0xffffffff, layout.dataBytes), true);
  return header;
}

export function interleave(frame: DecodedFrame, samples: number, bitDepth: number, layout: WavLayout): Uint8Array {
  const out = new Uint8Array(samples * layout.blockAlign);
  const view = new DataView(out.buffer);
  const available = Math.min(samples, frame.samples);
  const shift = bitDepth === 20 ? 4 : 0;
  for (let i = 0; i < available; i++) {
    for (let ch = 0; ch < layout.channels; ch++) {
      const offset = i * layout.blockAlign + ch * layout.bytesPerSample;
      const value = (frame.channels[ch]?.[i] ?? 0) << shift;
      if (layout.bytesPerSample === 2) view.setInt16(offset, value, true);
      else if (layout.bytesPerSample === 4) view.setInt32(offset, value, true);
      else {
        out[offset] = value & 0xff;
        out[offset + 1] = (value >> 8) & 0xff;
        out[offset + 2] = (value >> 16) & 0xff;
      }
    }
  }
  return out;
}

export function frameIndexForSample(track: Pick<DecodableTrack, "frameStarts">, sample: number): number {
  let low = 0;
  let high = track.frameStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (track.frameStarts[mid] <= sample) low = mid;
    else high = mid - 1;
  }
  return low;
}

function frameSamples(track: DecodableTrack, index: number): number {
  const next = index + 1 < track.frameStarts.length ? track.frameStarts[index + 1] : track.totalSamples + track.skipSamples;
  return Math.max(0, next - track.frameStarts[index]);
}

export function wavStream(
  track: DecodableTrack,
  source: ByteSource,
  first: number,
  last: number,
  onClose: () => void,
  onFrameError: (err: Error) => void
): ReadableStream<Uint8Array> {
  const layout = wavLayout(track);
  let decoder: FrameDecoder | null = null;
  let position = first;
  let frame = -1;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    decoder?.close();
    onClose();
  };
  const decodeFrame = async (index: number): Promise<DecodedFrame> => {
    try {
      return decoder!.decode(await source.read(track.frameOffsets[index], track.frameSizes[index]));
    } catch (err) {
      onFrameError(err as Error);
      return { samples: 0, channels: [] };
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (position > last) {
          controller.close();
          close();
          return;
        }
        if (position < WAV_HEADER_BYTES) {
          const header = wavHeader(track.sampleRate, layout).subarray(position, Math.min(WAV_HEADER_BYTES, last + 1));
          position += header.length;
          controller.enqueue(header);
          return;
        }
        const dataPosition = position - WAV_HEADER_BYTES;
        if (frame < 0) {
          frame = frameIndexForSample(track, Math.floor(dataPosition / layout.blockAlign) + track.skipSamples);
          decoder = await track.createDecoder();
          for (let index = Math.max(0, frame - track.preroll); index < frame; index++) await decodeFrame(index);
        }
        if (frame >= track.frameStarts.length) {
          controller.close();
          close();
          return;
        }
        const bytes = interleave(await decodeFrame(frame), frameSamples(track, frame), track.bitDepth, layout);
        const frameStartByte = (track.frameStarts[frame] - track.skipSamples) * layout.blockAlign;
        const from = dataPosition - frameStartByte;
        const to = Math.min(bytes.length, last + 1 - WAV_HEADER_BYTES - frameStartByte);
        frame += 1;
        position += to - from;
        controller.enqueue(bytes.subarray(from, to));
      } catch (err) {
        controller.error(err);
        close();
      }
    },
    cancel() {
      close();
    },
  });
}

export class LiveAacToWav extends Transform {
  private pending = new Uint8Array(0);
  private decoder: AacDecoder | null = null;
  private starting: Promise<void> | null = null;
  private channels = 2;
  private sampleRate = 0;

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending);
    merged.set(chunk, this.pending.length);
    this.pending = merged.length > LIVE_BUFFER_LIMIT ? merged.slice(merged.length - LIVE_BUFFER_LIMIT) : merged;
    this.drain().then(() => callback(), (err: Error) => callback(err));
  }

  _flush(callback: TransformCallback): void {
    this.decoder?.close();
    this.decoder = null;
    callback();
  }

  _destroy(err: Error | null, callback: (error: Error | null) => void): void {
    this.decoder?.close();
    this.decoder = null;
    callback(err);
  }

  private async start(): Promise<void> {
    const sync = findAdtsSync(this.pending, 0);
    if (sync < 0) return;
    this.pending = this.pending.slice(sync);
    this.sampleRate = parseAdtsHeader(this.pending, 0)?.sampleRate ?? 0;
    const decoder = await AacDecoder.create();
    const info = decoder.initStream(this.pending);
    if (!info) {
      decoder.close();
      throw new Error("AAC decoder rejected the stream");
    }
    this.decoder = decoder;
    this.channels = Math.min(2, Math.max(1, info.channels));
    const layout = wavLayout({ channels: this.channels, bitDepth: 16, totalSamples: 0 });
    this.push(Buffer.from(wavHeader(info.sampleRate, layout, true)));
  }

  private async drain(): Promise<void> {
    if (!this.decoder) {
      this.starting ??= this.start().finally(() => (this.starting = null));
      await this.starting;
      if (!this.decoder) return;
    }
    const decoder = this.decoder;
    const layout = wavLayout({ channels: this.channels, bitDepth: 16, totalSamples: 0 });
    let offset = 0;
    let decoded = 0;
    let stepStart = 0;
    while (offset + 7 <= this.pending.length) {
      if (decoded - stepStart >= FRAMES_PER_STEP) {
        stepStart = decoded;
        await new Promise((resolve) => setImmediate(resolve));
        if (this.decoder !== decoder) return;
      }
      const header = parseAdtsHeader(this.pending, offset);
      if (!header) {
        const sync = findAdtsSync(this.pending, offset + 1);
        if (sync < 0) {
          offset = Math.max(offset, this.pending.length - 7);
          break;
        }
        offset = sync;
        continue;
      }
      if (offset + header.length > this.pending.length) break;
      if (header.sampleRate !== this.sampleRate) throw new Error("AAC stream changed its sample rate");
      const output = decoder.decode(this.pending.subarray(offset, offset + header.length));
      offset += header.length;
      decoded += 1;
      if (!output.pcm.length) continue;
      const frame = pcmToFrame(output.pcm, output.channels, this.channels);
      this.push(Buffer.from(interleave(frame, frame.samples, 16, layout)));
    }
    this.pending = this.pending.slice(offset);
  }
}

export function parseRange(header: string | null, total: number): { first: number; last: number } | null {
  if (!header) return { first: 0, last: total - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { first: Math.max(0, total - suffix), last: total - 1 } : null;
  }
  const first = Number(match[1]);
  const last = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  return first <= last && first < total ? { first, last } : null;
}
