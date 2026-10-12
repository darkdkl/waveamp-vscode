const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export const ADTS_SAMPLES_PER_BLOCK = 1024;

export interface AdtsHeader {
  length: number;
  sampleRate: number;
  channels: number;
  blocks: number;
}

export function parseAdtsHeader(bytes: Uint8Array, offset: number): AdtsHeader | null {
  if (offset + 7 > bytes.length) return null;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) return null;
  const rateIndex = (bytes[offset + 2] >> 2) & 0x0f;
  const sampleRate = SAMPLE_RATES[rateIndex];
  const channels = ((bytes[offset + 2] & 0x01) << 2) | (bytes[offset + 3] >> 6);
  const length = ((bytes[offset + 3] & 0x03) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
  const blocks = (bytes[offset + 6] & 0x03) + 1;
  const headerSize = bytes[offset + 1] & 0x01 ? 7 : 9;
  if (!sampleRate || length < headerSize) return null;
  return { length, sampleRate, channels, blocks };
}

export function id3Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

export function findAdtsSync(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 7 <= bytes.length; i++) {
    const header = parseAdtsHeader(bytes, i);
    if (!header) continue;
    const next = i + header.length;
    if (next + 2 > bytes.length || parseAdtsHeader(bytes, next)) return i;
  }
  return -1;
}
