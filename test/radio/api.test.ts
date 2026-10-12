import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStreamUrl } from "../../src/radio/api";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/hls.pls") return res.end("[playlist]\nFile1=http://radio.test/live/index.m3u8\n");
    if (req.url === "/radio.pls") return res.end("[playlist]\nFile1=http://radio.test/live.mp3\n");
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});

afterAll(() => server.close());

describe("resolveStreamUrl", () => {
  it("passes direct streams through and reads PLS playlists", async () => {
    expect(await resolveStreamUrl("https://radio.test/live.mp3")).toBe("https://radio.test/live.mp3");
    expect(await resolveStreamUrl(`${base}/radio.pls`)).toBe("http://radio.test/live.mp3");
  });

  it("rejects HLS streams, also behind a playlist", async () => {
    await expect(resolveStreamUrl("https://radio.test/master.m3u8")).rejects.toThrow("hls");
    await expect(resolveStreamUrl(`${base}/hls.pls`)).rejects.toThrow("hls");
  });

  it("returns null for broken playlists and other schemes", async () => {
    expect(await resolveStreamUrl(`${base}/missing.pls`)).toBeNull();
    expect(await resolveStreamUrl("ftp://radio.test/live")).toBeNull();
  });
});
