import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestJson, requestText } from "../src/net";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/redirect") return res.writeHead(302, { Location: "/json" }).end();
    if (url === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
    if (url === "/json") return res.end(JSON.stringify({ ok: true, agent: req.headers["user-agent"] }));
    if (url === "/big") return res.end(Buffer.alloc(4096, 65));
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});

afterAll(() => server.close());

describe("requestText", () => {
  it("follows redirects and sends the WaveAMP user agent", async () => {
    expect(await requestJson(`${base}/redirect`)).toEqual({ ok: true, agent: `WaveAMP/${WAVEAMP_VERSION}` });
  });

  it("stops at redirect loops, error statuses and oversized answers", async () => {
    await expect(requestText(`${base}/loop`)).rejects.toThrow("HTTP 302");
    await expect(requestText(`${base}/missing`)).rejects.toThrow("HTTP 404");
    await expect(requestText(`${base}/big`, 5000, 1000)).rejects.toThrow("Response is too large");
  });
});
