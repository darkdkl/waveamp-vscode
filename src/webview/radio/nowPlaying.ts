import { postState } from "../bridge";
import { renderTitle } from "../playback";
import { player, radio } from "../state";
import { renderSaveButton } from "./savedTracks";

export function setNowPlaying(source: string, title: string | null): void {
  if (player.mode !== "radio" || source !== radio.source || title === radio.title) return;
  radio.title = title;
  renderTitle();
  renderSaveButton();
  postState();
}
