import { httpGet, ProxyDropError } from "./proxy";
import { writeLog } from "./log";

export const USER_AGENT = `WaveAMP/${WAVEAMP_VERSION}`;
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const PROXY_RETRY_DELAYS_MS = [1000, 2000];

class StaleConnectionError extends Error {}

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export async function requestText(url: string, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = 8 * 1024 * 1024): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchText(url, timeoutMs, maxBytes);
    } catch (err) {
      const retryable = err instanceof ProxyDropError || err instanceof StaleConnectionError;
      if (!retryable || attempt >= PROXY_RETRY_DELAYS_MS.length) throw err;
      writeLog("info", "proxy", `Retrying ${new URL(url).host}`);
      await new Promise((resolve) => setTimeout(resolve, PROXY_RETRY_DELAYS_MS[attempt]));
    }
  }
}

function fetchText(url: string, timeoutMs: number, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = (target: string, redirects: number) => {
      const parsed = new URL(target);
      const request = httpGet(parsed, { headers: { "User-Agent": USER_AGENT }, timeout: timeoutMs }, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location && redirects < MAX_REDIRECTS) {
          response.resume();
          get(new URL(response.headers.location, parsed).href, redirects + 1);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new HttpStatusError(status));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new Error("Response is too large"));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new Error(`Timed out after ${timeoutMs} ms`)));
      request.on("error", (err: NodeJS.ErrnoException) =>
        reject(request.reusedSocket && err.code === "ECONNRESET" ? new StaleConnectionError(err.message) : err)
      );
    };
    get(url, 0);
  });
}

export async function requestJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return JSON.parse(await requestText(url, timeoutMs)) as T;
}
