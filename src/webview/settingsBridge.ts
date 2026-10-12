import { dimLightness } from "../shared/contrast";
import type { ToWebview } from "../shared/messages";
import { applyStereo } from "./audioGraph";
import { postState } from "./bridge";
import { refreshCover } from "./cover";
import { renderTitle } from "./playback";
import { renderSaveButton } from "./radio/savedTracks";
import { settings } from "./state";
import { refreshTitleScroll } from "./titleScroll";

export function applySettings(message: Extract<ToWebview, { type: "settings" }>): void {
  const root = document.documentElement.style;
  if (message.accent) {
    root.setProperty("--accent-h", String(message.accent.hue));
    root.setProperty("--accent-s", `${message.accent.saturation}%`);
    root.setProperty("--accent-dim-l", `${dimLightness(message.accent.hue, message.accent.saturation)}%`);
  }
  document.body.classList.toggle("skin-dark", message.body === "dark");
  document.body.classList.toggle("skin-light", message.body === "light");
  settings.showTrackTitles = message.showTrackTitles !== false;
  if (message.stereo) settings.stereo = message.stereo;
  settings.coverArt = message.coverArt !== false;
  const scrollChanged = settings.titleScroll !== message.titleScroll || settings.titleScrollSpeed !== message.titleScrollSpeed;
  settings.titleScroll = message.titleScroll;
  settings.titleScrollSpeed = message.titleScrollSpeed;
  if (message.routes) settings.routes = message.routes;
  void refreshCover();
  applyStereo();
  renderTitle();
  if (scrollChanged) refreshTitleScroll();
  renderSaveButton();
  postState();
}
