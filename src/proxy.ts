import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { PassThrough, type Duplex } from "node:stream";
import { writeLog } from "./log";

export type ProxyMode = "vscode" | "direct" | "custom";
export type ProxyType = "http" | "socks5";

export interface ProxySettings {
  mode: ProxyMode;
  type: ProxyType;
  host: string;
  port: number;
}

const CONNECT_TIMEOUT_MS = 10_000;

let settings: ProxySettings = { mode: "vscode", type: "http", host: "", port: 0 };

export function setProxySettings(next: ProxySettings): void {
  settings = next;
  closeIdleConnections();
  writeLog("info", "proxy", next.mode === "custom" ? `Using ${next.type} proxy ${next.host}:${next.port}` : `Proxy mode: ${next.mode}`);
}

export const isDirectMode = () => settings.mode === "direct";

const customProxy = () => settings.mode === "custom" && !!settings.host && settings.port > 0;

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host)) return true;
  return !host.includes(".") && !host.includes(":");
}

function openSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error(`Proxy ${host}:${port} did not answer`)));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

class HandshakeReader {
  private buffer = Buffer.alloc(0);
  private waiter: { count: number; resolve: () => void; reject: (err: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("error", this.onError);
  }

  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.settle();
  };

  private readonly onEnd = () => this.fail(new Error("Proxy closed the connection"));

  private readonly onError = (err: Error) => this.fail(err);

  private fail(err: Error): void {
    this.failure = err;
    this.settle();
  }

  private settle(): void {
    const waiter = this.waiter;
    if (!waiter) return;
    if (this.buffer.length >= waiter.count) {
      this.waiter = null;
      waiter.resolve();
    } else if (this.failure) {
      this.waiter = null;
      waiter.reject(this.failure);
    }
  }

  private waitFor(count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiter = { count, resolve, reject };
      this.settle();
    });
  }

  async read(count: number): Promise<Buffer> {
    await this.waitFor(count);
    const bytes = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return bytes;
  }

  async readHead(limit: number): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end >= 0) return (await this.read(end + 4)).toString("latin1");
      if (this.buffer.length > limit) throw new Error("Proxy sent an oversized reply");
      await this.waitFor(this.buffer.length + 1);
    }
  }

  release(): void {
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("error", this.onError);
    if (this.buffer.length) this.socket.unshift(this.buffer);
  }
}

async function socks5Tunnel(host: string, port: number): Promise<net.Socket> {
  const socket = await openSocket(settings.host, settings.port);
  const reader = new HandshakeReader(socket);
  try {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) throw new Error("SOCKS5 proxy wants a login, which WaveAMP does not support");
    const name = Buffer.from(host, "utf8");
    socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, Buffer.from([port >> 8, port & 0xff])]));
    const reply = await reader.read(4);
    if (reply[1] !== 0x00) throw new Error(`SOCKS5 proxy refused the connection (code ${reply[1]})`);
    const addressLength = reply[3] === 0x01 ? 4 : reply[3] === 0x04 ? 16 : (await reader.read(1))[0];
    await reader.read(addressLength + 2);
    reader.release();
    socket.setTimeout(0).removeAllListeners("timeout");
    return socket;
  } catch (err) {
    reader.release();
    socket.destroy();
    throw err;
  }
}

async function httpTunnel(host: string, port: number): Promise<net.Socket> {
  const socket = await openSocket(settings.host, settings.port);
  const reader = new HandshakeReader(socket);
  try {
    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    const head = await reader.readHead(16 * 1024);
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1];
    if (status !== "200") throw new Error(`HTTP proxy refused the connection (HTTP ${status ?? "?"})`);
    reader.release();
    socket.setTimeout(0).removeAllListeners("timeout");
    return socket;
  } catch (err) {
    reader.release();
    socket.destroy();
    throw err;
  }
}

const tunnel = (host: string, port: number) => (settings.type === "socks5" ? socks5Tunnel(host, port) : httpTunnel(host, port));

export class ProxyDropError extends Error {}

type ConnectionCallback = (err: Error | null, stream: Duplex) => void;

function failed(callback: ConnectionCallback | undefined, err: Error): void {
  writeLog("warn", "proxy", err.message);
  callback?.(err, new PassThrough());
}

class TunnelHttpAgent extends http.Agent {
  createConnection(options: http.ClientRequestArgs, callback?: ConnectionCallback): undefined {
    tunnel(String(options.host), Number(options.port) || 80).then(
      (socket) => callback?.(null, socket),
      (err: Error) => failed(callback, err)
    );
    return undefined;
  }
}

class TunnelHttpsAgent extends https.Agent {
  createConnection(options: http.ClientRequestArgs & { servername?: string }, callback?: ConnectionCallback): undefined {
    const host = String(options.host);
    const port = Number(options.port) || 443;
    tunnel(host, port).then(
      (socket) => {
        const secure = tls.connect({ socket, servername: options.servername || host, ALPNProtocols: ["http/1.1"] });
        const onError = (err: NodeJS.ErrnoException) =>
          failed(callback, err.code === "ECONNRESET" ? new ProxyDropError(`Proxy closed the connection to ${host}:${port} before TLS`) : err);
        secure.setTimeout(CONNECT_TIMEOUT_MS, () => secure.destroy(new Error(`TLS handshake with ${host} timed out`)));
        secure.once("error", onError);
        secure.once("secureConnect", () => {
          secure.setTimeout(0).removeAllListeners("timeout");
          secure.off("error", onError);
          callback?.(null, secure);
        });
      },
      (err: Error) => failed(callback, err)
    );
    return undefined;
  }
}

const directHttp = new http.Agent({ keepAlive: true });
const directHttps = new https.Agent({ keepAlive: true });
const tunnelHttp = new TunnelHttpAgent({ keepAlive: true });
const tunnelHttps = new TunnelHttpsAgent({ keepAlive: true });

function closeIdleConnections(): void {
  for (const agent of [directHttp, directHttps, tunnelHttp, tunnelHttps]) {
    for (const sockets of Object.values(agent.freeSockets)) sockets?.forEach((socket) => socket.destroy());
  }
}

export interface GetOptions {
  headers?: http.OutgoingHttpHeaders;
  timeout?: number;
}

function send(options: http.ClientRequestArgs, callback: (response: http.IncomingMessage) => void): http.ClientRequest {
  const request = new http.ClientRequest(options, callback);
  request.end();
  return request;
}

export function httpGet(url: URL, options: GetOptions, callback: (response: http.IncomingMessage) => void): http.ClientRequest {
  const secure = url.protocol === "https:";
  if (settings.mode === "vscode") return (secure ? https : http).get(url, options, callback);
  const target: http.ClientRequestArgs = {
    ...options,
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: url.port || (secure ? 443 : 80),
    path: url.pathname + url.search,
  };
  if (!customProxy() || isLocalHost(url.hostname)) return send({ ...target, agent: secure ? directHttps : directHttp }, callback);
  if (!secure && settings.type === "http") {
    return send(
      {
        ...options,
        protocol: "http:",
        hostname: settings.host,
        port: settings.port,
        path: url.href,
        headers: { ...options.headers, Host: url.host },
        agent: directHttp,
      },
      callback
    );
  }
  return send({ ...target, agent: secure ? tunnelHttps : tunnelHttp }, callback);
}
