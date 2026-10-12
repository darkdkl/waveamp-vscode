import type { SavedTrack } from "../../shared/types";
import { post, request } from "../bridge";
import { saveTrackBtn, savedClear, savedCopyAll, svgIcon, t } from "../dom";
import { savedTrackKey } from "../../shared/savedTracks";
import { renderStations } from "./panel";
import { player, radio, shownTitle } from "../state";

const COPY_FEEDBACK_MS = 1000;
const SAVED_TEXT_LIMIT = 500;
const COPY_ICON = svgIcon(
  "M8 3h11a2 2 0 012 2v11h-2V5H8V3zM5 7h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2zm0 2v10h10V9H5z"
);

const savedIndex = (title: string) => player.savedTracks.findIndex((track) => savedTrackKey(track.title) === savedTrackKey(title));

export function renderSaveButton(): void {
  const title = player.mode === "radio" ? shownTitle() : null;
  saveTrackBtn.hidden = !title;
  if (!title) return;
  const saved = savedIndex(title) >= 0;
  saveTrackBtn.classList.toggle("is-saved", saved);
  saveTrackBtn.title = saved ? t.unsaveTrack : t.saveTrack;
  saveTrackBtn.setAttribute("aria-label", saveTrackBtn.title);
  saveTrackBtn.setAttribute("aria-pressed", String(saved));
}

function savedTracksChanged(): void {
  post({ type: "saveSavedTracks", tracks: player.savedTracks });
  renderSaveButton();
  renderStations();
}

export function toggleCurrentSaved(): void {
  const title = player.mode === "radio" ? shownTitle() : null;
  if (!title) return;
  const index = savedIndex(title);
  if (index >= 0) player.savedTracks.splice(index, 1);
  else player.savedTracks.unshift({ title: title.slice(0, SAVED_TEXT_LIMIT), station: radio.station?.name ?? "", savedAt: Date.now() });
  savedTracksChanged();
}

async function clearSavedTracks(): Promise<void> {
  if (!player.savedTracks.length) return;
  if (!(await request("confirm", { message: t.clearSavedTracksConfirm }).catch(() => false))) return;
  player.savedTracks = [];
  savedTracksChanged();
}

export function savedRow(track: SavedTrack): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "radio__item";
  const text = document.createElement("span");
  text.className = "radio__item-text";
  const name = document.createElement("span");
  name.className = "radio__item-name";
  name.textContent = track.title;
  const meta = document.createElement("span");
  meta.className = "radio__item-meta";
  meta.textContent = track.station;
  text.append(name, meta);
  let feedback: ReturnType<typeof setTimeout> | undefined;
  const copy = () => {
    post({ type: "copy", text: track.title });
    clearTimeout(feedback);
    item.classList.add("is-copied");
    meta.textContent = t.copied;
    feedback = setTimeout(() => {
      item.classList.remove("is-copied");
      meta.textContent = track.station;
    }, COPY_FEEDBACK_MS);
  };
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "radio__star radio__edit";
  copyBtn.title = t.copyTitle;
  copyBtn.setAttribute("aria-label", t.copyTitle);
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    copy();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "playlist__item-remove";
  remove.title = t.removeSavedTrack;
  remove.setAttribute("aria-label", t.removeSavedTrack);
  remove.textContent = "✕";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    const index = savedIndex(track.title);
    if (index >= 0) player.savedTracks.splice(index, 1);
    savedTracksChanged();
  });
  item.append(text, copyBtn, remove);
  item.addEventListener("click", copy);
  return item;
}

export function setSavedTracks(tracks: SavedTrack[]): void {
  player.savedTracks = tracks;
  renderSaveButton();
  renderStations();
}

export function initSavedTracks(): void {
  saveTrackBtn.addEventListener("click", toggleCurrentSaved);
  savedCopyAll.addEventListener("click", () => post({ type: "copy", text: player.savedTracks.map((track) => track.title).join("\n") }));
  savedClear.addEventListener("click", () => void clearSavedTracks());
}
