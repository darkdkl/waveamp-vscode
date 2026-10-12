import * as vscode from "vscode";
import { expandPlaylistPaths } from "./cue";
import { normalizeFavorites } from "./favorites";
import { playerHtml } from "./html";
import type { Strings } from "./i18n";
import { readTagsInBatches, trackFor, type StoredTrack } from "./library";
import { writeLog } from "./log";
import { fetchCountries, fetchStates, fetchTags, registerStationClick, resolveStreamUrl, searchStations } from "./radio/api";
import type { MediaServer } from "./server";
import { readPlayerSettings } from "./settings";
import type { PlayerTrack, ToExtension, ToWebview } from "./shared/messages";
import { normalizeSavedTracks } from "./shared/savedTracks";
import type { Station, StationSearchParams } from "./shared/types";

const STATE_KEY = "waveamp.state";
export const SAVED_TRACKS_KEY = "waveamp.savedTracks";
export const FAVORITES_KEY = "waveamp.favorites";

interface StoredState {
  tracks: StoredTrack[];
  currentIndex: number;
  volume: number;
  eq?: unknown;
  ui?: unknown;
  radio?: unknown;
}

export class PlayerView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly listeners = new Set<(message: ToExtension) => void>();
  private ready = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: MediaServer,
    private readonly status: vscode.StatusBarItem,
    private readonly t: Strings
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const { extensionUri } = this.context;
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.joinPath(extensionUri, "dist")],
    };
    view.webview.html = playerHtml(view.webview, extensionUri, this.server.origin, this.t);
    view.webview.onDidReceiveMessage((message: ToExtension) => this.handle(message));
  }

  get isReady(): boolean {
    return this.ready;
  }

  post(message: ToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  onMessage(listener: (message: ToExtension) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  async addPaths(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const entries = await expandPlaylistPaths(paths).catch((err: Error) => {
      writeLog("warn", "cue", `Could not expand paths: ${err.message}`);
      return paths.map((p) => ({ path: p }));
    });
    const tracks = entries.filter((entry) => !/\.cue$/i.test(entry.path)).map((entry) => trackFor(this.server, entry.path, entry));
    if (!tracks.length) return;
    this.post({ type: "add", tracks });
    this.readTags(tracks);
  }

  postSettings(): void {
    this.post({ type: "settings", ...readPlayerSettings(this.server.routes()) });
  }

  private readTags(tracks: PlayerTrack[]): void {
    void readTagsInBatches(tracks, (items) => this.post({ type: "tags", items }));
  }

  private handle(message: ToExtension): void {
    if (message.type === "ready") {
      this.ready = true;
      this.restore();
    }
    if (message.type === "state") this.renderStatus(message);
    if (message.type === "persist") this.persist(message.state);
    if (message.type === "addFiles") void vscode.commands.executeCommand("waveamp.addFiles");
    if (message.type === "addFolder") void vscode.commands.executeCommand("waveamp.addFolder");
    if (message.type === "request") void this.respond(message);
    if (message.type === "saveSavedTracks") {
      void this.context.globalState.update(SAVED_TRACKS_KEY, normalizeSavedTracks(message.tracks));
    }
    if (message.type === "copy" && typeof message.text === "string") void vscode.env.clipboard.writeText(message.text);
    for (const listener of this.listeners) listener(message);
  }

  private async respond(message: Extract<ToExtension, { type: "request" }>): Promise<void> {
    const params = (message.params ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
    try {
      let result: unknown;
      if (message.method === "searchStations") result = await searchStations(params as StationSearchParams);
      else if (message.method === "countries") result = await fetchCountries();
      else if (message.method === "states") result = await fetchStates(text("country"));
      else if (message.method === "tags") result = await fetchTags(text("countryCode"), text("state"));
      else if (message.method === "playStation") result = await this.streamFor(params.station as Station, params.reconnect === true);
      else if (message.method === "resolveStream") result = await resolveStreamUrl(text("url"));
      else if (message.method === "confirm") {
        result = (await vscode.window.showWarningMessage(text("message"), { modal: true }, this.t.yes)) === this.t.yes;
      } else throw new Error(`Unknown request ${String(message.method)}`);
      this.post({ type: "response", id: message.id, result });
    } catch (err) {
      writeLog("warn", "radio", `${String(message.method)} failed: ${(err as Error).message}`);
      this.post({ type: "response", id: message.id, error: (err as Error).message });
    }
  }

  private async streamFor(station: Station, reconnect: boolean): Promise<{ url: string; source: string }> {
    const source = station && typeof station.url === "string" ? await resolveStreamUrl(station.url) : null;
    if (!source) throw new Error("playlist");
    if (!reconnect && station.stationuuid && !station.stationuuid.startsWith("custom-")) void registerStationClick(station.stationuuid);
    return { url: this.server.streamUrl(source), source };
  }

  private persist(state: StoredState): void {
    const radio = state.radio && typeof state.radio === "object" ? (state.radio as Record<string, unknown>) : null;
    if (radio && Array.isArray(radio.favorites)) {
      void this.context.globalState.update(FAVORITES_KEY, normalizeFavorites(radio.favorites));
      state = { ...state, radio: { ...radio, favorites: undefined } };
    }
    void this.context.globalState.update(STATE_KEY, state);
  }

  private restore(): void {
    this.postSettings();
    this.post({ type: "savedTracks", tracks: normalizeSavedTracks(this.context.globalState.get(SAVED_TRACKS_KEY)) });
    const saved = this.context.globalState.get<StoredState>(STATE_KEY);
    const favorites = this.context.globalState.get<unknown>(FAVORITES_KEY);
    if (!saved && !favorites) return;
    const savedRadio = saved?.radio && typeof saved.radio === "object" ? (saved.radio as Record<string, unknown>) : {};
    const radio = { ...savedRadio, favorites: normalizeFavorites(favorites ?? savedRadio.favorites) };
    if (!saved) {
      this.post({ type: "restore", tracks: [], currentIndex: -1, radio });
      return;
    }
    const tracks = (saved.tracks ?? [])
      .filter((track) => typeof track?.path === "string")
      .map((track) => trackFor(this.server, track.path, track));
    this.post({ type: "restore", tracks, currentIndex: saved.currentIndex, volume: saved.volume, eq: saved.eq, ui: saved.ui, radio });
    this.readTags(tracks);
  }

  private renderStatus(message: Extract<ToExtension, { type: "state" }>): void {
    const title = typeof message.title === "string" ? message.title : "";
    if (!title) {
      this.status.hide();
      return;
    }
    this.status.text = `${message.playing ? "$(debug-pause)" : "$(play)"} ${title}`;
    this.status.tooltip = `WaveAMP: ${message.playing ? this.t.pause : this.t.play}`;
    this.status.show();
  }
}
