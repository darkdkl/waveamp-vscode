import fs from "node:fs";
import path from "node:path";

interface FaadModule {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _wa_open(): number;
  _wa_init_config(handle: number, config: number, size: number): number;
  _wa_init_stream(handle: number, buffer: number, size: number): number;
  _wa_decode(handle: number, buffer: number, size: number): number;
  _wa_reset(handle: number, frame: number): void;
  _wa_init_rate(handle: number): number;
  _wa_init_channels(handle: number): number;
  _wa_consumed(handle: number): number;
  _wa_samples(handle: number): number;
  _wa_channels(handle: number): number;
  _wa_rate(handle: number): number;
  _wa_error(handle: number): number;
  _wa_close(handle: number): void;
}

type FaadFactory = (options: { wasmBinary: Uint8Array }) => Promise<FaadModule>;

const createFaad: FaadFactory = require("../../vendor/faad2/faad.cjs");

let modulePromise: Promise<FaadModule> | null = null;

function loadFaad(): Promise<FaadModule> {
  modulePromise ??= createFaad({ wasmBinary: fs.readFileSync(path.join(__dirname, "faad.wasm")) });
  return modulePromise;
}

export interface AacOutput {
  consumed: number;
  error: number;
  channels: number;
  sampleRate: number;
  pcm: Int16Array;
}

export class AacDecoder {
  private input = 0;
  private inputSize = 0;

  private constructor(
    private readonly faad: FaadModule,
    private handle: number
  ) {}

  static async create(): Promise<AacDecoder> {
    const faad = await loadFaad();
    return new AacDecoder(faad, faad._wa_open());
  }

  private copyIn(bytes: Uint8Array): number {
    if (bytes.length > this.inputSize) {
      if (this.input) this.faad._free(this.input);
      this.inputSize = Math.max(bytes.length, 8192);
      this.input = this.faad._malloc(this.inputSize);
    }
    this.faad.HEAPU8.set(bytes, this.input);
    return this.input;
  }

  initConfig(config: Uint8Array): { sampleRate: number; channels: number } | null {
    if (this.faad._wa_init_config(this.handle, this.copyIn(config), config.length) < 0) return null;
    return { sampleRate: this.faad._wa_init_rate(this.handle), channels: this.faad._wa_init_channels(this.handle) };
  }

  initStream(bytes: Uint8Array): { consumed: number; sampleRate: number; channels: number } | null {
    const consumed = this.faad._wa_init_stream(this.handle, this.copyIn(bytes), bytes.length);
    if (consumed < 0) return null;
    return { consumed, sampleRate: this.faad._wa_init_rate(this.handle), channels: this.faad._wa_init_channels(this.handle) };
  }

  decode(bytes: Uint8Array): AacOutput {
    const pointer = this.faad._wa_decode(this.handle, this.copyIn(bytes), bytes.length);
    const samples = this.faad._wa_samples(this.handle);
    const pcm = pointer && samples ? this.faad.HEAP16.slice(pointer >> 1, (pointer >> 1) + samples) : new Int16Array(0);
    return {
      consumed: this.faad._wa_consumed(this.handle),
      error: this.faad._wa_error(this.handle),
      channels: this.faad._wa_channels(this.handle),
      sampleRate: this.faad._wa_rate(this.handle),
      pcm,
    };
  }

  close(): void {
    if (!this.handle) return;
    if (this.input) this.faad._free(this.input);
    this.input = 0;
    this.faad._wa_close(this.handle);
    this.handle = 0;
  }
}
