import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMediaServer, type MediaServer } from "../src/server";

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function fetch(url: string, headers: http.OutgoingHttpHeaders = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waveamp-server-"));
const audioFile = path.join(dir, "track.mp3");
const titles: (string | null)[] = [];
let media: MediaServer;
let upstream: http.Server;
let upstreamBase = "";

beforeAll(async () => {
  fs.writeFileSync(audioFile, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  upstream = http.createServer((req, res) => {
    if (req.url === "/logo.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(100, 7));
    if (req.url === "/huge.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(3 * 1024 * 1024));
    if (req.url === "/page.html") return res.writeHead(200, { "Content-Type": "text/html" }).end("<html>");
    if (req.url === "/live") {
      const meta = Buffer.alloc(33);
      meta[0] = 2;
      meta.write("StreamTitle='A - B';", 1);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "icy-metaint": "8" });
      return res.end(Buffer.concat([Buffer.alloc(8, 1), meta, Buffer.alloc(8, 2)]));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamBase = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
  media = await startMediaServer((_, title) => titles.push(title));
});

afterAll(() => {
  media.close();
  upstream.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("media server", () => {
  it("answers only with the session key", async () => {
    const url = new URL(media.fileUrl(audioFile));
    url.pathname = url.pathname.replace(/^\/[^/]+/, "/wrong-key");
    expect((await fetch(url.href)).status).toBe(404);
    expect((await fetch(media.fileUrl(audioFile))).status).toBe(200);
  });

  it("serves only files that were added to the playlist", async () => {
    const other = path.join(dir, "other.mp3");
    fs.writeFileSync(other, "secret");
    const url = new URL(media.fileUrl(audioFile));
    url.searchParams.set("p", other);
    expect((await fetch(url.href)).status).toBe(404);
    url.pathname = url.pathname.replace(/\/file$/, "/cover");
    expect((await fetch(url.href)).status).toBe(404);
    expect((await fetch(media.fileUrl(other))).body.toString()).toBe("secret");
  });

  it("serves byte ranges of local files", async () => {
    const whole = await fetch(media.fileUrl(audioFile));
    expect(whole.headers["content-type"]).toBe("audio/mpeg");
    expect(whole.body.length).toBe(1000);
    const part = await fetch(media.fileUrl(audioFile), { Range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 10-19/1000");
    expect([...part.body]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect((await fetch(media.fileUrl(audioFile), { Range: "bytes=5000-" })).status).toBe(416);
    expect((await fetch(media.fileUrl(path.join(dir, "missing.mp3")))).status).toBe(404);
  });

  it("passes station logos through and refuses other content and huge images", async () => {
    const image = (target: string) => fetch(media.routes().image + encodeURIComponent(target));
    const logo = await image(`${upstreamBase}/logo.png`);
    expect(logo.status).toBe(200);
    expect(logo.body.length).toBe(100);
    expect((await image(`${upstreamBase}/page.html`)).status).toBe(404);
    expect((await image(`${upstreamBase}/huge.png`)).status).toBe(413);
    expect((await image("file:///etc/hostname")).status).toBe(400);
  });

  it("strips ICY metadata from station streams and reports the title", async () => {
    const stream = await fetch(media.streamUrl(`${upstreamBase}/live`));
    expect(stream.headers["content-type"]).toBe("audio/mpeg");
    expect(stream.body).toEqual(Buffer.concat([Buffer.alloc(8, 1), Buffer.alloc(8, 2)]));
    expect(titles).toContain("A - B");
  });
});
