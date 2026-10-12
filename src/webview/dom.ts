import type { Strings } from "../i18n";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const t: Strings = JSON.parse($("strings").textContent ?? "{}");

export const audio = $<HTMLAudioElement>("audio");
export const timeEl = $("time");
export const titleEl = $("title");
export const durationEl = $("duration");
export const channelsEl = $("channels");
export const liveEl = $("live");
export const displayEl = document.querySelector(".display") as HTMLElement;
export const seek = $<HTMLInputElement>("seek");
export const volume = $<HTMLInputElement>("volume");
export const playBtn = $<HTMLButtonElement>("playBtn");

export const playlist = $("playlist");
export const playlistToggle = $<HTMLButtonElement>("playlistToggle");
export const list = $<HTMLOListElement>("list");
export const empty = $("empty");

export const eqPanel = $("eq");
export const eqToggle = $<HTMLButtonElement>("eqToggle");
export const eqPresetSelect = $<HTMLSelectElement>("eqPreset");
export const eqResetBtn = $<HTMLButtonElement>("eqResetBtn");
export const eqToggleBtn = $<HTMLButtonElement>("eqToggleBtn");

export const radioPanel = $("radio");
export const radioToggle = $<HTMLButtonElement>("radioToggle");
export const radioList = $<HTMLOListElement>("radioList");
export const radioMessage = $("radioMessage");
export const radioForm = $<HTMLFormElement>("radioSearchForm");
export const radioQuery = $<HTMLInputElement>("radioQuery");
export const radioCountry = $<HTMLSelectElement>("radioCountry");
export const radioState = $<HTMLSelectElement>("radioState");
export const radioTag = $<HTMLSelectElement>("radioTag");
export const radioSearchTab = $<HTMLButtonElement>("radioSearchTab");
export const radioFavoritesTab = $<HTMLButtonElement>("radioFavoritesTab");
export const radioSavedTab = $<HTMLButtonElement>("radioSavedTab");
export const radioAddBtn = $<HTMLButtonElement>("radioAddBtn");

export const saveTrackBtn = $<HTMLButtonElement>("saveTrackBtn");
export const savedCount = $("savedCount");
export const savedActions = $("savedActions");
export const savedCopyAll = $<HTMLButtonElement>("savedCopyAll");
export const savedClear = $<HTMLButtonElement>("savedClear");

export const stationForm = $<HTMLFormElement>("stationForm");
export const stationFormTitle = $("stationFormTitle");
export const stationName = $<HTMLInputElement>("stationName");
export const stationUrl = $<HTMLInputElement>("stationUrl");
export const stationError = $("stationError");
export const stationSubmit = $<HTMLButtonElement>("stationSubmit");

export function setPanelOpen(panel: HTMLElement, toggle: HTMLElement, open: boolean): void {
  panel.hidden = !open;
  toggle.setAttribute("aria-pressed", String(open));
}

export function svgIcon(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}
