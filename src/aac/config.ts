const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const AOT_SBR = 5;
const AOT_PS = 29;
const AOT_LC = 2;

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++, this.pos++) {
      const byte = this.bytes[this.pos >> 3] ?? 0;
      value = value * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
    }
    return value;
  }
}

class BitWriter {
  private readonly bits: number[] = [];
  put(value: number, count: number): this {
    for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) & 1);
    return this;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => (out[i >> 3] |= bit << (7 - (i & 7))));
    return out;
  }
}

function readObjectType(bits: BitReader): number {
  const type = bits.read(5);
  return type === 31 ? 32 + bits.read(6) : type;
}

function readRate(bits: BitReader): { index: number; rate: number } {
  const index = bits.read(4);
  return index === 15 ? { index, rate: bits.read(24) } : { index, rate: SAMPLE_RATES[index] ?? 0 };
}

export function baseLayerConfig(config: Uint8Array): Uint8Array {
  const bits = new BitReader(config);
  const objectType = readObjectType(bits);
  if (objectType !== AOT_SBR && objectType !== AOT_PS) return config;
  const core = readRate(bits);
  const channels = bits.read(4);
  const writer = new BitWriter().put(AOT_LC, 5).put(core.index, 4);
  if (core.index === 15) writer.put(core.rate, 24);
  return writer.put(channels, 4).put(0, 3).bytes();
}
