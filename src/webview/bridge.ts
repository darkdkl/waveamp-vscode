import type { RequestMethod, Requests, ToExtension } from "../shared/messages";
import { audio, eqPanel, playlist, radioPanel, volume } from "./dom";
import { displayName } from "./format";
import { updateMediaSession } from "./mediaSession";
import { currentTrack, eq, player, radio, stationTitle } from "./state";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const PERSIST_DELAY_MS = 300;

const vscode = acquireVsCodeApi();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
let requestId = 0;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function post(message: ToExtension): void {
  vscode.postMessage(message);
}

export function request<M extends RequestMethod>(method: M, params: Requests[M]["params"]): Promise<Requests[M]["result"]> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ type: "request", id, method, params });
  });
}

export function settleRequest(id: number, result: unknown, error: string | undefined): void {
  const waiter = pending.get(id);
  if (!waiter) return;
  pending.delete(id);
  if (error) waiter.reject(new Error(error));
  else waiter.resolve(result);
}

export function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    post({
      type: "persist",
      state: {
        tracks: player.tracks
          .filter((track) => track.path)
          .map((track) =>
            track.start == null
              ? { path: track.path, name: track.name, ...(track.tags ? { tags: track.tags } : {}) }
              : { path: track.path, name: track.name, start: track.start, end: track.end ?? null, tags: track.tags }
          ),
        currentIndex: player.current,
        volume: Number(volume.value),
        eq,
        ui: { playlistOpen: !playlist.hidden, eqOpen: !eqPanel.hidden, radioOpen: !radioPanel.hidden },
        radio: { favorites: radio.favorites, view: radio.view, filters: radio.filters },
      },
    });
  }, PERSIST_DELAY_MS);
}

export function postState(): void {
  const track = currentTrack();
  const title = player.mode === "radio" ? stationTitle() : track ? displayName(track) : "";
  post({ type: "state", playing: !audio.paused, title });
  updateMediaSession();
}
