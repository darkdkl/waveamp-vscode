import { audio, channelsEl } from "./dom";
import { BANDS, dbToGain } from "./eqPresets";
import { eq, player, settings } from "./state";
import { classifyChannels, pseudoStereoAmount, stereoWidth, type ChannelLayout } from "../shared/stereo";

const ENERGY_SMOOTHING = 0.2;
const STEREO_BASS_HZ = 150;
const PSEUDO_DELAY_S = 0.012;
const PSEUDO_LOW_HZ = 300;
const PSEUDO_HIGH_HZ = 7000;
const STEREO_RAMP_S = 0.05;

export const STEREO_INTERVAL_MS = 150;

interface Graph {
  ctx: AudioContext;
  meters: AnalyserNode[];
  filters: BiquadFilterNode[];
  preamp: GainNode;
  sideExtra: GainNode;
  pseudoSide: GainNode;
  merger: ChannelMergerNode;
  buffers: Float32Array<ArrayBuffer>[];
  side: number;
  mid: number;
  layout: ChannelLayout | null;
}

let graph: Graph | null = null;

export function ensureGraph(): Graph {
  if (!graph) {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const gainNode = (value: number) => {
      const node = ctx.createGain();
      node.gain.value = value;
      return node;
    };
    const filterNode = (type: BiquadFilterType, frequency: number) => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      return node;
    };
    const meterInput = gainNode(1);
    meterInput.channelCount = 2;
    meterInput.channelCountMode = "explicit";
    meterInput.channelInterpretation = "speakers";
    const splitter = ctx.createChannelSplitter(2);
    const meters = [ctx.createAnalyser(), ctx.createAnalyser()];
    const filters = BANDS.map((freq) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    const preamp = ctx.createGain();
    source.connect(meterInput).connect(splitter);
    meters.forEach((meter, i) => splitter.connect(meter, i));
    let node: AudioNode = source;
    for (const filter of filters) node = node.connect(filter);
    const stereoInput = gainNode(1);
    stereoInput.channelCount = 2;
    stereoInput.channelCountMode = "explicit";
    stereoInput.channelInterpretation = "speakers";
    const stereoSplitter = ctx.createChannelSplitter(2);
    const leftHalf = gainNode(0.5);
    const rightHalf = gainNode(0.5);
    const rightHalfInverted = gainNode(-1);
    const mid = gainNode(1);
    const side = gainNode(1);
    const sideHighPass = filterNode("highpass", STEREO_BASS_HZ);
    const sideExtra = gainNode(0);
    const pseudoDelay = ctx.createDelay(0.05);
    pseudoDelay.delayTime.value = PSEUDO_DELAY_S;
    const pseudoHighPass = filterNode("highpass", PSEUDO_LOW_HZ);
    const pseudoLowPass = filterNode("lowpass", PSEUDO_HIGH_HZ);
    const pseudoSide = gainNode(0);
    const sideTotal = gainNode(1);
    const sideTotalInverted = gainNode(-1);
    const outLeft = gainNode(1);
    const outRight = gainNode(1);
    const merger = ctx.createChannelMerger(2);
    stereoInput.connect(stereoSplitter);
    stereoSplitter.connect(leftHalf, 0);
    stereoSplitter.connect(rightHalf, 1);
    leftHalf.connect(mid);
    rightHalf.connect(mid);
    leftHalf.connect(side);
    rightHalf.connect(rightHalfInverted).connect(side);
    side.connect(sideTotal);
    side.connect(sideHighPass).connect(sideExtra).connect(sideTotal);
    mid.connect(pseudoDelay).connect(pseudoHighPass).connect(pseudoLowPass).connect(pseudoSide).connect(sideTotal);
    mid.connect(outLeft);
    sideTotal.connect(outLeft);
    mid.connect(outRight);
    sideTotal.connect(sideTotalInverted).connect(outRight);
    outLeft.connect(merger, 0, 0);
    outRight.connect(merger, 0, 1);
    node.connect(preamp).connect(stereoInput);
    merger.connect(ctx.destination);
    graph = {
      ctx,
      meters,
      filters,
      preamp,
      sideExtra,
      pseudoSide,
      merger,
      buffers: meters.map((m) => new Float32Array(m.fftSize)),
      side: 0,
      mid: 0,
      layout: null,
    };
    applyEq();
    applyStereo();
  }
  if (graph.ctx.state !== "running") graph.ctx.resume().catch(() => {});
  return graph;
}

export function applyEq(): void {
  if (!graph) return;
  graph.filters.forEach((filter, i) => {
    filter.gain.value = eq.enabled ? eq.bandGains[i] : 0;
  });
  graph.preamp.gain.value = eq.enabled ? dbToGain(eq.preampDb) : 1;
}

export function applyStereo(): void {
  if (!graph) return;
  const { tracks, radio: radioOn, strength, pseudo } = settings.stereo;
  const active = player.mode === "radio" ? radioOn : tracks;
  const extraSide = active ? stereoWidth(strength) - 1 : 0;
  const pseudoAmount = active && pseudo && graph.layout === "mono" ? pseudoStereoAmount(strength) : 0;
  graph.sideExtra.gain.setTargetAtTime(extraSide, graph.ctx.currentTime, STEREO_RAMP_S);
  graph.pseudoSide.gain.setTargetAtTime(pseudoAmount, graph.ctx.currentTime, STEREO_RAMP_S);
}

export function resetChannels(): void {
  if (graph) {
    graph.side = 0;
    graph.mid = 0;
    graph.layout = null;
  }
  renderChannels();
  applyStereo();
}

export function measureChannels(): void {
  if (!graph || audio.paused) return;
  const [left, right] = graph.buffers;
  graph.meters[0].getFloatTimeDomainData(left);
  graph.meters[1].getFloatTimeDomainData(right);
  let side = 0;
  let mid = 0;
  for (let i = 0; i < left.length; i++) {
    const d = left[i] - right[i];
    const s = left[i] + right[i];
    side += d * d;
    mid += s * s;
  }
  graph.side += (side / left.length - graph.side) * ENERGY_SMOOTHING;
  graph.mid += (mid / left.length - graph.mid) * ENERGY_SMOOTHING;
  const next = classifyChannels(graph.layout, graph.side, graph.mid);
  if (next === graph.layout) return;
  graph.layout = next;
  renderChannels();
  applyStereo();
}

export function renderChannels(): void {
  const layout = graph?.layout ?? null;
  channelsEl.hidden = !layout;
  channelsEl.textContent = layout === "mono" ? "MONO" : "STEREO";
  channelsEl.classList.toggle("is-idle", layout === "mono" || audio.paused);
}
