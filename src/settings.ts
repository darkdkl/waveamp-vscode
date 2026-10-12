import * as vscode from "vscode";
import { setProxySettings, type ProxyMode } from "./proxy";
import type { PlayerSettings } from "./shared/messages";
import { normalizeStereoStrength } from "./shared/stereo";
import { normalizeTitleScrollMode, normalizeTitleScrollSpeed } from "./shared/titleScroll";

const ACCENTS: Record<string, PlayerSettings["accent"]> = {
  classic: { hue: 134, saturation: 96 },
  amber: { hue: 38, saturation: 95 },
  ice: { hue: 195, saturation: 90 },
  violet: { hue: 270, saturation: 80 },
  ruby: { hue: 352, saturation: 85 },
  mono: { hue: 0, saturation: 0 },
};

export function readPlayerSettings(routes: PlayerSettings["routes"]): PlayerSettings {
  const config = vscode.workspace.getConfiguration("waveamp");
  const body = config.get<string>("body", "auto");
  return {
    accent: ACCENTS[config.get<string>("accentColor", "classic")] ?? ACCENTS.classic,
    body: body === "dark" || body === "light" ? body : "auto",
    showTrackTitles: config.get<boolean>("radio.showTrackTitles", true),
    coverArt: config.get<boolean>("coverArt", true),
    titleScroll: normalizeTitleScrollMode(config.get("display.longTitlesScrolling")),
    titleScrollSpeed: normalizeTitleScrollSpeed(config.get("display.scrollingSpeed")),
    routes,
    stereo: {
      tracks: config.get<boolean>("stereo.tracks", false),
      radio: config.get<boolean>("stereo.radio", false),
      strength: normalizeStereoStrength(config.get("stereo.strength")),
      pseudo: config.get<boolean>("stereo.pseudoStereo", true),
    },
  };
}

export function applyProxySettings(): void {
  const config = vscode.workspace.getConfiguration("waveamp.proxy");
  const mode = config.get<string>("mode", "vscode");
  setProxySettings({
    mode: mode === "direct" || mode === "custom" ? (mode as ProxyMode) : "vscode",
    type: config.get<string>("type", "http") === "socks5" ? "socks5" : "http",
    host: config.get<string>("host", "").trim(),
    port: Math.round(Number(config.get("port", 0))) || 0,
  });
}
