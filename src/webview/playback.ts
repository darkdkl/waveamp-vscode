import { ensureGraph, measureChannels, renderChannels, resetChannels, STEREO_INTERVAL_MS } from "./audioGraph";
import { persist, post, postState } from "./bridge";
import { refreshCover } from "./cover";
import { $, audio, durationEl, liveEl, playBtn, seek, t, timeEl, titleEl, volume } from "./dom";
import { displayName, formatTime } from "./format";
import { registerMediaKeys } from "./mediaSession";
import { setTitleText } from "./titleScroll";
import { render } from "./playlist";
import { cycleFavorite, leaveRadio, playStation, reconnectStation } from "./radio/stream";
import { currentTrack, player, radio, shownTitle } from "./state";

const SEGMENT_JOIN_TOLERANCE = 0.05;
const SEGMENT_TIMER_WINDOW = 1;

let segmentTimer: ReturnType<typeof setTimeout> | undefined;

const trackStart = () => currentTrack()?.start ?? 0;
const trackLength = () => (currentTrack()?.end ?? audio.duration) - trackStart();
const trackPosition = () => Math.max(0, audio.currentTime - trackStart());

function seekTrack(seconds: number): void {
  const length = trackLength();
  const clamped = isFinite(length) ? Math.min(length, seconds) : seconds;
  audio.currentTime = trackStart() + Math.max(0, clamped);
}

export function renderDuration(): void {
  const length = trackLength();
  durationEl.textContent = formatTime(isFinite(length) ? length : currentTrack()?.duration);
}

export function renderTitle(): void {
  titleEl.classList.toggle("is-hint", player.hint);
  const track = currentTrack();
  if (player.hint) setTitleText(t.clickToPlay);
  else if (player.mode === "radio") setTitleText((shownTitle() || radio.station?.name || "") + radio.status);
  else setTitleText(track ? displayName(track) : t.noTrack);
}

export function renderPlayState(): void {
  const playing = !audio.paused;
  playBtn.classList.toggle("is-current", playing);
  durationEl.classList.toggle("is-idle", !playing);
  liveEl.classList.toggle("is-idle", !playing);
  renderChannels();
  postState();
}

export function play(): void {
  player.playRequested = true;
  ensureGraph();
  audio.play().then(
    () => {
      player.hint = false;
      renderTitle();
    },
    (err: Error) => {
      if (err.name !== "NotAllowedError") return;
      player.hint = true;
      renderTitle();
    }
  );
}

export function load(index: number, autoplay: boolean): void {
  if (index < 0 || index >= player.tracks.length) return;
  if (player.mode === "radio") leaveRadio();
  player.current = index;
  const track = player.tracks[index];
  const src = track.useDecoded && track.decodedUrl ? track.decodedUrl : track.url;
  if (src === player.loadedSrc && track.start != null && audio.readyState > 0 && !audio.error) {
    player.pendingStart = null;
    audio.currentTime = track.start;
  } else {
    player.loadedSrc = src;
    player.pendingStart = track.start ?? null;
    audio.src = src;
  }
  seek.disabled = false;
  renderDuration();
  timeEl.textContent = "00:00";
  void refreshCover();
  if (autoplay) play();
  else player.playRequested = false;
  render();
  postState();
  persist();
}

export function clearSource(): void {
  player.loadedSrc = null;
  player.pendingStart = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  player.current = -1;
  seek.disabled = true;
  seek.value = "0";
  timeEl.textContent = "00:00";
  durationEl.textContent = "00:00";
  player.hint = false;
  resetChannels();
  void refreshCover();
}

export function playPause(): void {
  if (player.mode === "radio") {
    if (!audio.paused) audio.pause();
    else if (!audio.getAttribute("src")) void playStation(radio.station);
    else play();
    return;
  }
  if (player.current < 0) {
    if (player.tracks.length) load(0, true);
    else post({ type: "addFiles" });
    return;
  }
  if (audio.paused) play();
  else audio.pause();
}

export function stop(): void {
  if (player.mode === "radio") {
    clearTimeout(radio.reconnectTimer);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    player.playRequested = false;
    radio.status = "";
    renderTitle();
    renderPlayState();
    return;
  }
  audio.pause();
  player.playRequested = false;
  if (player.current >= 0) audio.currentTime = trackStart();
  renderPlayState();
}

export function next(): void {
  if (player.mode === "radio") return cycleFavorite(1);
  if (player.current + 1 < player.tracks.length) load(player.current + 1, true);
  else stop();
}

export function previous(): void {
  if (player.mode === "radio") return cycleFavorite(-1);
  if (trackPosition() > 3 || player.current <= 0) seekTrack(0);
  else load(player.current - 1, true);
}

function continueIntoNextSegment(): boolean {
  const track = currentTrack();
  const following = player.tracks[player.current + 1];
  if (!track || track.end == null || !following || following.path !== track.path || following.start == null) return false;
  if (Math.abs(following.start - track.end) > SEGMENT_JOIN_TOLERANCE) return false;
  player.current += 1;
  renderDuration();
  render();
  postState();
  persist();
  return true;
}

function checkSegmentEnd(): void {
  clearTimeout(segmentTimer);
  const track = currentTrack();
  if (!track || track.end == null || audio.paused || player.seeking) return;
  const remaining = track.end - audio.currentTime;
  if (remaining <= 0) {
    if (!continueIntoNextSegment()) next();
  } else if (remaining < SEGMENT_TIMER_WINDOW) {
    segmentTimer = setTimeout(checkSegmentEnd, (remaining / (audio.playbackRate || 1)) * 1000);
  }
}

export function stopSegmentTimer(): void {
  clearTimeout(segmentTimer);
}

export function initPlayback(): void {
  playBtn.addEventListener("click", () => (player.mode === "radio" || player.current < 0 ? playPause() : play()));
  $("pauseBtn").addEventListener("click", () => audio.pause());
  $("stopBtn").addEventListener("click", stop);
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", previous);

  volume.addEventListener("input", () => {
    audio.volume = Number(volume.value) / 100;
    persist();
  });

  seek.addEventListener("input", () => {
    player.seeking = true;
    const length = trackLength();
    if (isFinite(length) && length > 0) timeEl.textContent = formatTime((Number(seek.value) / 1000) * length);
  });
  seek.addEventListener("change", () => {
    const length = trackLength();
    if (isFinite(length) && length > 0) seekTrack((Number(seek.value) / 1000) * length);
    player.seeking = false;
  });

  audio.addEventListener("timeupdate", () => {
    if (player.mode === "radio") {
      timeEl.textContent = formatTime(audio.currentTime);
      return;
    }
    checkSegmentEnd();
    if (player.seeking) return;
    timeEl.textContent = formatTime(trackPosition());
    const length = trackLength();
    if (isFinite(length) && length > 0) seek.value = String((trackPosition() / length) * 1000);
  });
  audio.addEventListener("loadedmetadata", () => {
    const track = currentTrack();
    if (!track) return;
    if (player.pendingStart !== null) {
      audio.currentTime = player.pendingStart;
      player.pendingStart = null;
    }
    renderDuration();
    if (track.broken) track.broken = false;
    if (!track.duration && isFinite(trackLength())) {
      track.duration = trackLength();
      render();
    }
  });
  audio.addEventListener("loadstart", resetChannels);
  audio.addEventListener("play", renderPlayState);
  audio.addEventListener("pause", renderPlayState);
  audio.addEventListener("ended", () => (player.mode === "radio" ? reconnectStation() : next()));
  audio.addEventListener("playing", () => {
    registerMediaKeys();
    if (player.mode !== "radio") return;
    radio.reconnects = 0;
    if (radio.status) {
      radio.status = "";
      renderTitle();
    }
  });
  audio.addEventListener("error", () => {
    if (player.mode === "radio") {
      if (player.playRequested && audio.getAttribute("src")) reconnectStation();
      return;
    }
    const track = player.tracks[player.current];
    if (!track || !audio.error || audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;
    if (track.decodedUrl && !track.useDecoded) {
      for (const other of player.tracks) if (other.path === track.path) other.useDecoded = true;
      load(player.current, player.playRequested);
      return;
    }
    track.broken = true;
    render();
    if (player.playRequested && player.current + 1 < player.tracks.length) load(player.current + 1, true);
  });

  document.addEventListener("pointerdown", () => {
    ensureGraph();
    if (player.hint) {
      player.hint = false;
      renderTitle();
    }
  });
  setInterval(measureChannels, STEREO_INTERVAL_MS);
  audio.volume = Number(volume.value) / 100;
}
