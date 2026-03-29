"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult
} from "@mediapipe/tasks-vision";
import WebGLShader from "@/components/WebGLShader";
import AudioFileIO from "@/components/AudioFileIO";
import { getTasksVisionWasmBaseUrl } from "@/lib/mediapipe";
import { TopBar } from "@/components/layout/top-bar";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Camera, CameraOff, Hand, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const SOUNDTRACK_SRC = "/audio/beat-drops.mp3";
const SOUNDTRACK_LABEL = "\u201c25 Most Legendary Beat Drops\u201d";
const TELEMETRY_INTERVAL_MS = 1000;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function safeStopTrack(track: MediaStreamTrack) {
  try {
    track.stop();
  } catch {
    // ignore
  }
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

  const hands = lms.map((lm) => {
    const feat = getHandFeatures(lm);
    const screenWristX = 1 - feat.wristX;
    return { screenWristX, feat };
  });

  const sorted = [...hands].sort((a, b) => a.screenWristX - b.screenWristX);
  return { leftSide: sorted[0]?.feat ?? null, rightSide: sorted[1]?.feat ?? null };
}

type PlayerNodes = {
  audioCtx: AudioContext;
  source: MediaElementAudioSourceNode;
  pumpGain: GainNode;
  pumpLfo: OscillatorNode;
  pumpDepth: GainNode;
  pumpOffset: ConstantSourceNode;
  analyser: AnalyserNode;
  masterGain: GainNode;
};

function CenterMeter({ value, label }: { value: number; label?: string }) {
  const x01 = (clamp(value, -1, 1) + 1) * 0.5;
  return (
    <div className="handMeter" aria-hidden="true" title={label}>
      <div className="handMeterTrack" />
      <div className="handMeterCenter" />
      <div className="handMeterMarker" style={{ left: `${x01 * 100}%` }} />
    </div>
  );
}

export default function HandSynthLanding({ sessionId }: { sessionId?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<PlayerNodes | null>(null);
  const audioRafRef = useRef<number | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const drawingUtilsRef = useRef<DrawingUtils | null>(null);
  const visionRafRef = useRef<number | null>(null);

  const pinchDownRef = useRef(false);
  const tapTimesRef = useRef<number[]>([]);

  const levelRef = useRef(0);
  const pitchRef = useRef(0.35);

  const bpmRef = useRef(120);
  const lastUiUpdateRef = useRef(0);
  const pitchHzRef = useRef<number | null>(null);
  const telemetryRef = useRef({
    tempoRate: 1,
    volumeGain: 1,
    bpm: 120,
    pumpDepth01: 0
  });

  const [cameraOn, setCameraOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState(() => ({
    tempoRatePct: 100,
    tempoOffsetPct: 0,
    volumePct: 100,
    volumeOffsetPct: 0,
    bpm: 120,
    pumpPct: 0
  }));

  const getLevel = useCallback(() => levelRef.current, []);
  const getPitch = useCallback(() => pitchRef.current, []);

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

  const stopAudio = useCallback(async () => {
    setPlaying(false);
    if (audioRafRef.current != null) cancelAnimationFrame(audioRafRef.current);
    audioRafRef.current = null;
    levelRef.current = 0;
    pitchRef.current = 0.35;

    try {
      audioElRef.current?.pause();
    } catch {
      // ignore
    }

    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.pumpLfo.stop();
      player.pumpOffset.stop();
    } catch {
      // ignore
    }
    try {
      await player.audioCtx.close();
    } catch {
      // ignore
    }
  }, []);

  const ensureAudioGraph = useCallback(async () => {
    if (playerRef.current) return playerRef.current;
    const audioEl = audioElRef.current;
    if (!audioEl) return null;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setError("Web Audio is not supported in this browser.");
      return null;
    }

    const audioCtx = new AudioContextCtor({ latencyHint: "interactive" });
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const source = audioCtx.createMediaElementSource(audioEl);
    const pumpGain = audioCtx.createGain();
    pumpGain.gain.value = 1;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.86;

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;

    const pumpLfo = audioCtx.createOscillator();
    pumpLfo.type = "sine";
    pumpLfo.frequency.value = bpmRef.current / 60;

    const pumpDepth = audioCtx.createGain();
    pumpDepth.gain.value = 0;

    const pumpOffset = audioCtx.createConstantSource();
    pumpOffset.offset.value = 1;

    source.connect(pumpGain);
    pumpGain.connect(analyser);
    analyser.connect(masterGain);
    masterGain.connect(audioCtx.destination);

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
      masterGain
    };
    playerRef.current = player;

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

    return player;
  }, []);

  const startAudio = useCallback(async () => {
    try {
      setError(null);
      const audioEl = audioElRef.current;
      if (!audioEl) return;
      const player = await ensureAudioGraph();
      if (!player) return;
      await audioEl.play();
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start audio");
      await stopAudio();
    }
  }, [ensureAudioGraph, stopAudio]);

  const applyTempoVolume = useCallback(
    (params: { tempoRate: number; volumeGain: number; bpm: number; pumpDepth01: number }) => {
      const player = playerRef.current;
      const audioEl = audioElRef.current;
      if (!player || !audioEl) return;

      const now = player.audioCtx.currentTime;

      audioEl.playbackRate = params.tempoRate;
      player.masterGain.gain.setTargetAtTime(params.volumeGain, now, 0.06);

      const bpm = clamp(params.bpm, 40, 260);
      player.pumpLfo.frequency.setTargetAtTime(bpm / 60, now, 0.06);

      const d = clamp(params.pumpDepth01, 0, 0.49);
      player.pumpDepth.gain.setTargetAtTime(d, now, 0.08);
      player.pumpOffset.offset.setTargetAtTime(1 - d, now, 0.08);
    },
    []
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

      const tempoCentered = leftSide?.hasHand ? clamp01(1 - leftSide.y) * 2 - 1 : 0;
      const volumeCentered = rightSide?.hasHand ? clamp01(1 - rightSide.y) * 2 - 1 : 0;

      const tempoRate = clamp(Math.pow(2, tempoCentered * 0.85), 0.35, 2.2);
      const volumeGain = clamp(dbToGain(volumeCentered * 16), 0, 2.2);

      const pinch = leftSide?.hasHand ? leftSide.pinchIndex : 0;
      const isPinched = pinch > 0.86;
      if (isPinched && !pinchDownRef.current) {
        pinchDownRef.current = true;
        const now = performance.now();
        tapTimesRef.current = [...tapTimesRef.current, now].slice(-6);
        const t = tapTimesRef.current;
        if (t.length >= 3) {
          const intervals: number[] = [];
          for (let i = 1; i < t.length; i++) intervals.push(t[i] - t[i - 1]);
          const recent = intervals.slice(-4);
          const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
          const bpm = clamp((60_000 / Math.max(120, avg)), 30, 180);
          bpmRef.current = bpm;
        }
      } else if (!isPinched) {
        pinchDownRef.current = false;
      }

      const pumpDepth01 = isPinched ? clamp01((pinch - 0.86) / 0.14) * 0.46 : 0;
      applyTempoVolume({
        tempoRate,
        volumeGain,
        bpm: bpmRef.current,
        pumpDepth01
      });
      telemetryRef.current = {
        tempoRate,
        volumeGain,
        bpm: bpmRef.current,
        pumpDepth01
      };

      const uiNow = performance.now();
      if (uiNow - lastUiUpdateRef.current > 120) {
        lastUiUpdateRef.current = uiNow;
        setUi({
          tempoRatePct: Math.round(tempoRate * 100),
          tempoOffsetPct: Math.round(tempoCentered * 100),
          volumePct: Math.round(volumeGain * 100),
          volumeOffsetPct: Math.round(volumeCentered * 100),
          bpm: Math.round(bpmRef.current),
          pumpPct: Math.round((pumpDepth01 / 0.46) * 100)
        });
      }

      visionRafRef.current = requestAnimationFrame(step);
    };

    visionRafRef.current = requestAnimationFrame(step);
  }, [applyTempoVolume, cameraOn]);

  useEffect(() => {
    if (!cameraOn) return;
    void visionLoop();
    return () => {
      if (visionRafRef.current != null) cancelAnimationFrame(visionRafRef.current);
      visionRafRef.current = null;
    };
  }, [cameraOn, visionLoop]);

  useEffect(() => {
    if (!sessionId) return;
    if (!playing) return;

    const tick = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const snapshot = telemetryRef.current;
        const audioEl = audioElRef.current;
        const payload = {
          source: "hands",
          recordedAtMs: Date.now(),
          trackTimeSec: audioEl?.currentTime ?? null,
          rmsLevel: levelRef.current,
          pitch01: pitchRef.current,
          pitchHz: pitchHzRef.current,
          tempoRate: snapshot.tempoRate,
          volumeGain: snapshot.volumeGain,
          bpm: snapshot.bpm,
          pumpDepth01: snapshot.pumpDepth01
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
        // ignore (telemetry is best-effort)
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, TELEMETRY_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [playing, sessionId]);

  useEffect(() => {
    return () => {
      stopCamera();
      void stopAudio();
      try {
        landmarkerRef.current?.close();
      } catch {
        // ignore
      }
      landmarkerRef.current = null;
    };
  }, [stopAudio, stopCamera]);

  const directions = useMemo(
    () => [
      "Tempo: left-side hand up/down (center = normal).",
      "Volume: right-side hand up/down (center = normal).",
      "Pinch (left index) = tap BPM (drives the audible pump). Hold pinch for stronger pump."
    ],
    []
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <WebGLShader getLevel={getLevel} getPitch={getPitch} />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar />

        <main className="flex-1 p-6">
          <div className="mx-auto max-w-[1200px]">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-6"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Hand className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="font-heading text-2xl font-black tracking-tight text-text">
                    Hand Synth Controller
                  </h1>
                  <p className="text-xs text-text-muted">
                    Control tempo &amp; volume with hand gestures. Pinch to set BPM.
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Controls */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-6 flex flex-wrap items-center gap-3"
            >
              <Button onClick={playing ? stopAudio : startAudio}>
                {playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Stop Audio" : "Start Audio"}
              </Button>
              <Button variant="secondary" onClick={cameraOn ? stopCamera : startCamera}>
                {cameraOn ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                {cameraOn ? "Stop Camera" : "Start Camera"}
              </Button>
              {sessionId && (
                <Badge variant="accent">Recording to session</Badge>
              )}
            </motion.div>

            {/* Two-panel layout */}
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              {/* Left: Camera */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
              >
                <GlassPanel className="overflow-hidden p-0">
                  <div className="handCamFrame" style={{ borderRadius: "inherit", border: "none" }}>
                    <video ref={videoRef} className="handVideo" />
                    <canvas ref={overlayRef} className="handOverlay" />
                  </div>
                </GlassPanel>
                <div className="mt-3">
                  <AudioFileIO
                    title="Hands track"
                    getAudioEl={() => audioElRef.current}
                    currentSrc={SOUNDTRACK_SRC}
                    defaultLabel="beat-drops.mp3"
                  />
                </div>
                <p className="mt-2 text-xs text-text-dim">Soundtrack: {SOUNDTRACK_LABEL}</p>
              </motion.div>

              {/* Right: Stats */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <GlassPanel className="space-y-4 p-5">
                  <h3 className="font-heading text-sm font-bold text-text">Live Stats</h3>

                  {/* Tempo */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">Tempo</span>
                      <span className="font-mono text-xs font-black text-text">
                        {ui.tempoRatePct}%{" "}
                        <span className="text-text-dim">
                          ({ui.tempoOffsetPct >= 0 ? "+" : ""}{ui.tempoOffsetPct})
                        </span>
                      </span>
                    </div>
                    <CenterMeter value={ui.tempoOffsetPct / 100} label="Tempo" />
                  </div>

                  {/* Volume */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">Volume</span>
                      <span className="font-mono text-xs font-black text-text">
                        {ui.volumePct}%{" "}
                        <span className="text-text-dim">
                          ({ui.volumeOffsetPct >= 0 ? "+" : ""}{ui.volumeOffsetPct})
                        </span>
                      </span>
                    </div>
                    <CenterMeter value={ui.volumeOffsetPct / 100} label="Volume" />
                  </div>

                  {/* BPM */}
                  <div className="flex items-center justify-between rounded-xl bg-white/[0.04] border border-border-subtle px-4 py-3">
                    <span className="text-xs font-bold text-text-muted">BPM (Pinch)</span>
                    <span className="font-mono text-sm font-black text-primary">
                      {ui.bpm}{" "}
                      <span className="text-xs text-text-dim">(pump {ui.pumpPct}%)</span>
                    </span>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive-dim px-3 py-2 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {/* Directions */}
                  <div className="space-y-2 border-t border-border-subtle pt-4">
                    <h4 className="text-xs font-bold text-text-muted">Directions</h4>
                    <ul className="space-y-1.5 pl-4">
                      {directions.map((t) => (
                        <li key={t} className="text-xs text-text-dim list-disc">{t}</li>
                      ))}
                    </ul>
                  </div>
                </GlassPanel>
              </motion.div>
            </div>

            <audio ref={audioElRef} src={SOUNDTRACK_SRC} preload="auto" crossOrigin="anonymous" />
          </div>
        </main>
      </div>
    </div>
  );
}
