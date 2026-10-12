import type { SavedTrack, Station } from "../shared/types";
import type { EqState, FavoriteStation, PlayerSettings, PlayerTrack, RadioFilters, RadioView } from "../shared/messages";
import { BANDS } from "./eqPresets";
import { TITLE_SCROLL_DEFAULT, TITLE_SCROLL_SPEED_DEFAULT } from "../shared/titleScroll";

export interface Track extends PlayerTrack {
  useDecoded?: boolean;
  broken?: boolean;
}

export interface Row {
  name: HTMLElement;
  duration: HTMLElement;
}

export const player = {
  tracks: [] as Track[],
  rows: [] as Row[],
  current: -1,
  mode: "local" as "local" | "radio",
  seeking: false,
  playRequested: false,
  hint: false,
  loadedSrc: null as string | null,
  pendingStart: null as number | null,
  savedTracks: [] as SavedTrack[],
};

export const radio = {
  station: null as FavoriteStation | null,
  source: null as string | null,
  title: null as string | null,
  status: "",
  reconnects: 0,
  reconnectTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  favorites: [] as FavoriteStation[],
  view: "search" as RadioView,
  results: [] as Station[],
  filters: { query: "", country: "", countryName: "", state: "", tag: "" } as RadioFilters,
  countriesLoaded: false,
  searchToken: 0,
  formOpen: false,
  formBusy: false,
  editingId: null as string | null,
};

export const settings: Omit<PlayerSettings, "accent" | "body" | "routes"> & { routes: PlayerSettings["routes"] | null } = {
  coverArt: true,
  titleScroll: TITLE_SCROLL_DEFAULT,
  titleScrollSpeed: TITLE_SCROLL_SPEED_DEFAULT,
  routes: null,
  showTrackTitles: true,
  stereo: { tracks: false, radio: false, strength: 50, pseudo: true },
};

export const eq: EqState = {
  enabled: true,
  preset: "flat",
  bandGains: BANDS.map(() => 0),
  preampDb: 0,
  custom: { bandGains: BANDS.map(() => 0), preampDb: 0 },
};

export const shownTitle = () => (settings.showTrackTitles ? radio.title : null);

export const currentTrack = (): Track | undefined => (player.mode === "local" ? player.tracks[player.current] : undefined);

export function stationTitle(): string {
  if (!radio.station) return "";
  const title = shownTitle();
  return title ? `${radio.station.name} — ${title}` : radio.station.name;
}
