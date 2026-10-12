import type { CountedOption, CountryOption } from "../../shared/types";
import { CATALOG_UNAVAILABLE, type FavoriteStation, type RadioView } from "../../shared/messages";
import { persist, request } from "../bridge";
import { playlist, playlistToggle, radioAddBtn, radioCountry, radioFavoritesTab, radioForm, radioList, radioMessage, radioPanel, radioQuery, radioSavedTab, radioSearchTab, radioState, radioTag, radioToggle, savedActions, savedClear, savedCopyAll, savedCount, setPanelOpen, stationForm, svgIcon, t } from "../dom";
import { stationMeta } from "../format";
import { player, radio } from "../state";
import { openStationForm } from "./stationForm";
import { playStation } from "./stream";
import { savedRow } from "./savedTracks";

const RADIO_VIEWS: RadioView[] = ["favorites", "search", "saved"];

const PENCIL_ICON = svgIcon("M4 16.8V20h3.2l9.4-9.4-3.2-3.2L4 16.8zm15.1-8.7a.9.9 0 000-1.2l-2-2a.9.9 0 00-1.2 0l-1.6 1.6 3.2 3.2 1.6-1.6z");

const STAR_ICON = svgIcon("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z");

export const isFavorite = (station: FavoriteStation) => radio.favorites.some((s) => s.stationuuid === station.stationuuid);

export function toggleFavorite(station: FavoriteStation): void {
  if (isFavorite(station)) radio.favorites = radio.favorites.filter((s) => s.stationuuid !== station.stationuuid);
  else radio.favorites.push(station);
  renderStations();
  persist();
}

export function renderStations(): void {
  const view = radio.view;
  const favoritesView = view === "favorites";
  const stations: FavoriteStation[] = favoritesView ? radio.favorites : view === "saved" ? [] : radio.results;
  const saved = player.savedTracks;
  radioForm.hidden = view !== "search" || radio.formOpen;
  stationForm.hidden = !radio.formOpen;
  savedActions.hidden = view !== "saved" || radio.formOpen;
  for (const [tab, name] of [
    [radioSearchTab, "search"],
    [radioFavoritesTab, "favorites"],
    [radioSavedTab, "saved"],
  ] as const) {
    tab.setAttribute("aria-pressed", String(view === name && !radio.formOpen));
  }
  radioAddBtn.setAttribute("aria-pressed", String(radio.formOpen && !radio.editingId));
  savedCount.hidden = saved.length === 0;
  savedCount.textContent = String(saved.length);
  savedCopyAll.disabled = saved.length === 0;
  savedClear.disabled = saved.length === 0;
  radioList.innerHTML = "";
  if (view === "saved") {
    for (const track of saved) radioList.appendChild(savedRow(track));
    radioList.hidden = saved.length === 0 || radio.formOpen;
    radioMessage.hidden = saved.length > 0 || radio.formOpen;
    radioMessage.textContent = t.noSavedTracks;
    return;
  }
  for (const station of stations) {
    const item = document.createElement("li");
    const active = player.mode === "radio" && radio.station?.stationuuid === station.stationuuid;
    item.className = "radio__item" + (active ? " is-active" : "");
    const text = document.createElement("span");
    text.className = "radio__item-text";
    const name = document.createElement("span");
    name.className = "radio__item-name";
    name.textContent = station.name;
    const meta = document.createElement("span");
    meta.className = "radio__item-meta";
    meta.textContent = stationMeta(station);
    text.append(name, meta);
    const star = document.createElement("button");
    const on = isFavorite(station);
    star.type = "button";
    star.className = "radio__star" + (on ? " is-on" : "");
    star.title = on ? t.removeFavorite : t.addFavorite;
    star.setAttribute("aria-label", star.title);
    star.innerHTML = STAR_ICON;
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(station);
    });
    if (station.custom) {
      const pencil = document.createElement("button");
      pencil.type = "button";
      pencil.className = "radio__star radio__edit";
      pencil.title = t.editStation;
      pencil.setAttribute("aria-label", t.editStation);
      pencil.innerHTML = PENCIL_ICON;
      pencil.addEventListener("click", (event) => {
        event.stopPropagation();
        openStationForm(station);
      });
      item.append(text, pencil, star);
    } else item.append(text, star);
    item.addEventListener("click", () => void playStation(station));
    radioList.appendChild(item);
  }
  radioList.hidden = stations.length === 0 || radio.formOpen;
  if (stations.length || radio.formOpen) radioMessage.hidden = true;
  else {
    radioMessage.hidden = false;
    if (favoritesView) radioMessage.textContent = t.noFavorites;
  }
}

function fillSelect(select: HTMLSelectElement, anyLabel: string, options: (CountedOption | CountryOption)[], selected: string): void {
  select.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = anyLabel;
  select.appendChild(any);
  const valueOf = (option: CountedOption | CountryOption) => ("code" in option ? option.code : option.name);
  for (const option of options) {
    const el = document.createElement("option");
    el.value = valueOf(option);
    el.textContent = `${option.name} (${option.count})`;
    if ("code" in option) el.dataset.name = option.name;
    select.appendChild(el);
  }
  select.value = options.some((o) => valueOf(o) === selected) ? selected : "";
}

async function loadCountries(): Promise<void> {
  if (radio.countriesLoaded) return;
  radio.countriesLoaded = true;
  try {
    fillSelect(radioCountry, t.countryAny, await request("countries", {}), radio.filters.country);
    if (radio.filters.country) await loadStates();
    await loadTags();
  } catch {
    radio.countriesLoaded = false;
  }
}

export async function loadStates(): Promise<void> {
  radioState.disabled = !radio.filters.country;
  if (!radio.filters.country) return fillSelect(radioState, t.stateAny, [], "");
  const states = await request("states", { country: radio.filters.countryName }).catch((): CountedOption[] => []);
  fillSelect(radioState, t.stateAny, states, radio.filters.state);
  radioState.disabled = states.length === 0;
}

export async function loadTags(): Promise<void> {
  const tags = await request("tags", { countryCode: radio.filters.country, state: radio.filters.state }).catch((): CountedOption[] => []);
  fillSelect(radioTag, t.tagAny, tags, radio.filters.tag);
}

export async function searchStations(): Promise<void> {
  const { query, country, state, tag } = radio.filters;
  const token = ++radio.searchToken;
  radio.results = [];
  renderStations();
  if (!query && !country && !state && !tag) {
    radioMessage.textContent = t.enterNameOrFilter;
    return;
  }
  radioMessage.textContent = t.searching;
  try {
    const stations = await request("searchStations", { name: query, country, state, tag });
    if (token !== radio.searchToken) return;
    radio.results = stations;
    renderStations();
    if (!stations.length) radioMessage.textContent = t.nothingFound;
  } catch (err) {
    if (token !== radio.searchToken) return;
    if ((err as Error).message !== CATALOG_UNAVAILABLE) {
      radioMessage.textContent = t.loadFailed;
      return;
    }
    const title = document.createElement("span");
    title.className = "radio__message-title";
    title.textContent = t.catalogUnavailable;
    const hint = document.createElement("span");
    hint.textContent = t.catalogUnavailableHint;
    radioMessage.replaceChildren(title, hint);
  }
}

export function setRadioView(view: RadioView): void {
  if (radio.formOpen) {
    radio.formOpen = false;
    radio.editingId = null;
  }
  radio.view = view;
  renderStations();
  if (view === "search" && !radio.results.length) void searchStations();
  persist();
}

export function restoreRadio(saved: unknown): void {
  if (!saved || typeof saved !== "object") return;
  const s = saved as { favorites?: unknown; view?: unknown; filters?: Record<string, unknown> };
  if (Array.isArray(s.favorites)) {
    radio.favorites = s.favorites.filter(
      (station): station is FavoriteStation => !!station && typeof station.stationuuid === "string" && typeof station.url === "string"
    );
  }
  if (RADIO_VIEWS.includes(s.view as RadioView)) radio.view = s.view as RadioView;
  if (s.filters && typeof s.filters === "object") {
    for (const key of Object.keys(radio.filters) as (keyof typeof radio.filters)[]) {
      const value = s.filters[key];
      if (typeof value === "string") radio.filters[key] = value;
    }
  }
  radioQuery.value = radio.filters.query;
}

export function openRadio(open: boolean): void {
  setPanelOpen(radioPanel, radioToggle, open);
  if (open) {
    setPanelOpen(playlist, playlistToggle, false);
    void loadCountries();
    renderStations();
    if (radio.view === "search" && !radio.results.length) void searchStations();
  }
}

export function initRadioPanel(): void {
  radioToggle.addEventListener("click", () => {
    openRadio(radioPanel.hidden);
    persist();
  });
  radioSearchTab.addEventListener("click", () => setRadioView("search"));
  radioSavedTab.addEventListener("click", () => setRadioView("saved"));
  radioFavoritesTab.addEventListener("click", () => setRadioView("favorites"));
  radioForm.addEventListener("submit", (event) => {
    event.preventDefault();
    radio.filters.query = radioQuery.value.trim();
    void searchStations();
    persist();
  });
  radioCountry.addEventListener("change", async () => {
    radio.filters.country = radioCountry.value;
    radio.filters.countryName = radioCountry.selectedOptions[0]?.dataset.name ?? "";
    radio.filters.state = "";
    radio.filters.tag = "";
    void searchStations();
    persist();
    await loadStates();
    await loadTags();
  });
  radioState.addEventListener("change", () => {
    radio.filters.state = radioState.value;
    radio.filters.tag = "";
    void searchStations();
    persist();
    void loadTags();
  });
  radioTag.addEventListener("change", () => {
    radio.filters.tag = radioTag.value;
    void searchStations();
    persist();
  });
}
