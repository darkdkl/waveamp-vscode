import { describe, expect, it } from "vitest";
import { IcyStripper, parseMetaInt, parseStreamTitle } from "../../src/radio/icy";

function metadataBlock(text: string, encoding: BufferEncoding = "utf8"): Buffer {
  const body = Buffer.from(text, encoding);
  const padded = Buffer.alloc(Math.ceil(body.length / 16) * 16);
  body.copy(padded);
  return Buffer.concat([Buffer.from([padded.length / 16]), padded]);
}

async function strip(stream: Buffer, metaint: number, chunkSize: number) {
  const titles: (string | null)[] = [];
  const stripper = new IcyStripper(metaint, (title) => titles.push(title));
  const audio: Buffer[] = [];
  stripper.on("data", (chunk: Buffer) => audio.push(chunk));
  const done = new Promise((resolve) => stripper.on("end", resolve));
  for (let i = 0; i < stream.length; i += chunkSize) stripper.write(stream.subarray(i, i + chunkSize));
  stripper.end();
  await done;
  return { audio: Buffer.concat(audio), titles };
}

describe("parseMetaInt", () => {
  it("accepts a positive interval", () => {
    expect(parseMetaInt("16000")).toBe(16000);
    expect(parseMetaInt(["8192"])).toBe(8192);
  });

  it("rejects missing, zero and oversized values", () => {
    expect(parseMetaInt(undefined)).toBeNull();
    expect(parseMetaInt("0")).toBeNull();
    expect(parseMetaInt("abc")).toBeNull();
    expect(parseMetaInt(String(10 * 1024 * 1024))).toBeNull();
  });
});

describe("parseStreamTitle", () => {
  it("reads the title, apostrophes included", () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='Night Route - Don't Stop';StreamUrl='';\0\0"))).toBe(
      "Night Route - Don't Stop"
    );
  });

  it("decodes UTF-8 and cp1251 titles", () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='Тихая гавань - Маяк';", "utf8"))).toBe("Тихая гавань - Маяк");
    const cp1251 = Buffer.from([...Buffer.from("StreamTitle='"), 0xcc, 0xe0, 0xff, 0xea, ...Buffer.from("';")]);
    expect(parseStreamTitle(cp1251)).toBe("Маяк");
  });

  it("returns null for empty or placeholder titles", () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='';"))).toBeNull();
    expect(parseStreamTitle(Buffer.from("StreamTitle=' - ';"))).toBeNull();
    expect(parseStreamTitle(Buffer.from("StreamUrl='http://x';"))).toBeNull();
  });
});

describe("IcyStripper", () => {
  const audioA = Buffer.alloc(10, 1);
  const audioB = Buffer.alloc(10, 2);
  const audioC = Buffer.alloc(4, 3);
  const stream = Buffer.concat([audioA, metadataBlock("StreamTitle='A - B';"), audioB, Buffer.from([0]), audioC]);

  it("removes metadata and reports titles, whatever the chunk size", async () => {
    for (const chunkSize of [1, 3, 7, stream.length]) {
      const { audio, titles } = await strip(stream, 10, chunkSize);
      expect(audio, `chunk ${chunkSize}`).toEqual(Buffer.concat([audioA, audioB, audioC]));
      expect(titles, `chunk ${chunkSize}`).toEqual(["A - B"]);
    }
  });

  it("reports an empty title as null", async () => {
    const { titles } = await strip(Buffer.concat([audioA, metadataBlock("StreamTitle='';")]), 10, 5);
    expect(titles).toEqual([null]);
  });
});
