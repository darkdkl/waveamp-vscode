import { Transform, type TransformCallback } from "node:stream";
import { fixMojibake } from "../textEncoding";

export const ICY_MAX_METAINT = 256 * 1024;

export function parseMetaInt(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const metaint = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(metaint) && metaint > 0 && metaint <= ICY_MAX_METAINT ? metaint : null;
}

export function parseStreamTitle(block: Buffer): string | null {
  const text = block.toString("latin1").replace(/\0+$/, "");
  const match = /StreamTitle='(.*?)'(?:;|\s*$)/s.exec(text);
  const title = (fixMojibake(match?.[1]) ?? "").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(title) ? title : null;
}

export class IcyStripper extends Transform {
  private audioLeft: number;
  private metaLeft = -1;
  private meta: Buffer[] = [];

  constructor(
    private readonly metaint: number,
    private readonly onTitle: (title: string | null) => void
  ) {
    super();
    this.audioLeft = metaint;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.audioLeft > 0) {
        const take = Math.min(this.audioLeft, chunk.length - offset);
        this.push(chunk.subarray(offset, offset + take));
        this.audioLeft -= take;
        offset += take;
      } else if (this.metaLeft < 0) {
        this.metaLeft = chunk[offset] * 16;
        offset += 1;
        if (this.metaLeft === 0) this.nextBlock();
      } else {
        const take = Math.min(this.metaLeft, chunk.length - offset);
        this.meta.push(chunk.subarray(offset, offset + take));
        this.metaLeft -= take;
        offset += take;
        if (this.metaLeft === 0) {
          const title = parseStreamTitle(Buffer.concat(this.meta));
          this.nextBlock();
          this.onTitle(title);
        }
      }
    }
    callback();
  }

  private nextBlock(): void {
    this.audioLeft = this.metaint;
    this.metaLeft = -1;
    this.meta = [];
  }
}
