export interface TrackTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
}

export interface PlaylistEntry {
  path: string;
  start?: number;
  end?: number | null;
  tags?: TrackTags;
}

export interface Station {
  stationuuid: string;
  name: string;
  url: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  bitrate: number;
  codec: string;
}

export interface CountedOption {
  name: string;
  count: number;
}

export interface CountryOption extends CountedOption {
  code: string;
}

export interface StationSearchParams {
  name?: string;
  country?: string;
  state?: string;
  tag?: string;
  limit?: number;
}

export interface SavedTrack {
  title: string;
  station: string;
  savedAt: number;
}
