import { HLS_NOT_SUPPORTED } from "../../shared/messages";
import type { FavoriteStation } from "../../shared/messages";
import { applyStereo } from "../audioGraph";
import { postState, request } from "../bridge";
import { refreshCover } from "../cover";
import { audio, durationEl, liveEl, seek, t, timeEl } from "../dom";
import { setTitleText } from "../titleScroll";
import { play, renderTitle, stopSegmentTimer } from "../playback";
import { render } from "../playlist";
import { player, radio } from "../state";
import { renderStations } from "./panel";
import { renderSaveButton } from "./savedTracks";

const RECONNECT_DELAYS_MS = [2000, 4000, 8000];

export function enterRadioMode(): void {
  if (player.mode === "radio") return;
  player.mode = "radio";
  stopSegmentTimer();
  player.pendingStart = null;
  player.loadedSrc = null;
  seek.disabled = true;
  seek.value = "0";
  durationEl.hidden = true;
  liveEl.hidden = false;
  render();
  applyStereo();
}

export function leaveRadio(): void {
  clearTimeout(radio.reconnectTimer);
  player.mode = "local";
  radio.station = null;
  radio.source = null;
  radio.title = null;
  radio.status = "";
  durationEl.hidden = false;
  liveEl.hidden = true;
  applyStereo();
  renderStations();
  renderSaveButton();
}

export async function playStation(station: FavoriteStation | null, reconnect = false): Promise<void> {
  if (!station) return;
  clearTimeout(radio.reconnectTimer);
  enterRadioMode();
  if (!reconnect) radio.reconnects = 0;
  radio.station = station;
  radio.title = null;
  radio.status = reconnect ? t.reconnecting : "";
  timeEl.textContent = "00:00";
  player.playRequested = true;
  void refreshCover();
  renderTitle();
  renderStations();
  renderSaveButton();
  postState();
  try {
    const stream = await request("playStation", { station, reconnect });
    if (radio.station !== station) return;
    radio.source = stream.source;
    audio.src = stream.url;
    play();
  } catch (err) {
    if (radio.station !== station) return;
    radio.status = "";
    setTitleText((err as Error).message === HLS_NOT_SUPPORTED ? t.hlsNotSupported : t.stationPlaylistFailed);
  }
}

export function reconnectStation(): void {
  if (radio.reconnects >= RECONNECT_DELAYS_MS.length) {
    radio.status = t.noConnection;
    renderTitle();
    return;
  }
  const delay = RECONNECT_DELAYS_MS[radio.reconnects++];
  radio.status = t.reconnecting;
  renderTitle();
  const station = radio.station;
  radio.reconnectTimer = setTimeout(() => {
    if (player.mode === "radio" && radio.station === station && player.playRequested) void playStation(station, true);
  }, delay);
}

export function cycleFavorite(direction: number): void {
  if (!radio.favorites.length) return;
  const index = radio.favorites.findIndex((s) => s.stationuuid === radio.station?.stationuuid);
  const nextIndex = index < 0 ? 0 : (index + direction + radio.favorites.length) % radio.favorites.length;
  void playStation(radio.favorites[nextIndex]);
}
