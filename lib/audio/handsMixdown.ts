"use client";

import { audioBufferToWavBlob } from "@/lib/audio/wav";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export type HandsTelemetrySample = {
  trackTimeSec: number;
  tempoRate?: number;
  volumeGain?: number;
  delayMix01?: number;
  delayTimeSec?: number;
  delayFeedback?: number;
  reverbMix01?: number;
};

function createImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const channel = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      channel[i] = (Math.random() * 2 - 1) * env;
    }
  }

  return impulse;
}

function scheduleParam(param: AudioParam, points: Array<{ t: number; v: number }>, rampSec = 0.12) {
  if (points.length === 0) return;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  param.setValueAtTime(first.v, Math.max(0, first.t));
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i]!;
    const t = Math.max(0, p.t);
    const prevT = Math.max(0, sorted[i - 1]!.t);
    const rampTo = t - Math.min(rampSec, Math.max(0.01, t - prevT) * 0.5);
    param.setValueAtTime(param.value, Math.max(0, rampTo));
    param.linearRampToValueAtTime(p.v, t);
  }
}

export async function renderHandsMixdownWav(params: {
  sourceUrl: string;
  samples: HandsTelemetrySample[];
  // Extra tail for echo/reverb to ring out.
  tailSec?: number;
}): Promise<{ wav: Blob; durationSec: number }> {
  const tailSec = params.tailSec ?? 1.25;
  const samples = (params.samples ?? []).filter((s) => Number.isFinite(s.trackTimeSec));
  if (samples.length === 0) {
    throw new Error("No hands telemetry captured for mixing.");
  }

  const res = await fetch(params.sourceUrl);
  if (!res.ok) throw new Error(`Failed to fetch source audio for mixing (${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("Web Audio is not supported in this browser.");
  const decodeCtx = new AudioCtx();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close().catch(() => {});

  // Keep the output duration aligned with the original track length.
  // We do not bake playbackRate (time-stretch) into the offline render.
  const durationSec = decoded.duration + tailSec;
  const sampleRate = decoded.sampleRate;
  const length = Math.max(1, Math.ceil(durationSec * sampleRate));

  const offline = new OfflineAudioContext(decoded.numberOfChannels, length, sampleRate);

  const source = offline.createBufferSource();
  source.buffer = decoded;

  const dryGain = offline.createGain();
  dryGain.gain.value = 1;

  const delay = offline.createDelay(1.5);
  delay.delayTime.value = 0.12;
  const delayWet = offline.createGain();
  delayWet.gain.value = 0;
  const delayFeedback = offline.createGain();
  delayFeedback.gain.value = 0.2;
  const delayFeedbackHp = offline.createBiquadFilter();
  delayFeedbackHp.type = "highpass";
  delayFeedbackHp.frequency.value = 240;
  delayFeedbackHp.Q.value = 0.7;
  const delayFeedbackLp = offline.createBiquadFilter();
  delayFeedbackLp.type = "lowpass";
  delayFeedbackLp.frequency.value = 8200;
  delayFeedbackLp.Q.value = 0.7;

  delay.connect(delayFeedback);
  delayFeedback.connect(delayFeedbackHp);
  delayFeedbackHp.connect(delayFeedbackLp);
  delayFeedbackLp.connect(delay);

  const reverb = offline.createConvolver();
  reverb.buffer = createImpulseResponse(offline, 3.6, 2.1);
  const reverbWet = offline.createGain();
  reverbWet.gain.value = 0;

  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  const masterGain = offline.createGain();
  masterGain.gain.value = 1;

  // Routing
  source.connect(dryGain);
  dryGain.connect(masterGain);

  source.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(masterGain);

  source.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(masterGain);

  masterGain.connect(compressor);
  compressor.connect(offline.destination);

  // Automation from samples
  const points = [...samples].sort((a, b) => a.trackTimeSec - b.trackTimeSec);
  const lastT = Math.max(0, points[points.length - 1]!.trackTimeSec);
  const neutralAt = clamp(lastT + 0.05, 0, Math.max(0, decoded.duration));

  // Volume
  scheduleParam(
    masterGain.gain,
    [
      { t: 0, v: 1 },
      ...points.map((p) => ({
        t: clamp(p.trackTimeSec, 0, decoded.duration),
        v: clamp(typeof p.volumeGain === "number" ? p.volumeGain : 1, 0, 1.8)
      })),
      { t: neutralAt, v: 1 }
    ],
    0.12
  );

  // Echo/Delay wet
  scheduleParam(
    delayWet.gain,
    [
      { t: 0, v: 0 },
      ...points.map((p) => ({
        t: clamp(p.trackTimeSec, 0, decoded.duration),
        v: clamp01(typeof p.delayMix01 === "number" ? p.delayMix01 : 0)
      })),
      { t: neutralAt, v: 0 }
    ],
    0.12
  );

  // Echo/Delay feedback
  scheduleParam(
    delayFeedback.gain,
    [
      { t: 0, v: 0.2 },
      ...points.map((p) => ({
        t: clamp(p.trackTimeSec, 0, decoded.duration),
        v: clamp(typeof p.delayFeedback === "number" ? p.delayFeedback : 0.2, 0, 0.92)
      })),
      { t: neutralAt, v: 0.2 }
    ],
    0.18
  );

  // Echo/Delay time
  scheduleParam(
    delay.delayTime,
    [
      { t: 0, v: 0.12 },
      ...points.map((p) => ({
        t: clamp(p.trackTimeSec, 0, decoded.duration),
        v: clamp(typeof p.delayTimeSec === "number" ? p.delayTimeSec : 0.12, 0.01, 1.2)
      })),
      { t: neutralAt, v: 0.12 }
    ],
    0.18
  );

  // Reverb wet
  scheduleParam(
    reverbWet.gain,
    [
      { t: 0, v: 0 },
      ...points.map((p) => ({
        t: clamp(p.trackTimeSec, 0, decoded.duration),
        v: clamp01(typeof p.reverbMix01 === "number" ? p.reverbMix01 : 0) * 0.98
      })),
      { t: neutralAt, v: 0 }
    ],
    0.18
  );

  // Dry crossfade: ramp back to full dry after the last captured gesture.
  scheduleParam(
    dryGain.gain,
    [
      { t: 0, v: 1 },
      ...points.map((p) => {
        const d = clamp01(typeof p.delayMix01 === "number" ? p.delayMix01 : 0);
        const r = clamp01(typeof p.reverbMix01 === "number" ? p.reverbMix01 : 0);
        const dry = clamp(1 - Math.min(0.92, d * 0.65 + r * 0.75), 0.06, 1);
        return { t: clamp(p.trackTimeSec, 0, decoded.duration), v: dry };
      }),
      { t: neutralAt, v: 1 }
    ],
    0.12
  );

  source.start(0);

  const rendered = await offline.startRendering();
  const wav = audioBufferToWavBlob(rendered);
  return { wav, durationSec };
}
