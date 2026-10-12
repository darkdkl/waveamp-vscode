import type { ToWebview } from "../shared/messages";
import { post, settleRequest } from "./bridge";
import { initEqPanel } from "./eqPanel";
import { registerMediaKeys } from "./mediaSession";
import { initPlayback, next, playPause, previous, renderPlayState, stop } from "./playback";
import { addTracks, applyTags, initPlaylist, render } from "./playlist";
import { setNowPlaying } from "./radio/nowPlaying";
import { initRadioPanel } from "./radio/panel";
import { initSavedTracks, setSavedTracks, toggleCurrentSaved } from "./radio/savedTracks";
import { initStationForm, openStationForm } from "./radio/stationForm";
import { restore } from "./restore";
import { applySettings } from "./settingsBridge";
import { initTitleScroll } from "./titleScroll";

const commands = {
  playPause,
  stop,
  next,
  previous,
  addStation: () => openStationForm(),
  saveTrack: toggleCurrentSaved,
};

function handle(message: ToWebview): void {
  switch (message.type) {
    case "add":
      return addTracks(message.tracks);
    case "tags":
      return applyTags(message.items ?? []);
    case "response":
      return settleRequest(message.id, message.result, message.error);
    case "nowPlaying":
      return setNowPlaying(message.source, message.title);
    case "settings":
      return applySettings(message);
    case "savedTracks":
      return setSavedTracks(Array.isArray(message.tracks) ? message.tracks : []);
    case "restore":
      return restore(message);
    case "command":
      return commands[message.name]?.();
  }
}

initPlayback();
initPlaylist();
initEqPanel();
initRadioPanel();
initStationForm();
initSavedTracks();
initTitleScroll();
window.addEventListener("message", (event: MessageEvent<ToWebview>) => handle(event.data));
render();
renderPlayState();
registerMediaKeys();
post({ type: "ready" });
