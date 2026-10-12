import type { TitleScrollMode } from "./titleScroll";
import type { CountedOption, CountryOption, SavedTrack, Station, StationSearchParams, TrackTags } from "./types";

export type FavoriteStation = Station & { custom?: true; sourceUrl?: string };

export interface PlayerTrack {
  path: string;
  name: string;
  url: string;
  decodedUrl: string | null;
  start?: number;
  end?: number | null;
  tags?: TrackTags;
  duration?: number | null;
}

export interface PersistedTrack {
  path: string;
  name: string;
  start?: number;
  end?: number | null;
  tags?: TrackTags;
}

export interface EqState {
  enabled: boolean;
  preset: string;
  bandGains: number[];
  preampDb: number;
  custom: { bandGains: number[]; preampDb: number };
}

export type RadioView = "search" | "favorites" | "saved";

export interface RadioFilters {
  query: string;
  country: string;
  countryName: string;
  state: string;
  tag: string;
}

export interface PersistedState {
  tracks: PersistedTrack[];
  currentIndex: number;
  volume: number;
  eq: EqState;
  ui: { playlistOpen: boolean; eqOpen: boolean; radioOpen: boolean };
  radio: { favorites?: FavoriteStation[]; view: RadioView; filters: RadioFilters };
}

export interface StereoSettings {
  tracks: boolean;
  radio: boolean;
  strength: number;
  pseudo: boolean;
}

export interface PlayerSettings {
  accent: { hue: number; saturation: number };
  body: "auto" | "dark" | "light";
  showTrackTitles: boolean;
  coverArt: boolean;
  titleScroll: TitleScrollMode;
  titleScrollSpeed: number;
  routes: { cover: string; image: string };
  stereo: StereoSettings;
}

export type PlayerCommand = "playPause" | "stop" | "next" | "previous" | "addStation" | "saveTrack";

export interface Requests {
  searchStations: { params: StationSearchParams; result: Station[] };
  countries: { params: Record<string, never>; result: CountryOption[] };
  states: { params: { country: string }; result: CountedOption[] };
  tags: { params: { countryCode: string; state: string }; result: CountedOption[] };
  playStation: { params: { station: Station; reconnect: boolean }; result: { url: string; source: string } };
  resolveStream: { params: { url: string }; result: string | null };
  confirm: { params: { message: string }; result: boolean };
}

export type RequestMethod = keyof Requests;

export type ToWebview =
  | { type: "add"; tracks: PlayerTrack[] }
  | { type: "tags"; items: { path: string; tags: TrackTags }[] }
  | { type: "response"; id: number; result?: unknown; error?: string }
  | { type: "nowPlaying"; source: string; title: string | null }
  | ({ type: "settings" } & PlayerSettings)
  | { type: "savedTracks"; tracks: SavedTrack[] }
  | { type: "restore"; tracks: PlayerTrack[]; currentIndex: number; volume?: number; eq?: unknown; ui?: unknown; radio?: unknown }
  | { type: "command"; name: PlayerCommand };

export type ToExtension =
  | { type: "ready" }
  | { type: "state"; playing: boolean; title: string }
  | { type: "persist"; state: PersistedState }
  | { type: "addFiles" }
  | { type: "addFolder" }
  | { type: "request"; id: number; method: RequestMethod; params: unknown }
  | { type: "saveSavedTracks"; tracks: SavedTrack[] }
  | { type: "copy"; text: string };

export const HLS_NOT_SUPPORTED = "hls";
export const CATALOG_UNAVAILABLE = "catalog-unavailable";
