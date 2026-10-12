import { displayEl } from "./dom";
import { isHttpUrl } from "../shared/streamUrl";
import { currentTrack, player, radio, settings } from "./state";

let coverToken = 0;

function imageLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export function artworkSource(): string | null {
  if (!settings.routes) return null;
  if (player.mode === "radio") {
    const favicon = radio.station?.favicon;
    return favicon && isHttpUrl(favicon) ? settings.routes.image + encodeURIComponent(favicon) : null;
  }
  const track = currentTrack();
  return track?.path ? settings.routes.cover + encodeURIComponent(track.path) : null;
}

function coverSource(): string | null {
  return settings.coverArt ? artworkSource() : null;
}

export async function refreshCover(): Promise<void> {
  const token = ++coverToken;
  const source = coverSource();
  const ok = source ? await imageLoads(source) : false;
  if (token !== coverToken) return;
  displayEl.classList.toggle("has-cover", ok);
  if (ok) displayEl.style.setProperty("--cover-art", `url("${source}")`);
}
