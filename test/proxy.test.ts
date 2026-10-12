import http from "node:http";
import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { httpGet, ProxyDropError, setProxySettings, type ProxySettings } from "../src/proxy";
import { requestText } from "../src/net";

const listen = (server: net.Server) =>
  new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));

let targetPort = 0;
const servers: net.Server[] = [];
const seen: string[] = [];

function start(server: net.Server): Promise<number> {
  servers.push(server);
  return listen(server);
}

function socksProxy(options: { login?: boolean } = {}): net.Server {
  return net.createServer((client) => {
    client.once("data", () => {
      if (options.login) return client.end(Buffer.from([5, 0xff]));
      client.write(Buffer.from([5, 0]));
      client.once("data", (request) => {
        const host = request.subarray(5, 5 + request[4]).toString();
        const port = request.readUInt16BE(5 + request[4]);
        seen.push(`socks ${host}:${port}`);
        const upstream = net.connect(targetPort, "127.0.0.1", () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      });
    });
  });
}

function httpProxy(connect: "tunnel" | "drop" | "refuse"): net.Server {
  const server = http.createServer((req, res) => {
    seen.push(`http GET ${req.url}`);
    const target = new URL(req.url ?? "");
    http.get({ host: "127.0.0.1", port: targetPort, path: target.pathname + target.search }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
  });
  server.on("connect", (req, client: net.Socket) => {
    seen.push(`http CONNECT ${req.url}`);
    if (connect === "refuse") return client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (connect === "drop") return void client.once("data", () => client.end());
    const upstream = net.connect(targetPort, "127.0.0.1", () => client.pipe(upstream).pipe(client));
    upstream.on("error", () => client.destroy());
  });
  return server;
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpGet(new URL(url), { timeout: 5000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => resolve(`${response.statusCode} ${body}`));
    });
    request.on("error", reject);
  });
}

const custom = (type: ProxySettings["type"], port: number): ProxySettings => ({ mode: "custom", type, host: "127.0.0.1", port });

let socksPort = 0;
let loginSocksPort = 0;
let tunnelPort = 0;
let dropPort = 0;
let refusePort = 0;
let deadPort = 0;

beforeAll(async () => {
  targetPort = await start(http.createServer((req, res) => res.end(`hello ${req.url}`)));
  socksPort = await start(socksProxy());
  loginSocksPort = await start(socksProxy({ login: true }));
  tunnelPort = await start(httpProxy("tunnel"));
  dropPort = await start(httpProxy("drop"));
  refusePort = await start(httpProxy("refuse"));
  const dead = net.createServer();
  deadPort = await listen(dead);
  dead.close();
});

afterEach(() => {
  seen.length = 0;
  setProxySettings({ mode: "vscode", type: "http", host: "", port: 0 });
});

afterAll(() => servers.forEach((server) => server.close()));

describe("custom SOCKS5 proxy", () => {
  it("tunnels requests and reuses the tunnel", async () => {
    setProxySettings(custom("socks5", socksPort));
    expect(await get("http://radio.test/one")).toBe("200 hello /one");
    expect(await get("http://radio.test/two")).toBe("200 hello /two");
    expect(seen).toEqual(["socks radio.test:80"]);
  });

  it("opens a new tunnel after the settings change", async () => {
    setProxySettings(custom("socks5", socksPort));
    await get("http://radio.test/a");
    setProxySettings(custom("socks5", socksPort));
    await get("http://radio.test/b");
    expect(seen).toEqual(["socks radio.test:80", "socks radio.test:80"]);
  });

  it("explains that logins are not supported", async () => {
    setProxySettings(custom("socks5", loginSocksPort));
    await expect(get("http://radio.test/")).rejects.toThrow(/login/);
  });
});

describe("custom HTTP proxy", () => {
  it("sends plain http requests in absolute form", async () => {
    setProxySettings(custom("http", tunnelPort));
    expect(await get("http://radio.test/live?x=1")).toBe("200 hello /live?x=1");
    expect(seen).toEqual(["http GET http://radio.test/live?x=1"]);
  });

  it("reports a refused CONNECT without retrying", async () => {
    setProxySettings(custom("http", refusePort));
    await expect(requestText("https://radio.test/json", 5000)).rejects.toThrow("HTTP proxy refused the connection (HTTP 403)");
    expect(seen).toEqual(["http CONNECT radio.test:443"]);
  });

  it("retries twice when the proxy drops the tunnel before TLS", async () => {
    setProxySettings(custom("http", dropPort));
    const failure = requestText("https://radio.test/json", 5000);
    await expect(failure).rejects.toBeInstanceOf(ProxyDropError);
    await expect(failure).rejects.toThrow("Proxy closed the connection to radio.test:443 before TLS");
    expect(seen).toHaveLength(3);
  }, 10_000);
});

describe("proxy bypass", () => {
  it("connects to this computer directly", async () => {
    setProxySettings(custom("socks5", deadPort));
    expect(await get(`http://127.0.0.1:${targetPort}/local`)).toBe("200 hello /local");
    expect(await get(`http://localhost:${targetPort}/local`)).toBe("200 hello /local");
  });

  it("ignores the custom proxy in direct mode and without a host", async () => {
    setProxySettings({ ...custom("socks5", deadPort), mode: "direct" });
    expect(await get(`http://127.0.0.1:${targetPort}/direct`)).toBe("200 hello /direct");
    setProxySettings({ ...custom("socks5", socksPort), host: "" });
    expect(await get(`http://127.0.0.1:${targetPort}/nohost`)).toBe("200 hello /nohost");
    expect(seen).toEqual([]);
  });

  it("fails clearly when the proxy is not running", async () => {
    setProxySettings(custom("socks5", deadPort));
    await expect(get("http://radio.test/")).rejects.toThrow(/ECONNREFUSED/);
  });
});
