import { HLS_NOT_SUPPORTED } from "../../shared/messages";
import type { FavoriteStation, RadioView } from "../../shared/messages";
import { isHttpUrl } from "../../shared/streamUrl";
import { persist, postState, request } from "../bridge";
import { $, radioAddBtn, radioPanel, stationError, stationForm, stationFormTitle, stationName, stationSubmit, stationUrl, t } from "../dom";
import { renderTitle } from "../playback";
import { player, radio } from "../state";
import { renderStations, openRadio } from "./panel";
import { playStation } from "./stream";

function setStationBusy(busy: boolean): void {
  radio.formBusy = busy;
  stationSubmit.disabled = busy;
  stationName.disabled = busy;
  stationUrl.disabled = busy;
  stationSubmit.textContent = busy ? t.checking : radio.editingId ? t.save : t.add;
}

export function openStationForm(station: FavoriteStation | null = null): void {
  if (radioPanel.hidden) openRadio(true);
  radio.formOpen = true;
  radio.editingId = station ? station.stationuuid : null;
  stationFormTitle.textContent = station ? t.editStation : t.newStation;
  stationName.value = station ? station.name : "";
  stationUrl.value = station ? station.sourceUrl || station.url : "";
  stationError.textContent = "";
  setStationBusy(false);
  renderStations();
  stationName.focus();
}

export function closeStationForm(view?: RadioView): void {
  radio.formOpen = false;
  radio.editingId = null;
  stationError.textContent = "";
  if (view) radio.view = view;
  renderStations();
  persist();
}

async function submitStationForm(): Promise<void> {
  if (radio.formBusy) return;
  const name = stationName.value.trim();
  const sourceUrl = stationUrl.value.trim();
  const fail = (message: string, field: HTMLInputElement) => {
    stationError.textContent = message;
    field.focus();
  };
  if (!name) return fail(t.stationNameRequired, stationName);
  if (!isHttpUrl(sourceUrl)) return fail(t.stationUrlInvalid, stationUrl);
  const duplicate = radio.favorites.some((s) => s.stationuuid !== radio.editingId && (s.url === sourceUrl || s.sourceUrl === sourceUrl));
  if (duplicate) return fail(t.stationUrlDuplicate, stationUrl);
  stationError.textContent = "";
  setStationBusy(true);
  let hls = false;
  const url = await request("resolveStream", { url: sourceUrl }).catch((err: Error) => {
    hls = err.message === HLS_NOT_SUPPORTED;
    return null;
  });
  setStationBusy(false);
  if (!radio.formOpen) return;
  if (!url) return fail(hls ? t.hlsNotSupported : t.stationPlaylistFailed, stationUrl);
  const existing = radio.favorites.find((s) => s.stationuuid === radio.editingId);
  if (existing) {
    const urlChanged = existing.url !== url;
    Object.assign(existing, { name, url, sourceUrl });
    closeStationForm("favorites");
    if (player.mode === "radio" && radio.station?.stationuuid === existing.stationuuid) {
      if (urlChanged) void playStation(existing);
      else {
        renderTitle();
        postState();
      }
    }
    return;
  }
  const station: FavoriteStation = {
    stationuuid: "custom-" + crypto.randomUUID(),
    name,
    url,
    sourceUrl,
    favicon: "",
    tags: "",
    country: "",
    countrycode: "",
    state: "",
    bitrate: 0,
    codec: "",
    custom: true,
  };
  radio.favorites.push(station);
  closeStationForm("favorites");
  void playStation(station);
}

export function initStationForm(): void {
  radioAddBtn.addEventListener("click", () => (radio.formOpen && !radio.editingId ? closeStationForm() : openStationForm()));
  $("stationCancel").addEventListener("click", () => closeStationForm());
  stationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitStationForm();
  });
  stationForm.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeStationForm();
  });
}
