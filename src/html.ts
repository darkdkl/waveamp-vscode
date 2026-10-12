import * as vscode from "vscode";
import crypto from "node:crypto";
import type { Strings } from "./i18n";

const SESSION = Date.now().toString(36);

const ICONS = {
  prev: "M6 4h2v16H6V4zm3.5 8L20 4v16L9.5 12z",
  play: "M7 4l14 8-14 8V4z",
  pause: "M6 4h4v16H6V4zm8 0h4v16h-4V4z",
  stop: "M5 5h14v14H5V5z",
  next: "M16 4h2v16h-2V4zM4.5 4L15 12 4.5 20V4z",
  volume: "M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z",
  playlist: "M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z",
  radio:
    "M12 10.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zm0-3.6a5.4 5.4 0 00-3.8 9.2l1.3-1.3a3.6 3.6 0 115 0l1.3 1.3A5.4 5.4 0 0012 6.6zm0-3.6a9 9 0 00-6.4 15.4l1.3-1.3a7.2 7.2 0 1110.2 0l1.3 1.3A9 9 0 0012 3z",
  equalizer: "M5 20V10h2v10H5zm0-12V4h2v4H5zm6 12V13h2v7h-2zm0-9V4h2v6h-2zm6 9v-4h2v4h-2zm0-6V4h2v9h-2z",
  file: "M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1.5V8h4.5L14 3.5z",
  folder: "M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H4V6zm0 3h18l-1.6 8.2A2 2 0 0118.4 19H5.6a2 2 0 01-2-1.8L4 9z",
  clear: "M7 4V2h10v2h5v2h-2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6H2V4h5zm2 4v10h2V8H9zm4 0v10h2V8h-2z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  bookmark: "M6 2.5h12v19l-6-4.8-6 4.8z",
  search: "M10 4a6 6 0 104.47 10.03l4.75 4.74 1.42-1.41-4.75-4.75A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z",
  copy: "M8 3h11a2 2 0 012 2v11h-2V5H8V3zM5 7h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2zm0 2v10h10V9H5z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z",
};

const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function playerHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mediaOrigin: string, t: Strings): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const asset = (folder: string, file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, folder, file)).with({ query: `v=${SESSION}` });
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `media-src ${mediaOrigin}`,
    `img-src ${mediaOrigin}`,
  ].join("; ");
  const button = (id: string, name: keyof typeof ICONS, title: string, extra = "") =>
    `<button class="btn btn--icon" id="${id}" type="button" title="${escape(title)}" aria-label="${escape(title)}"${extra}>${icon(name)}</button>`;
  const small = (id: string, name: keyof typeof ICONS, title: string, extra = "") =>
    `<button class="icon-btn${extra}" id="${id}" type="button" title="${escape(title)}" aria-label="${escape(title)}">${icon(name)}</button>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset("media", "player.css")}">
</head>
<body>
<div class="player">
<div class="display">
  <div class="display__time" id="time">00:00</div>
  <div class="display__meta">
    <div class="display__track" id="title">${escape(t.noTrack)}</div>
    <div class="display__scale">
      <span class="display__channels" id="channels" hidden>STEREO</span>
      <button class="display__save" id="saveTrackBtn" type="button" hidden>${icon("bookmark")}</button>
      <span class="display__live" id="live" hidden>LIVE</span>
      <span class="display__duration" id="duration">00:00</span>
    </div>
  </div>
</div>
<input class="seek" id="seek" type="range" min="0" max="1000" value="0" disabled>
<div class="transport">
  ${button("prevBtn", "prev", t.prevTrack)}
  ${button("playBtn", "play", t.play)}
  ${button("pauseBtn", "pause", t.pause)}
  ${button("stopBtn", "stop", t.stop)}
  ${button("nextBtn", "next", t.nextTrack)}
</div>
<div class="toolbar">
  <label class="volume" title="${escape(t.volume)}">
    ${icon("volume")}
    <input id="volume" type="range" min="0" max="100" value="80" aria-label="${escape(t.volume)}">
  </label>
  <div class="toggles">
    ${button("playlistToggle", "playlist", t.playlist, ' aria-pressed="true"')}
    ${button("radioToggle", "radio", t.radio, ' aria-pressed="false"')}
    ${button("eqToggle", "equalizer", t.equalizer, ' aria-pressed="false"')}
  </div>
</div>
<section class="eq" id="eq" hidden>
  <div class="eq__header">
    <span id="eqTitle">${escape(t.equalizer)}</span>
    <span class="eq__actions">
      <select class="eq__preset" id="eqPreset" title="${escape(t.eqPreset)}" aria-label="${escape(t.eqPreset)}"></select>
      <button class="switch is-active" id="eqToggleBtn" type="button" role="switch" aria-checked="true" aria-labelledby="eqTitle"></button>
      <button class="text-btn eq__reset" id="eqResetBtn" type="button">${escape(t.reset)}</button>
    </span>
  </div>
  <div class="eq__bands">
    <div class="eq__preamp" id="eqPreamp"></div>
    <div class="eq__divider"></div>
    <div class="eq__band-group" id="eqBands"></div>
  </div>
</section>
<section class="radio" id="radio" hidden>
  <div class="radio__header">
    <span>${escape(t.radio)}</span>
    <span class="playlist__actions radio__tabs">
      <button class="icon-btn" id="radioSearchTab" type="button" title="${escape(t.search)}" aria-label="${escape(t.search)}" aria-pressed="true">${icon("search")}</button>
      ${small("radioAddBtn", "plus", t.addStation)}
      <button class="icon-btn" id="radioFavoritesTab" type="button" title="${escape(t.favorites)}" aria-label="${escape(t.favorites)}" aria-pressed="false">${icon("star")}</button>
      <button class="icon-btn radio__saved-tab" id="radioSavedTab" type="button" title="${escape(t.savedTracks)}" aria-label="${escape(t.savedTracks)}" aria-pressed="false">${icon("bookmark")}<span class="radio__count" id="savedCount" hidden></span></button>
    </span>
  </div>
  <form class="radio__search" id="radioSearchForm">
    <input class="radio__input" id="radioQuery" type="search" placeholder="${escape(t.searchStationPlaceholder)}" aria-label="${escape(t.searchStationPlaceholder)}">
    <div class="radio__filters">
      <select class="radio__select" id="radioCountry" aria-label="${escape(t.countryAny)}"><option value="">${escape(t.countryAny)}</option></select>
      <select class="radio__select" id="radioState" aria-label="${escape(t.stateAny)}" disabled><option value="">${escape(t.stateAny)}</option></select>
      <select class="radio__select" id="radioTag" aria-label="${escape(t.tagAny)}"><option value="">${escape(t.tagAny)}</option></select>
    </div>
  </form>
  <form class="station-form" id="stationForm" hidden novalidate>
    <div class="station-form__title" id="stationFormTitle">${escape(t.newStation)}</div>
    <input class="radio__input" id="stationName" type="text" placeholder="${escape(t.stationName)}" aria-label="${escape(t.stationName)}">
    <input class="radio__input" id="stationUrl" type="url" placeholder="${escape(t.streamUrl)}" aria-label="${escape(t.streamUrl)}">
    <p class="station-form__error" id="stationError" role="alert"></p>
    <div class="station-form__actions">
      <button class="text-btn" id="stationCancel" type="button">${escape(t.cancel)}</button>
      <button class="text-btn text-btn--primary" id="stationSubmit" type="submit">${escape(t.add)}</button>
    </div>
  </form>
  <div class="saved__actions playlist__actions" id="savedActions" hidden>
    ${small("savedCopyAll", "copy", t.copyAll)}
    ${small("savedClear", "clear", t.clearList, " icon-btn--danger")}
  </div>
  <ol class="radio__list" id="radioList"></ol>
  <p class="radio__message" id="radioMessage">${escape(t.enterNameOrFilter)}</p>
</section>
<section class="playlist" id="playlist">
  <div class="playlist__header">
    <span>${escape(t.playlist)}</span>
    <span class="playlist__actions">
      ${small("addFilesBtn", "file", t.addFiles)}
      ${small("addFolderBtn", "folder", t.addFolder)}
      ${small("clearBtn", "clear", t.clearPlaylist, " icon-btn--danger")}
    </span>
  </div>
  <ol class="playlist__list" id="list"></ol>
  <p class="playlist__empty" id="empty">${escape(t.playlistEmpty)}</p>
</section>
</div>
<audio id="audio" preload="auto" crossorigin="anonymous"></audio>
<script type="application/json" id="strings">${JSON.stringify(t).replace(/</g, "\\u003c")}</script>
<script nonce="${nonce}" src="${asset("dist", "webview.js")}"></script>
</body>
</html>`;
}
