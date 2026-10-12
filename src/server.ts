import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { LiveAacToWav, parseRange, wavLayout, wavStream } from "./decode/wav";
import { openDecodedFile } from "./decode/tracks";
import { IcyStripper, parseMetaInt } from "./radio/icy";
import { USER_AGENT } from "./net";
import { httpGet } from "./proxy";
import { loadMusicMetadata } from "./tags";
import { findFolderCover, pickTagPicture } from "./coverFiles";

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

export type StreamTitleListener = (streamUrl: string, title: string | null) => void;

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".weba": "audio/webm",
};
const MAX_REDIRECTS = 5;
const STREAM_ANSWER_TIMEOUT_MS = 15_000;
const AAC_STREAM_TYPES = /^audio\/(aac|aacp|x-aac|x-aacp)\b/i;

export interface MediaServer {
  origin: string;
  routes(): { cover: string; image: string };
  usePublicOrigin(origin: string): void;
  fileUrl(filePath: string): string;
  decodedUrl(filePath: string): string;
  streamUrl(url: string): string;
  close(): void;
}

function send(res: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "Access-Control-Allow-Origin": "*", ...headers });
  res.end();
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): void {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404);
    const range = parseRange(req.headers.range ?? null, stat.size);
    if (!range) return send(res, 416, { "Content-Range": `bytes */${stat.size}` });
    res.writeHead(req.headers.range ? 206 : 200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Length": range.last - range.first + 1,
      ...(req.headers.range ? { "Content-Range": `bytes ${range.first}-${range.last}/${stat.size}` } : {}),
    });
    const stream = fs.createReadStream(filePath, { start: range.first, end: range.last });
    stream.pipe(res);
    res.on("close", () => stream.destroy());
  });
}

async function serveDecoded(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): Promise<void> {
  const opened = await openDecodedFile(filePath).catch(() => null);
  if (!opened) return send(res, 415);
  const { track, source, close } = opened;
  const total = wavLayout(track).totalBytes;
  const range = parseRange(req.headers.range ?? null, total);
  if (!range) {
    close();
    return send(res, 416, { "Content-Range": `bytes */${total}` });
  }
  res.writeHead(req.headers.range ? 206 : 200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Content-Length": range.last - range.first + 1,
    ...(req.headers.range ? { "Content-Range": `bytes ${range.first}-${range.last}/${total}` } : {}),
  });
  const body = Readable.fromWeb(wavStream(track, source, range.first, range.last, close, () => {}) as WebReadableStream);
  body.pipe(res);
  res.on("close", () => body.destroy());
}

async function serveCover(res: http.ServerResponse, filePath: string): Promise<void> {
  try {
    const { parseFile } = await loadMusicMetadata();
    const { common } = await parseFile(filePath, { duration: false });
    const picture = pickTagPicture(common.picture);
    if (picture) {
      res.writeHead(200, { "Content-Type": picture.format || "image/jpeg", "Cache-Control": "max-age=3600" });
      res.end(Buffer.from(picture.data));
      return;
    }
  } catch {}
  const dir = path.dirname(filePath);
  const name = findFolderCover(await fs.promises.readdir(dir).catch(() => []));
  if (!name) return send(res, 404);
  const full = path.join(dir, name);
  res.writeHead(200, { "Content-Type": IMAGE_MIME[path.extname(name).toLowerCase()] ?? "image/jpeg", "Cache-Control": "max-age=3600" });
  fs.createReadStream(full).on("error", () => res.destroy()).pipe(res);
}

function proxyImage(res: http.ServerResponse, target: string, redirects = 0): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return send(res, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return send(res, 400);
  const request = httpGet(url, { headers: { "User-Agent": USER_AGENT }, timeout: 10_000 }, (up) => {
    const status = up.statusCode ?? 502;
    if (status >= 300 && status < 400 && up.headers.location && redirects < MAX_REDIRECTS) {
      up.resume();
      return proxyImage(res, new URL(up.headers.location, url).href, redirects + 1);
    }
    const type = String(up.headers["content-type"] ?? "");
    if (status !== 200 || !type.startsWith("image/")) {
      up.resume();
      return send(res, 404);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    up.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= IMAGE_MAX_BYTES) return void chunks.push(chunk);
      request.destroy();
      if (!res.headersSent) send(res, 413);
    });
    up.on("end", () => {
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "max-age=3600" });
      res.end(Buffer.concat(chunks));
    });
  });
  request.on("timeout", () => request.destroy());
  request.on("error", () => (res.headersSent ? res.destroy() : send(res, 502)));
}

function proxyStream(res: http.ServerResponse, target: string, onTitle: StreamTitleListener, origin = target, redirects = 0): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return send(res, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return send(res, 400);
  const upstream = httpGet(url, { headers: { "User-Agent": USER_AGENT, "Icy-MetaData": "1" } }, (up) => {
    clearTimeout(answerTimer);
    const status = up.statusCode ?? 502;
    if (status >= 300 && status < 400 && up.headers.location && redirects < MAX_REDIRECTS) {
      up.resume();
      return proxyStream(res, new URL(up.headers.location, url).href, onTitle, origin, redirects + 1);
    }
    const aac = AAC_STREAM_TYPES.test(String(up.headers["content-type"] ?? ""));
    res.writeHead(status, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": aac ? "audio/wav" : up.headers["content-type"] ?? "audio/mpeg",
      "Cache-Control": "no-store",
    });
    const metaint = parseMetaInt(up.headers["icy-metaint"]);
    let audio: Readable = up;
    if (metaint) {
      const stripper = new IcyStripper(metaint, (title) => onTitle(origin, title));
      audio = up.pipe(stripper);
      res.on("close", () => stripper.destroy());
    } else {
      onTitle(origin, null);
    }
    if (AAC_STREAM_TYPES.test(String(up.headers["content-type"] ?? ""))) {
      const decoder = new LiveAacToWav();
      decoder.on("error", () => res.destroy());
      audio = audio.pipe(decoder);
      res.on("close", () => decoder.destroy());
    }
    audio.pipe(res);
  });
  const answerTimer = setTimeout(() => upstream.destroy(new Error("Station did not answer")), STREAM_ANSWER_TIMEOUT_MS);
  upstream.on("error", () => (res.headersSent ? res.destroy() : send(res, 502)));
  upstream.on("close", () => clearTimeout(answerTimer));
  res.on("close", () => upstream.destroy());
}

export function startMediaServer(onTitle: StreamTitleListener = () => {}): Promise<MediaServer> {
  const token = crypto.randomBytes(16).toString("hex");
  const allowedFiles = new Set<string>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const [, key, kind] = url.pathname.split("/");
    if (key !== token || (req.method !== "GET" && req.method !== "HEAD")) return send(res, 404);
    const target = url.searchParams.get("p") ?? "";
    if (kind === "stream") return proxyStream(res, target, onTitle);
    if (kind === "image") return proxyImage(res, target);
    if (!allowedFiles.has(target)) return send(res, 404);
    if (kind === "file") return serveFile(req, res, target);
    if (kind === "decoded") return void serveDecoded(req, res, target);
    if (kind === "cover") return void serveCover(res, target);
    send(res, 404);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      let origin = `http://127.0.0.1:${port}`;
      const make = (kind: string) => (value: string) => `${origin}/${token}/${kind}?p=${encodeURIComponent(value)}`;
      resolve({
        get origin() {
          return origin;
        },
        usePublicOrigin: (publicOrigin: string) => {
          origin = publicOrigin.replace(/\/+$/, "");
        },
        routes: () => ({ cover: make("cover")(""), image: make("image")("") }),
        fileUrl: (filePath: string) => {
          allowedFiles.add(filePath);
          return make("file")(filePath);
        },
        decodedUrl: (filePath: string) => {
          allowedFiles.add(filePath);
          return make("decoded")(filePath);
        },
        streamUrl: make("stream"),
        close: () => server.close(),
      });
    });
  });
}
