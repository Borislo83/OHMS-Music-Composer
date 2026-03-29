"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult
} from "@mediapipe/tasks-vision";
import { getTasksVisionWasmBaseUrl } from "@/lib/mediapipe";
import { Badge } from "@/components/ui/badge";
import { Disc3 } from "lucide-react";
import type { ReactNode } from "react";

const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const TELEMETRY_INTERVAL_MS = 1000;
const MIXDOWN_INTERVAL_MS = 250;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

function pinch01(dist: number) {
  const minD = 0.03;
  const maxD = 0.12;
  const open01 = clamp01((dist - minD) / (maxD - minD));
  return 1 - open01;
}

function computeRmsLevel(timeDomain: Uint8Array) {
  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = (timeDomain[i] - 128) / 128;
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / timeDomain.length);
  return clamp01(rms);
}

function normalizePitchHzTo01(freqHz: number) {
  const minHz = 55;
  const maxHz = 2000;
  const hz = Math.max(minHz, Math.min(maxHz, freqHz));
  const minL = Math.log2(minHz);
  const maxL = Math.log2(maxHz);
  return clamp01((Math.log2(hz) - minL) / (maxL - minL));
}

function estimateDominantFrequencyHz(freqData: Uint8Array, sampleRate: number, fftSize: number) {
  const minHz = 55;
  const maxHz = 2000;
  const binHz = sampleRate / fftSize;

  const startBin = Math.max(1, Math.floor(minHz / binHz));
  const endBin = Math.min(freqData.length - 1, Math.ceil(maxHz / binHz));

  let bestBin = -1;
  let bestVal = 0;
  for (let i = startBin; i <= endBin; i++) {
    const v = freqData[i];
    if (v > bestVal) {
      bestVal = v;
      bestBin = i;
    }
  }

  if (bestBin < 0 || bestVal < 22) return null;
  return bestBin * binHz;
}

type HandFeatures = {
  y: number;
  pinchIndex: number;
  wristX: number;
  hasHand: boolean;
};

function getHandFeatures(landmarks: { x: number; y: number }[]): HandFeatures {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  return {
    y: clamp01(indexTip.y),
    pinchIndex: pinch01(dist),
    wristX: wrist.x,
    hasHand: true
  };
}

function pickHandsByScreenSide(result: HandLandmarkerResult): {
  leftSide: HandFeatures | null;
  rightSide: HandFeatures | null;
} {
  const lms = result.landmarks ?? [];
  if (lms.length === 0) return { leftSide: null, rightSide: null };

  // Match the user's mirrored preview: screenX = 1 - wristX.
  const hands = lms.map((lm) => {
    const feat = getHandFeatures(lm);
    const screenWristX = 1 - feat.wristX;
    return { screenWristX, feat };
  });

  const sorted = [...hands].sort((a, b) => a.screenWristX - b.screenWristX);
  return { leftSide: sorted[0]?.feat ?? null, rightSide: sorted[1]?.feat ?? null };
}

function safeStopTrack(track: MediaStreamTrack) {
  try {
    track.stop();
  } catch {
    // ignore
  }
}

type PlayerNodes = {
  audioCtx: AudioContext;
  source: MediaElementAudioSourceNode;
  pumpGain: GainNode;
  pumpLfo: OscillatorNode;
  pumpDepth: GainNode;
  pumpOffset: ConstantSourceNode;
  analyser: AnalyserNode;
  dryGain: GainNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayFeedbackHp: BiquadFilterNode;
  delayFeedbackLp: BiquadFilterNode;
  delayWet: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  compressor: DynamicsCompressorNode;
  masterGain: GainNode;
};

function createImpulseResponse(audioCtx: AudioContext, seconds: number, decay: number) {
  const sampleRate = audioCtx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const impulse = audioCtx.createBuffer(2, length, sampleRate);

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

export default function HandsStudioController({
  sessionId,
  audioEl,
  captureEnabled,
  captureStatus,
  onCaptureChange,
  mixdownEnabled = false,
  onMixdownSample,
  strudelIframeRef,
  strudelOpen = false,
  voiceAgent
}: {
  sessionId: string;
  audioEl: HTMLAudioElement | null;
  captureEnabled: boolean;
  captureStatus: "Recording" | "Armed" | "Off";
  onCaptureChange: (enabled: boolean) => void;
  mixdownEnabled?: boolean;
  onMixdownSample?: (payload: Record<string, unknown>) => void;
  strudelIframeRef?: React.RefObject<HTMLIFrameElement | null>;
  strudelOpen?: boolean;
  voiceAgent?: ReactNode;
}) {
  const audioElRef = useRef<HTMLAudioElement | null>(audioEl);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const playerRef = useRef<PlayerNodes | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const analysisStartedRef = useRef(false);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const drawingUtilsRef = useRef<DrawingUtils | null>(null);
  const visionRafRef = useRef<number | null>(null);

  const levelRef = useRef(0);
  const pitchRef = useRef(0.35);
  const pitchHzRef = useRef<number | null>(null);

  const bpmRef = useRef(120);
  const lastUiUpdateRef = useRef(0);
  const telemetryRef = useRef({
    tempoRate: 1,
    volumeGain: 1,
    bpm: 120,
    pumpDepth01: 0,
    delayMix01: 0,
    delayTimeSec: 0.12,
    delayFeedback: 0.2,
    reverbMix01: 0
  });

  const [cameraOn, setCameraOn] = useState(false);
  const [handsOn, setHandsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState(() => ({
    tempoRatePct: 100,
    tempoOffsetPct: 0,
    volumePct: 100,
    volumeOffsetPct: 0,
    delayPct: 0,
    delayMs: 120,
    reverbPct: 0
  }));

  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const base = getTasksVisionWasmBaseUrl();
    const vision = await FilesetResolver.forVisionTasks(base);
    const handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { delegate: "GPU", modelAssetPath: HAND_LANDMARKER_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 2
    });
    landmarkerRef.current = handLandmarker;
    return handLandmarker;
  }, []);

  const stopCamera = useCallback(() => {
    setCameraOn(false);
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach(safeStopTrack);

    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        (video as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const video = videoRef.current;
      if (!video) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false
      });
      streamRef.current = stream;
      (video as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();
      await ensureLandmarker();
      setCameraOn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start camera");
      stopCamera();
    }
  }, [ensureLandmarker, stopCamera]);

  const stopHands = useCallback(async () => {
    setHandsOn(false);
    levelRef.current = 0;
    pitchRef.current = 0.35;
    pitchHzRef.current = null;

    const player = playerRef.current;
    if (!player) return;

    // Important: don't close the AudioContext or recreate MediaElementSourceNode.
    // Browsers only allow calling `createMediaElementSource(audioEl)` once per element lifetime.
    // Just reset the controllable parameters back to neutral.
    const audioElement = audioElRef.current;
    if (audioElement) audioElement.playbackRate = 1;
    try {
      const now = player.audioCtx.currentTime;
      player.masterGain.gain.setTargetAtTime(1, now, 0.06);
      player.pumpDepth.gain.setTargetAtTime(0, now, 0.08);
      player.pumpOffset.offset.setTargetAtTime(1, now, 0.08);
      player.delayWet.gain.setTargetAtTime(0, now, 0.08);
      player.delayFeedback.gain.setTargetAtTime(0.2, now, 0.08);
      player.delay.delayTime.setTargetAtTime(0.12, now, 0.08);
      player.reverbWet.gain.setTargetAtTime(0, now, 0.12);
    } catch {
      // ignore
    }

    // Reset Strudel to defaults
    if (strudelIframeRef?.current?.contentWindow) {
      strudelIframeRef.current.contentWindow.postMessage(
        { type: "strudel:setParams", volume: 1, cps: 0.5 },
        "*"
      );
    }
  }, [strudelIframeRef]);

  const ensureAudioGraph = useCallback(async () => {
    if (playerRef.current) return playerRef.current;
    const audioElement = audioElRef.current;
    if (!audioElement) return null;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setError("Web Audio is not supported in this browser.");
      return null;
    }

    const audioCtx = new AudioContextCtor({ latencyHint: "interactive" });
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const source = audioCtx.createMediaElementSource(audioElement);
    const pumpGain = audioCtx.createGain();
    pumpGain.gain.value = 1;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.86;

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;

    // Output safety: tame clipping when FX are exaggerated.
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    // Dry / Wet routing
    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 1;

    // Echo/Delay (exaggerated)
    const delay = audioCtx.createDelay(1.5);
    delay.delayTime.value = 0.12;
    const delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.2;
    const delayFeedbackHp = audioCtx.createBiquadFilter();
    delayFeedbackHp.type = "highpass";
    delayFeedbackHp.frequency.value = 220;
    delayFeedbackHp.Q.value = 0.7;
    const delayFeedbackLp = audioCtx.createBiquadFilter();
    delayFeedbackLp.type = "lowpass";
    delayFeedbackLp.frequency.value = 6800;
    delayFeedbackLp.Q.value = 0.7;
    const delayWet = audioCtx.createGain();
    delayWet.gain.value = 0;
    delay.connect(delayFeedback);
    delayFeedback.connect(delayFeedbackHp);
    delayFeedbackHp.connect(delayFeedbackLp);
    delayFeedbackLp.connect(delay);

    // Reverb (exaggerated)
    const reverb = audioCtx.createConvolver();
    reverb.buffer = createImpulseResponse(audioCtx, 4.2, 2.2);
    const reverbWet = audioCtx.createGain();
    reverbWet.gain.value = 0;

    // Pump (BPM) modulates the gain.
    const pumpLfo = audioCtx.createOscillator();
    pumpLfo.type = "sine";
    pumpLfo.frequency.value = bpmRef.current / 60;

    const pumpDepth = audioCtx.createGain();
    pumpDepth.gain.value = 0;

    const pumpOffset = audioCtx.createConstantSource();
    pumpOffset.offset.value = 1;

    source.connect(pumpGain);
    pumpGain.connect(analyser);

    analyser.connect(dryGain);
    analyser.connect(delay);
    analyser.connect(reverb);

    dryGain.connect(masterGain);
    delay.connect(delayWet);
    delayWet.connect(masterGain);
    reverb.connect(reverbWet);
    reverbWet.connect(masterGain);

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);

    pumpLfo.connect(pumpDepth);
    pumpDepth.connect(pumpGain.gain);
    pumpOffset.connect(pumpGain.gain);

    pumpLfo.start();
    pumpOffset.start();

    const player: PlayerNodes = {
      audioCtx,
      source,
      pumpGain,
      pumpLfo,
      pumpDepth,
      pumpOffset,
      analyser,
      dryGain,
      delay,
      delayFeedback,
      delayFeedbackHp,
      delayFeedbackLp,
      delayWet,
      reverb,
      reverbWet,
      compressor,
      masterGain
    };
    playerRef.current = player;

    if (!analysisStartedRef.current) {
      analysisStartedRef.current = true;

      // Audio analysis loop (RMS + pitch estimate).
      const timeBuf = new Uint8Array(analyser.fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(timeBuf);
        analyser.getByteFrequencyData(freqBuf);

        const rms = computeRmsLevel(timeBuf);
        levelRef.current = levelRef.current * 0.84 + clamp01(rms * 3.1) * 0.16;

        const freqHz = estimateDominantFrequencyHz(freqBuf, audioCtx.sampleRate, analyser.fftSize);
        pitchHzRef.current = freqHz;
        const pitch01 = freqHz == null ? pitchRef.current * 0.985 : normalizePitchHzTo01(freqHz);
        pitchRef.current = pitchRef.current * 0.86 + pitch01 * 0.14;

        audioRafRef.current = requestAnimationFrame(tick);
      };
      audioRafRef.current = requestAnimationFrame(tick);
    }

    return player;
  }, []);

  useEffect(() => {
    audioElRef.current = audioEl;
  }, [audioEl]);

  const startHands = useCallback(async () => {
    try {
      setError(null);
      const player = await ensureAudioGraph();
      if (!player) {
        setError("Start audio in the Player first (and keep this tab visible).");
        return;
      }
      setHandsOn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable hands control");
      await stopHands();
    }
  }, [ensureAudioGraph, stopHands]);

  const toggleHandsCamera = useCallback(async () => {
    if (handsOn || cameraOn) {
      stopHands();
      stopCamera();
      return;
    }
    await startCamera();
    await startHands();
  }, [cameraOn, handsOn, startCamera, startHands, stopCamera, stopHands]);

  const applyTempoVolume = useCallback(
    (params: {
      tempoRate: number;
      volumeGain: number;
      bpm: number;
      pumpDepth01: number;
      delayMix01: number;
      delayTimeSec: number;
      delayFeedback: number;
      reverbMix01: number;
    }) => {
      const player = playerRef.current;
      const audioElement = audioElRef.current;
      if (!player || !audioElement) return;
      const now = player.audioCtx.currentTime;

      audioElement.playbackRate = params.tempoRate;
      player.masterGain.gain.setTargetAtTime(params.volumeGain, now, 0.06);

      const bpm = clamp(params.bpm, 30, 180);
      player.pumpLfo.frequency.setTargetAtTime(bpm / 60, now, 0.06);

      // Pump depth: keep gain >= 0.02.
      const d = clamp(params.pumpDepth01, 0, 0.49);
      player.pumpDepth.gain.setTargetAtTime(d, now, 0.08);
      player.pumpOffset.offset.setTargetAtTime(1 - d, now, 0.08);

      // Echo/Delay
      const delayMix01 = clamp01(params.delayMix01);
      const delayTimeSec = clamp(params.delayTimeSec, 0.03, 1.2);
      const delayFeedback = clamp(params.delayFeedback, 0, 0.92);
      player.delay.delayTime.setTargetAtTime(delayTimeSec, now, 0.06);
      player.delayFeedback.gain.setTargetAtTime(delayFeedback, now, 0.08);
      player.delayWet.gain.setTargetAtTime(delayMix01, now, 0.08);

      // Reverb
      const reverbMix01 = clamp01(params.reverbMix01);
      player.reverbWet.gain.setTargetAtTime(reverbMix01 * 0.98, now, 0.12);

      // Basic crossfade so dry doesn't clip when FX are pushed hard.
      const dry = clamp(1 - Math.min(0.92, delayMix01 * 0.65 + reverbMix01 * 0.75), 0.06, 1);
      player.dryGain.gain.setTargetAtTime(dry, now, 0.08);
    },
    []
  );

  const strudelOpenRef = useRef(strudelOpen);
  useEffect(() => { strudelOpenRef.current = strudelOpen; }, [strudelOpen]);

  const applyStrudelParams = useCallback(
    (params: { volumeGain: number; bpm: number }) => {
      if (!strudelOpenRef.current || !strudelIframeRef?.current?.contentWindow) return;
      const volume = Math.max(0, Math.min(1.5, params.volumeGain * (1.5 / 1.8)));
      const cps = Math.max(0.1, Math.min(3, params.bpm / 120));
      strudelIframeRef.current.contentWindow.postMessage(
        { type: "strudel:setParams", volume, cps },
        "*"
      );
    },
    [strudelIframeRef]
  );

  const visionLoop = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    const landmarker = landmarkerRef.current;
    if (!landmarker) return;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    if (!drawingUtilsRef.current) drawingUtilsRef.current = new DrawingUtils(ctx);
    const drawingUtils = drawingUtilsRef.current;

    const step = () => {
      if (!cameraOn) return;

      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      let result: HandLandmarkerResult | null = null;
      try {
        result = landmarker.detectForVideo(video, performance.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Hand tracking failed");
      }

      let leftSide: HandFeatures | null = null;
      let rightSide: HandFeatures | null = null;
      if (result) {
        ({ leftSide, rightSide } = pickHandsByScreenSide(result));
        for (const lm of result.landmarks ?? []) {
          drawingUtils.drawLandmarks(lm, { color: "rgba(0, 255, 136, 0.95)", lineWidth: 2 });
          drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, {
            color: "rgba(34, 197, 94, 0.85)",
            lineWidth: 2
          });
        }
      }

      if (handsOn) {
        // Mappings:
        // - Tempo: left-side hand Y
        // - Volume: right-side hand Y
        // - Pinch left: Echo/Delay (wet, time, feedback)
        // - Pinch right: Reverb wet
        const tempoCentered = leftSide?.hasHand ? clamp01(1 - leftSide.y) * 2 - 1 : 0; // [-1, 1]
        const volumeCentered = rightSide?.hasHand ? clamp01(1 - rightSide.y) * 2 - 1 : 0; // [-1, 1]

        // Map to a BPM range (30–180) and drive playbackRate from it.
        const tempo01 = (tempoCentered + 1) / 2; // [0,1]
        const bpm = 30 + clamp01(tempo01) * (180 - 30);
        const tempoRate = clamp(bpm / 120, 0.25, 1.5);
        const volumeGain = clamp(dbToGain(volumeCentered * 16), 0, 1.8);

        const leftPinch = leftSide?.hasHand ? leftSide.pinchIndex : 0;
        const rightPinch = rightSide?.hasHand ? rightSide.pinchIndex : 0;

        // Exaggerate: emphasize the top of the range.
        const echo01 = Math.pow(clamp01((leftPinch - 0.18) / 0.82), 1.35);
        const reverb01 = Math.pow(clamp01((rightPinch - 0.18) / 0.82), 1.25);

        const delayMix01 = echo01;
        const delayTimeSec = 0.09 + echo01 * 0.56;
        const delayFeedback = 0.12 + echo01 * 0.62;

        const reverbMix01 = reverb01 * 0.95;

        // Keep pump available but default to subtle (pinch is now reserved for FX).
        const pumpDepth01 = 0;
        applyTempoVolume({
          tempoRate,
          volumeGain,
          bpm,
          pumpDepth01,
          delayMix01,
          delayTimeSec,
          delayFeedback,
          reverbMix01
        });
        applyStrudelParams({ volumeGain, bpm });

        telemetryRef.current = {
          tempoRate,
          volumeGain,
          bpm,
          pumpDepth01,
          delayMix01,
          delayTimeSec,
          delayFeedback,
          reverbMix01
        };

        const uiNow = performance.now();
        if (uiNow - lastUiUpdateRef.current > 120) {
          lastUiUpdateRef.current = uiNow;
          setUi({
            tempoRatePct: Math.round(tempoRate * 100),
            tempoOffsetPct: Math.round(tempoCentered * 100),
            volumePct: Math.round(volumeGain * 100),
            volumeOffsetPct: Math.round(volumeCentered * 100),
            delayPct: Math.round(delayMix01 * 100),
            delayMs: Math.round(delayTimeSec * 1000),
            reverbPct: Math.round(reverbMix01 * 100)
          });
        }
      }

      visionRafRef.current = requestAnimationFrame(step);
    };

    visionRafRef.current = requestAnimationFrame(step);
  }, [applyTempoVolume, applyStrudelParams, cameraOn, handsOn]);

  useEffect(() => {
    if (!cameraOn) return;
    void visionLoop();
    return () => {
      if (visionRafRef.current != null) cancelAnimationFrame(visionRafRef.current);
      visionRafRef.current = null;
    };
  }, [cameraOn, visionLoop]);

  useEffect(() => {
    if (!handsOn) return;
    if (!captureEnabled) return;
    if (!sessionId) return;

    const tick = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const audioElement = audioElRef.current;
        if (!audioElement || audioElement.paused) return;
        const snapshot = telemetryRef.current;
        const payload = {
          source: "hands",
          recordedAtMs: Date.now(),
          trackTimeSec: audioElement.currentTime,
          rmsLevel: levelRef.current,
          pitch01: pitchRef.current,
          pitchHz: pitchHzRef.current,
          tempoRate: snapshot.tempoRate,
          volumeGain: snapshot.volumeGain,
          bpm: snapshot.bpm,
          pumpDepth01: snapshot.pumpDepth01,
          delayMix01: snapshot.delayMix01,
          delayTimeSec: snapshot.delayTimeSec,
          delayFeedback: snapshot.delayFeedback,
          reverbMix01: snapshot.reverbMix01
        };

        await fetch(`/api/sessions/${sessionId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "hands_telemetry_1s",
            payload
          })
        });
      } catch {
        // ignore (best-effort telemetry)
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, TELEMETRY_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [captureEnabled, handsOn, sessionId]);

  useEffect(() => {
    if (!handsOn) return;
    if (!mixdownEnabled) return;

    const tick = () => {
      try {
        if (document.visibilityState !== "visible") return;
        const audioElement = audioElRef.current;
        if (!audioElement || audioElement.paused) return;
        const snapshot = telemetryRef.current;
        const payload = {
          source: "hands",
          recordedAtMs: Date.now(),
          trackTimeSec: audioElement.currentTime,
          rmsLevel: levelRef.current,
          pitch01: pitchRef.current,
          pitchHz: pitchHzRef.current,
          tempoRate: snapshot.tempoRate,
          volumeGain: snapshot.volumeGain,
          bpm: snapshot.bpm,
          pumpDepth01: snapshot.pumpDepth01,
          delayMix01: snapshot.delayMix01,
          delayTimeSec: snapshot.delayTimeSec,
          delayFeedback: snapshot.delayFeedback,
          reverbMix01: snapshot.reverbMix01
        };

        onMixdownSample?.(payload);
      } catch {
        // ignore
      }
    };

    tick();
    const interval = window.setInterval(() => tick(), MIXDOWN_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [handsOn, mixdownEnabled, onMixdownSample]);

  useEffect(() => {
    return () => {
      stopCamera();
      void stopHands();
      if (audioRafRef.current != null) cancelAnimationFrame(audioRafRef.current);
      audioRafRef.current = null;
      analysisStartedRef.current = false;

      const player = playerRef.current;
      playerRef.current = null;
      if (player) {
        try {
          player.pumpLfo.stop();
          player.pumpOffset.stop();
        } catch {
          // ignore
        }
        try {
          void player.audioCtx.close();
        } catch {
          // ignore
        }
      }

      try {
        landmarkerRef.current?.close();
      } catch {
        // ignore
      }
      landmarkerRef.current = null;
    };
  }, [stopCamera, stopHands]);

  return (
    <section className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px),minmax(0,1fr)] items-start w-full mt-6">
        {/* Left Side: Telemetry & Controls */}
        <div className="flex flex-col gap-4 w-full shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-bg transition-all hover:brightness-110 active:scale-[0.98]"
              onClick={toggleHandsCamera}
            >
              {handsOn || cameraOn ? "Disable Hands + Camera" : "Start Experience"}
            </button>
          </div>

          <div className="bg-surface/40 p-4 rounded-2xl border border-border-subtle backdrop-blur-md">
            <Badge
              variant={
                captureStatus === "Recording"
                  ? "accent"
                  : captureStatus === "Armed"
                    ? "secondary"
                    : "outline"
              }
              className="w-fit"
              title="Event capture status (hands telemetry)"
            >
              <Disc3 className={`mr-1.5 h-3 w-3 ${captureStatus === "Recording" ? "animate-spin" : ""}`} />
              Capture: {captureStatus}
            </Badge>
            <div className="mt-2 flex gap-2">
              <button
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-text transition-all hover:bg-surface-elevated active:scale-[0.98] disabled:opacity-50"
                onClick={() => onCaptureChange(true)}
                disabled={captureEnabled}
                title="Start saving 1-second telemetry events while Hands is enabled and audio is playing"
              >
                Start
              </button>
              <button
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-text transition-all hover:bg-surface-elevated active:scale-[0.98] disabled:opacity-50"
                onClick={() => onCaptureChange(false)}
                disabled={!captureEnabled}
                title="Stop saving telemetry events"
              >
                Stop
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6 w-full bg-surface/40 p-6 rounded-2xl border border-border-subtle backdrop-blur-md">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Tempo</span>
              <span className="text-lg font-bold text-text">
                {ui.tempoRatePct}%{" "}
                <span className="font-normal text-sm text-text-muted">
                  ({ui.tempoOffsetPct >= 0 ? "+" : ""}
                  {ui.tempoOffsetPct})
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Volume</span>
              <span className="text-lg font-bold text-text">
                {ui.volumePct}%{" "}
                <span className="font-normal text-sm text-text-muted">
                  ({ui.volumeOffsetPct >= 0 ? "+" : ""}
                  {ui.volumeOffsetPct})
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Echo/Delay (Pinch L)</span>
              <span className="text-lg font-bold text-text">
                {ui.delayPct}% <span className="font-normal text-sm text-text-muted">({ui.delayMs}ms)</span>
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Reverb (Pinch R)</span>
              <span className="text-lg font-bold text-text">{ui.reverbPct}%</span>
            </div>

            <div className="w-full space-y-4 mt-2">
              {error ? <div className="text-sm font-semibold text-destructive">{error}</div> : null}
            </div>
          </div>
        </div>

        <div className="w-full space-y-4">
          {voiceAgent ? (
            <div className="glass-card rounded-2xl border border-border-subtle bg-surface/40 p-4">
              {voiceAgent}
            </div>
          ) : null}
          <div className="space-y-3 w-full">
            <div className="handCamFrame w-full aspect-video">
              <video ref={videoRef} className="handVideo w-full h-full object-cover" />
              <canvas ref={overlayRef} className="handOverlay w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
