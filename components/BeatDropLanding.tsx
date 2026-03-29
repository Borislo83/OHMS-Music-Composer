"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WebGLShaderWaveform from "@/components/WebGLShaderWaveform";
import AudioFileIO from "@/components/AudioFileIO";
import { TopBar } from "@/components/layout/top-bar";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Radio } from "lucide-react";
import { motion } from "framer-motion";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

function estimateDominantFrequencyHz(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number
) {
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

export default function BeatDropLanding() {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const levelRef = useRef(0);
  const pitchRef = useRef(0.4);
  const lastUiUpdateRef = useRef(0);

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitchHz, setPitchHz] = useState<number | null>(null);

  const getLevel = useCallback(() => levelRef.current, []);
  const getPitch = useCallback(() => pitchRef.current, []);

  const startAnalyserLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const audioCtx = audioCtxRef.current;
    if (!analyser || !audioCtx) return;

    const timeBuf = new Uint8Array(analyser.fftSize);
    const freqBuf = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(timeBuf);
      analyser.getByteFrequencyData(freqBuf);

      const rms = computeRmsLevel(timeBuf);
      const boosted = clamp01(rms * 3.2);
      levelRef.current = levelRef.current * 0.82 + boosted * 0.18;

      const freqHz = estimateDominantFrequencyHz(freqBuf, audioCtx.sampleRate, analyser.fftSize);
      const pitch01 = freqHz == null ? pitchRef.current * 0.985 : normalizePitchHzTo01(freqHz);
      pitchRef.current = pitchRef.current * 0.86 + pitch01 * 0.14;

      const uiNow = performance.now();
      if (uiNow - lastUiUpdateRef.current > 250) {
        lastUiUpdateRef.current = uiNow;
        setPitchHz(freqHz);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureAudioGraph = useCallback(async () => {
    if (typeof window === "undefined") return;
    const audioEl = audioElRef.current;
    if (!audioEl) return;

    if (!audioCtxRef.current) {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        setError("Web Audio is not supported in this browser.");
        return;
      }

      const audioCtx = new AudioContextCtor();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaElementSource(audioEl);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;

      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    const audioCtx = audioCtxRef.current;
    if (audioCtx?.state === "suspended") await audioCtx.resume();
    setIsReady(true);
  }, []);

  const togglePlayback = useCallback(async () => {
    try {
      setError(null);
      await ensureAudioGraph();

      const audioEl = audioElRef.current;
      if (!audioEl) return;

      if (audioEl.paused) {
        await audioEl.play();
        setIsPlaying(true);
        if (rafRef.current == null) startAnalyserLoop();
      } else {
        audioEl.pause();
        setIsPlaying(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start audio");
    }
  }, [ensureAudioGraph, startAnalyserLoop]);

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);
    return () => {
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      levelRef.current = 0;
      analyserRef.current = null;

      const audioCtx = audioCtxRef.current;
      audioCtxRef.current = null;
      void audioCtx?.close();
    };
  }, []);

  const statusText = useMemo(() => {
    if (error) return error;
    if (!isReady) return "Tap Start to begin.";
    const hzText = pitchHz == null ? "—" : `${Math.round(pitchHz)} Hz`;
    return isPlaying ? `Playing — ${hzText}` : "Paused.";
  }, [error, isReady, isPlaying, pitchHz]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <WebGLShaderWaveform getLevel={getLevel} getPitch={getPitch} />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar />

        <main className="flex flex-1 items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <GlassPanel className="w-[min(480px,92vw)] space-y-5 p-6" glow>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Radio className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="font-heading text-xl font-black tracking-tight text-text">
                    Beat Drop Visualizer
                  </h1>
                  <p className="text-xs text-text-muted">
                    Reactive waveform driven by volume &amp; pitch.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={togglePlayback} size="lg">
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? "Pause" : "Start"}
                </Button>
                {pitchHz != null && (
                  <Badge variant="accent">{Math.round(pitchHz)} Hz</Badge>
                )}
              </div>

              <AudioFileIO
                title="Visualizer track"
                getAudioEl={() => audioElRef.current}
                currentSrc="/audio/beat-drops.mp3"
                defaultLabel="beat-drops.mp3"
              />

              <p className="text-xs text-text-dim">{statusText}</p>

              <audio
                ref={audioElRef}
                src="/audio/beat-drops.mp3"
                preload="auto"
                crossOrigin="anonymous"
              />
            </GlassPanel>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
