import { artworkSource } from "./cover";
import { audio } from "./dom";
import { next, playPause, previous, stop } from "./playback";
import { currentTrack, player, radio, shownTitle } from "./state";

let mediaSessionKey = "";

export function updateMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const session = navigator.mediaSession;
  session.playbackState = !audio.getAttribute("src") ? "none" : audio.paused ? "paused" : "playing";
  const track = currentTrack();
  const station = player.mode === "radio" ? radio.station : null;
  let metadata: MediaMetadataInit | null = null;
  if (station) {
    const playing = shownTitle();
    metadata = { title: playing || station.name, artist: playing ? station.name : station.country || "", album: "WaveAMP" };
  } else if (track) {
    metadata = { title: track.tags?.title || track.name, artist: track.tags?.artist || "", album: track.tags?.album || "" };
  }
  const artwork = metadata ? artworkSource() : null;
  const key = JSON.stringify([metadata, artwork]);
  if (key === mediaSessionKey) return;
  mediaSessionKey = key;
  session.metadata = metadata ? new MediaMetadata({ ...metadata, artwork: artwork ? [{ src: artwork, sizes: "any" }] : [] }) : null;
}

export function registerMediaKeys(): void {
  if (!("mediaSession" in navigator)) return;
  const handlers: [MediaSessionAction, () => void][] = [
    ["play", () => audio.paused && playPause()],
    ["pause", () => audio.pause()],
    ["stop", () => stop()],
    ["previoustrack", () => previous()],
    ["nexttrack", () => next()],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {}
  }
}
