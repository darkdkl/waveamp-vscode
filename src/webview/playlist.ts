import type { PlayerTrack } from "../shared/messages";
import type { TrackTags } from "../shared/types";
import { persist, post, postState } from "./bridge";
import { $, audio, empty, list, playlist, playlistToggle, radioPanel, radioToggle, setPanelOpen, t } from "./dom";
import { displayName, formatTime } from "./format";
import { clearSource, load, renderDuration, renderTitle } from "./playback";
import { currentTrack, player } from "./state";

export function render(): void {
  list.innerHTML = "";
  player.rows = [];
  empty.hidden = player.tracks.length > 0;
  list.hidden = player.tracks.length === 0;
  player.tracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className =
      "playlist__item" + (player.mode === "local" && index === player.current ? " is-active" : "") + (track.broken ? " is-unplayable" : "");
    if (track.broken) item.title = t.trackUnplayable;
    const idx = document.createElement("span");
    idx.className = "playlist__item-index";
    idx.textContent = String(index + 1);
    const name = document.createElement("span");
    name.className = "playlist__item-name";
    name.textContent = displayName(track);
    const duration = document.createElement("span");
    duration.className = "playlist__item-duration";
    duration.textContent = track.duration ? formatTime(track.duration) : "";
    const remove = document.createElement("button");
    remove.className = "playlist__item-remove";
    remove.type = "button";
    remove.title = t.removeFromPlaylist;
    remove.setAttribute("aria-label", t.removeFromPlaylist);
    remove.textContent = "✕";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTrack(index);
    });
    item.append(idx, name, duration, remove);
    item.addEventListener("click", () => load(index, true));
    list.appendChild(item);
    player.rows.push({ name, duration });
  });
  renderTitle();
}

function renderRow(index: number): void {
  const row = player.rows[index];
  const track = player.tracks[index];
  if (!row || !track) return;
  row.name.textContent = displayName(track);
  row.duration.textContent = track.duration ? formatTime(track.duration) : "";
}

function removeTrack(index: number): void {
  const removingCurrent = index === player.current;
  player.tracks.splice(index, 1);
  if (player.tracks.length === 0) clearSource();
  else if (removingCurrent) return load(Math.min(index, player.tracks.length - 1), !audio.paused);
  else if (index < player.current) player.current -= 1;
  render();
  postState();
  persist();
}

export function addTracks(tracks: PlayerTrack[]): void {
  const wasEmpty = player.tracks.length === 0;
  player.tracks.push(...tracks);
  render();
  persist();
  if (wasEmpty) load(0, true);
}

export function applyTags(items: { path: string; tags: TrackTags }[]): void {
  const tagsByPath = new Map(items.map((item) => [item.path, item.tags]));
  let changed = false;
  player.tracks.forEach((track, index) => {
    const tags = track.start == null ? tagsByPath.get(track.path) : undefined;
    if (!tags) return;
    track.tags = tags;
    if (!track.duration && tags.duration) track.duration = tags.duration;
    renderRow(index);
    changed = true;
  });
  if (!changed) return;
  persist();
  const track = currentTrack();
  if (track && tagsByPath.has(track.path)) {
    renderTitle();
    renderDuration();
    postState();
  }
}

export function initPlaylist(): void {
  $("addFilesBtn").addEventListener("click", () => post({ type: "addFiles" }));
  $("addFolderBtn").addEventListener("click", () => post({ type: "addFolder" }));
  $("clearBtn").addEventListener("click", () => {
    player.tracks = [];
    clearSource();
    render();
    postState();
    persist();
  });
  playlistToggle.addEventListener("click", () => {
    const open = playlist.hidden;
    setPanelOpen(playlist, playlistToggle, open);
    if (open) setPanelOpen(radioPanel, radioToggle, false);
    persist();
  });
}
