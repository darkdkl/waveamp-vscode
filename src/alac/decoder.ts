// Modified TypeScript rewrite of Apple's ALAC reference decoder (Apache-2.0) and the FFmpeg ALAC decoder (LGPL-2.1+); see THIRD_PARTY_LICENSES.txt.

export interface AlacConfig {
  frameLength: number;
  bitDepth: number;
  pb: number;
  mb: number;
  kb: number;
  numChannels: number;
  maxRun: number;
  sampleRate: number;
}

export function parseAlacConfig(bytes: Uint8Array): AlacConfig {
  if (bytes.length < 24) throw new Error("ALAC config is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    frameLength: view.getUint32(0),
    bitDepth: view.getUint8(5),
    pb: view.getUint8(6),
    mb: view.getUint8(7),
    kb: view.getUint8(8),
    numChannels: view.getUint8(9),
    maxRun: view.getUint16(10),
    sampleRate: view.getUint32(20),
  };
}

class BitReader {
  private pos = 0;
  private readonly limit: number;

  constructor(private readonly bytes: Uint8Array) {
    this.limit = bytes.length * 8;
  }

  get left(): number {
    return this.limit - this.pos;
  }

  private fetch(count: number): number {
    let value = 0;
    let pos = this.pos;
    let remaining = count;
    while (remaining > 0) {
      const offset = pos & 7;
      const take = Math.min(8 - offset, remaining);
      const byte = (pos >> 3) < this.bytes.length ? this.bytes[pos >> 3] : 0;
      value = value * (1 << take) + ((byte >> (8 - offset - take)) & ((1 << take) - 1));
      pos += take;
      remaining -= take;
    }
    return value;
  }

  read(count: number): number {
    if (this.pos + count > this.limit) throw new Error("ALAC frame ended early");
    const value = this.fetch(count);
    this.pos += count;
    return value;
  }

  readSigned(count: number): number {
    const value = this.read(count);
    return count < 32 && value >= 2 ** (count - 1) ? value - 2 ** count : value | 0;
  }

  peek(count: number): number {
    return this.fetch(count);
  }

  skip(count: number): void {
    if (this.pos + count > this.limit) throw new Error("ALAC frame ended early");
    this.pos += count;
  }

  unary9(): number {
    let ones = 0;
    while (ones < 9 && this.read(1) === 1) ones++;
    return ones;
  }

  alignToByte(): void {
    this.pos = Math.min(this.limit, (this.pos + 7) & ~7);
  }
}

const ELEMENT_SCE = 0;
const ELEMENT_CPE = 1;
const ELEMENT_LFE = 3;
const ELEMENT_DSE = 4;
const ELEMENT_FIL = 6;
const ELEMENT_END = 7;

function log2(value: number): number {
  return value > 0 ? 31 - Math.clz32(value) : 0;
}

function signExtend(value: number, bits: number): number {
  const shift = 32 - bits;
  return shift > 0 ? (value << shift) >> shift : value | 0;
}

function decodeScalar(bits: BitReader, k: number, escapeBits: number): number {
  let x = bits.unary9();
  if (x > 8) return bits.read(escapeBits);
  if (k === 1) return x;
  const extra = bits.peek(k);
  x = x * ((1 << k) - 1);
  if (extra > 1) {
    bits.skip(k);
    return x + extra - 1;
  }
  bits.skip(k - 1);
  return x;
}

function riceDecompress(
  bits: BitReader,
  out: Int32Array,
  count: number,
  sampleBits: number,
  historyMult: number,
  config: AlacConfig
): void {
  let history = config.mb;
  let signModifier = 0;
  for (let i = 0; i < count; i++) {
    const k = Math.min(log2((history >>> 9) + 3), config.kb);
    const x = decodeScalar(bits, k, sampleBits) + signModifier;
    signModifier = 0;
    out[i] = x % 2 === 1 ? -((x + 1) / 2) : x / 2;
    if (x > 0xffff) history = 0xffff;
    else history = history + x * historyMult - ((history * historyMult) >>> 9);
    if (history < 128 && i + 1 < count) {
      const zk = Math.min(7 - log2(history) + ((history + 16) >> 6), config.kb);
      const run = decodeScalar(bits, zk, 16);
      if (run > 0) {
        if (run >= count - i) throw new Error("ALAC zero run is too long");
        out.fill(0, i + 1, i + 1 + run);
        i += run;
      }
      if (run <= 0xffff) signModifier = 1;
      history = 0;
    }
  }
}

function lpcPredict(
  errors: Int32Array,
  out: Int32Array,
  count: number,
  sampleBits: number,
  coefs: Int32Array,
  order: number,
  quant: number
): void {
  out[0] = errors[0];
  if (count <= 1) return;
  if (order === 0) {
    out.set(errors.subarray(1, count), 1);
    return;
  }
  if (order === 31) {
    for (let i = 1; i < count; i++) out[i] = signExtend(out[i - 1] + errors[i], sampleBits);
    return;
  }
  let i = 1;
  for (; i <= order && i < count; i++) out[i] = signExtend(out[i - 1] + errors[i], sampleBits);
  const round = quant > 0 ? 1 << (quant - 1) : 0;
  for (; i < count; i++) {
    const base = i - order;
    const d = out[base - 1];
    let sum = 0;
    for (let j = 0; j < order; j++) sum = (sum + Math.imul(out[base + j] - d, coefs[j])) | 0;
    let errorValue = errors[i];
    out[i] = signExtend((((sum + round) | 0) >> quant) + d + errorValue, sampleBits);
    const errorSign = Math.sign(errorValue);
    if (errorSign === 0) continue;
    for (let j = 0; j < order && errorValue * errorSign > 0; j++) {
      const diff = (d - out[base + j]) | 0;
      const sign = Math.sign(diff) * errorSign;
      coefs[j] -= sign;
      errorValue -= (Math.imul(diff, sign) >> quant) * (j + 1);
    }
  }
}

export interface DecodedFrame {
  samples: number;
  channels: Int32Array[];
}

export class AlacDecoder {
  private readonly errors: Int32Array[];
  private readonly extra: Int32Array[];

  constructor(readonly config: AlacConfig) {
    if (config.numChannels < 1 || config.numChannels > 8) throw new Error("Unsupported ALAC channel count");
    if (![16, 20, 24, 32].includes(config.bitDepth)) throw new Error("Unsupported ALAC bit depth");
    this.errors = [new Int32Array(config.frameLength), new Int32Array(config.frameLength)];
    this.extra = [new Int32Array(config.frameLength), new Int32Array(config.frameLength)];
  }

  decode(frame: Uint8Array): DecodedFrame {
    const { config } = this;
    const bits = new BitReader(frame);
    const channels: Int32Array[] = [];
    let samples = config.frameLength;
    while (bits.left >= 3 && channels.length < config.numChannels) {
      const element = bits.read(3);
      if (element === ELEMENT_END) break;
      if (element === ELEMENT_DSE) {
        bits.skip(4);
        const aligned = bits.read(1);
        let count = bits.read(8);
        if (count === 255) count += bits.read(8);
        if (aligned) bits.alignToByte();
        bits.skip(count * 8);
        continue;
      }
      if (element === ELEMENT_FIL) {
        let count = bits.read(4);
        if (count === 15) count += bits.read(8) - 1;
        bits.skip(count * 8);
        continue;
      }
      if (element !== ELEMENT_SCE && element !== ELEMENT_LFE && element !== ELEMENT_CPE) {
        throw new Error("Unsupported ALAC element");
      }
      const pair = element === ELEMENT_CPE ? 2 : 1;
      const decoded = this.decodeElement(bits, pair);
      samples = decoded.samples;
      channels.push(...decoded.channels);
    }
    if (channels.length !== config.numChannels) throw new Error("ALAC frame is missing channels");
    return { samples, channels };
  }

  private decodeElement(bits: BitReader, pair: number): DecodedFrame {
    const { config } = this;
    bits.skip(4);
    if (bits.read(12) !== 0) throw new Error("Bad ALAC element header");
    const hasSize = bits.read(1);
    const extraBits = bits.read(2) * 8;
    if (extraBits === 24) throw new Error("Bad ALAC shift");
    const compressed = bits.read(1) === 0;
    const samples = hasSize ? bits.read(32) : config.frameLength;
    if (samples < 1 || samples > config.frameLength) throw new Error("Bad ALAC sample count");
    const output = Array.from({ length: pair }, () => new Int32Array(samples));

    if (!compressed) {
      for (let i = 0; i < samples; i++) {
        for (let ch = 0; ch < pair; ch++) output[ch][i] = bits.readSigned(config.bitDepth);
      }
      return { samples, channels: output };
    }

    const sampleBits = config.bitDepth - extraBits + pair - 1;
    const mixShift = bits.read(8);
    const mixWeight = bits.readSigned(8);
    const modes: number[] = [];
    const quants: number[] = [];
    const historyMults: number[] = [];
    const coefs: Int32Array[] = [];
    for (let ch = 0; ch < pair; ch++) {
      modes.push(bits.read(4));
      quants.push(bits.read(4));
      historyMults.push((config.pb * bits.read(3)) >> 2);
      const order = bits.read(5);
      const table = new Int32Array(order);
      for (let i = order - 1; i >= 0; i--) table[i] = bits.readSigned(16);
      coefs.push(table);
    }
    if (extraBits) {
      for (let i = 0; i < samples; i++) {
        for (let ch = 0; ch < pair; ch++) this.extra[ch][i] = bits.read(extraBits);
      }
    }
    for (let ch = 0; ch < pair; ch++) {
      const errors = this.errors[ch];
      riceDecompress(bits, errors, samples, sampleBits, historyMults[ch], config);
      if (modes[ch] === 15) lpcPredict(errors, errors, samples, sampleBits, new Int32Array(0), 31, 0);
      else if (modes[ch] !== 0) throw new Error("Unknown ALAC prediction mode");
      lpcPredict(errors, output[ch], samples, sampleBits, coefs[ch], coefs[ch].length, quants[ch]);
    }
    if (pair === 2 && mixWeight !== 0) {
      const [left, right] = output;
      for (let i = 0; i < samples; i++) {
        const a = (left[i] - (Math.imul(right[i], mixWeight) >> mixShift)) | 0;
        left[i] = (right[i] + a) | 0;
        right[i] = a;
      }
    }
    if (extraBits) {
      for (let ch = 0; ch < pair; ch++) {
        const channel = output[ch];
        const extra = this.extra[ch];
        for (let i = 0; i < samples; i++) channel[i] = (channel[i] << extraBits) | extra[i];
      }
    }
    return { samples, channels: output };
  }
}
