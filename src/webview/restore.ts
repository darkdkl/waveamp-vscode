import type { ToWebview } from "../shared/messages";
import { audio, eqPanel, eqToggle, playlist, playlistToggle, setPanelOpen, volume } from "./dom";
import { restoreEq } from "./eqPanel";
import { load } from "./playback";
import { render } from "./playlist";
import { openRadio, restoreRadio } from "./radio/panel";
import { player } from "./state";

export function restore(message: Extract<ToWebview, { type: "restore" }>): void {
  player.tracks = message.tracks ?? [];
  if (typeof message.volume === "number") {
    volume.value = String(message.volume);
    audio.volume = message.volume / 100;
  }
  restoreEq(message.eq);
  restoreRadio(message.radio);
  const ui = message.ui as { playlistOpen?: unknown; eqOpen?: unknown; radioOpen?: unknown } | undefined;
  if (ui && typeof ui === "object") {
    setPanelOpen(playlist, playlistToggle, ui.playlistOpen !== false);
    setPanelOpen(eqPanel, eqToggle, ui.eqOpen === true);
    if (ui.radioOpen === true) openRadio(true);
  }
  render();
  if (message.currentIndex >= 0 && message.currentIndex < player.tracks.length) load(message.currentIndex, false);
}
