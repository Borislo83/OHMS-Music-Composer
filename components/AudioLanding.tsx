"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RainbowBlobIcon from "@/components/RainbowBlobIcon";
import HomeShader from "@/components/HomeShader";
import AudioFileIO from "@/components/AudioFileIO";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { motion } from "framer-motion";
import {
  Hand,
  Sparkles,
  Volume2,
  Radio,
  Code,
  Play,
  Pause,
  ChevronRight,
} from "lucide-react";

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

const FEATURES = [
  {
    icon: Hand,
    title: "Gestural Interface",
    description:
      "Control sound in real-time with hand tracking. MediaPipe captures your gestures and maps them to musical parameters instantly.",
    pills: ["Camera", "Hands", "Realtime"],
  },
  {
    icon: Sparkles,
    title: "AI-driven Soundscapes",
    description:
      "Lyria AI generates evolving musical landscapes that respond to your creative direction. Every session produces something unique.",
    pills: ["Lyria", "Evolve", "Respond"],
  },
  {
    icon: Radio,
    title: "Spatial Audio Engine",
    description:
      "Immersive 3D audio rendering places sounds in space around you. Mix, layer, and sculpt your sonic environment.",
    pills: ["3D", "Mix", "Render"],
  },
];

export default function AudioLanding() {
  const router = useRouter();
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelRef = useRef(0);
  const pitchRef = useRef(0.4);
  const gestureStartBusyRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasEnabledSound, setHasEnabledSound] = useState(false);
  const [dismissedStartOverlay, setDismissedStartOverlay] = useState(false);

  const getLevel = useCallback(() => levelRef.current, []);
  const getPitch = useCallback(() => pitchRef.current, []);

  const bg = <HomeShader getLevel={getLevel} getPitch={getPitch} />;

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
    if (audioCtx?.state === "suspended") {
      await audioCtx.resume();
    }
  }, []);

  const enableSound = useCallback(async () => {
    const audioEl = audioElRef.current;
    if (!audioEl) return;
    try {
      setError(null);
      setNeedsGesture(false);
      audioEl.muted = false;
      audioEl.volume = 1;
      setIsMuted(false);

      await ensureAudioGraph();
      await audioEl.play();
      setIsPlaying(true);
      setHasEnabledSound(true);
      setDismissedStartOverlay(true);

      if (rafRef.current == null) startAnalyserLoop();
    } catch (e) {
      setNeedsGesture(true);
      setError(e instanceof Error ? e.message : "Autoplay was blocked");
    }
  }, [ensureAudioGraph, startAnalyserLoop]);

  const startFromUserGesture = useCallback(async () => {
    if (gestureStartBusyRef.current) return;
    gestureStartBusyRef.current = true;
    try {
      await enableSound();
    } finally {
      gestureStartBusyRef.current = false;
    }
  }, [enableSound]);

  const togglePlayback = useCallback(async () => {
    try {
      setError(null);

      const audioEl = audioElRef.current;
      if (!audioEl) return;

      // If we're muted (autoplay-safe) or autoplay was blocked, interpret the CTA as "enable sound".
      if (audioEl.muted || needsGesture) {
        await enableSound();
        return;
      }

      await ensureAudioGraph();
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
  }, [enableSound, ensureAudioGraph, needsGesture, startAnalyserLoop]);

  useEffect(() => {
    // Attempt autoplay on landing. Browsers may block unmuted autoplay; muted autoplay often works.
    const audioEl = audioElRef.current;
    if (!audioEl) return;

    const attempt = async () => {
      try {
        setError(null);
        setNeedsGesture(false);

        // Autoplay-safe fallback: start muted, then let the user tap once to enable sound.
        audioEl.muted = true;
        audioEl.volume = 1;
        setIsMuted(true);
        await audioEl.play();
        setIsPlaying(true);
      } catch {
        setNeedsGesture(true);
      }
    };

    void attempt();
  }, [ensureAudioGraph, startAnalyserLoop]);

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onVolume = () => setIsMuted(audioEl.muted || audioEl.volume === 0);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);
    audioEl.addEventListener("volumechange", onVolume);

    return () => {
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
      audioEl.removeEventListener("volumechange", onVolume);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      levelRef.current = 0;
      pitchRef.current = 0.4;
      analyserRef.current = null;

      const audioCtx = audioCtxRef.current;
      audioCtxRef.current = null;
      void audioCtx?.close();
    };
  }, []);

  const statusText = useMemo(() => {
    if (error) return error;
    if (needsGesture) return "Autoplay was blocked — tap Start Creating to play.";
    if (isMuted) return "Autoplaying (muted) — tap Start Creating for sound + reactivity.";
    return isPlaying ? "Playing — reactive sphere is live." : "Paused.";
  }, [error, isMuted, isPlaying, needsGesture]);

  const showStartOverlay =
    !dismissedStartOverlay && !hasEnabledSound && (needsGesture || (isMuted && isPlaying));
  const overlayTitle = needsGesture ? "Click anywhere to start audio" : "Click anywhere to enable sound";
  const overlayText = needsGesture
    ? "Your browser blocked autoplay. We need one click to begin playback."
    : "Audio is playing muted. Click once to unmute and enable full reactivity.";

  return (
    <div className="relative min-h-screen bg-[#0A0F1E]">
      {/* Background shader */}
      {bg}
      {/* Black circle fixed over the shader center */}
      <div
        className="pointer-events-none fixed left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "660px",
          height: "660px",
          background: "radial-gradient(circle, rgba(10,15,30,0.95) 0%, rgba(10,15,30,0.85) 60%, transparent 100%)",
        }}
      />

      {/* Start overlay -- glass morphism redesign */}
      {showStartOverlay ? (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-black/60 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Start audio"
          tabIndex={-1}
          onPointerDown={(e) => {
            e.preventDefault();
            void startFromUserGesture();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void startFromUserGesture();
            }
          }}
        >
          <GlassPanel
            variant="elevated"
            glow
            className="max-w-md rounded-2xl p-8"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Volume2 className="h-7 w-7 text-primary" />
              </div>
              <h2 className="font-heading text-xl font-bold tracking-tight text-text">
                {overlayTitle}
              </h2>
              <p className="font-body text-sm leading-relaxed text-text-muted">
                {overlayText}
              </p>
              <div className="flex items-center gap-3">
                <Button size="lg" onClick={startFromUserGesture}>
                  <Volume2 className="h-4 w-4" />
                  Unmute
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => setDismissedStartOverlay(true)}
                >
                  Continue muted
                </Button>
              </div>
            </motion.div>
          </GlassPanel>
        </div>
      ) : null}

      {/* Top bar */}
      <TopBar />

      {/* Main content */}
      <main className="relative z-10">
        {/* ── Hero Section ── */}
        <section
          id="studio"
          className="relative -mt-16 flex min-h-screen flex-col items-center justify-center px-6 text-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Badge variant="accent" className="mb-6">
              THE FUTURE OF DIGITAL AUDIO
            </Badge>
          </motion.div>

          <motion.h1
            className="font-heading text-[clamp(38px,5vw,62px)] font-black tracking-tighter bg-gradient-to-r from-primary via-secondary to-tertiary bg-clip-text text-transparent"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Sculpt Sound
            <br />
            with Your Hands
          </motion.h1>

          <motion.p
            className="font-body mt-5 max-w-md text-sm leading-relaxed text-text-muted"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            Experience the fusion of Lyria-powered AI and Strudel live coding. Perform, compose,
            and visualize music through pure gestural energy.
          </motion.p>

          <motion.div
            className="mt-8 flex items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Button size="lg" onClick={() => router.push("/studio")}>
              <Play className="h-4 w-4" />
              Start Creating
            </Button>
            <a href="#demo">
              <Button variant="outline" size="lg">
                Watch Live Demo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </a>
          </motion.div>

        </section>

        {/* ── Features Section ── */}
        <section id="lyra" className="mx-auto max-w-[1080px] px-6 py-24">
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="font-heading text-3xl font-black tracking-tight text-text">
              Master the Digital Ether
            </h2>
            <p className="font-body mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-muted">
              Three core pillars power your creative experience. Gesture, AI, and spatial audio
              come together to dissolve the boundary between performer and instrument.
            </p>
          </motion.div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 * index }}
                >
                  <GlassPanel
                    variant="default"
                    className="flex h-full flex-col gap-4 p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-glow"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-heading text-base font-bold text-text">
                      {feature.title}
                    </h3>
                    <p className="font-body text-sm leading-relaxed text-text-muted">
                      {feature.description}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      {feature.pills.map((pill) => (
                        <Badge key={pill} variant="secondary">
                          {pill}
                        </Badge>
                      ))}
                    </div>
                  </GlassPanel>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ── Live Code Section ── */}
        <section id="strudel" className="mx-auto max-w-[1080px] px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="grid items-start gap-8 lg:grid-cols-2">
              <div className="flex flex-col gap-6">
                <h2 className="font-heading text-3xl font-black tracking-tight text-text">
                  Live Code Performance
                </h2>
                <p className="font-body text-sm leading-relaxed text-text-muted">
                  Write patterns that become music in real-time. Strudel brings the power of
                  algorithmic composition to your browser with a minimal, expressive syntax.
                </p>
                <GlassPanel variant="elevated" className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                    <Code className="h-3.5 w-3.5 text-primary" />
                    <span className="font-heading text-xs font-bold tracking-tight text-text-muted">
                      strudel
                    </span>
                  </div>
                  <pre className="p-4 font-mono text-sm leading-relaxed text-primary">
                    {`stack(
  s("bd*2"),
  s("hh*8").gain(0.4),
  s("sn").every(4, rev)
)`}
                  </pre>
                </GlassPanel>
              </div>

              <GlassPanel variant="default" className="overflow-hidden">
                <iframe
                  src="/strudel/index.html"
                  className="h-[500px] w-full border-none bg-[#111]"
                  style={{ borderRadius: "inherit" }}
                  title="Strudel Workspace"
                  loading="lazy"
                />
              </GlassPanel>
            </div>
          </motion.div>
        </section>

        {/* ── CTA Section ── */}
        <section id="gallery" className="mx-auto max-w-[1080px] px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <GlassPanel
              variant="elevated"
              glow
              className="relative overflow-hidden p-10 text-center md:p-16"
            >
              {/* Gradient overlay */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5" />

              <div className="relative z-10 flex flex-col items-center gap-6">
                <h2 className="font-heading text-2xl font-black tracking-tight text-text md:text-3xl">
                  Ready to break the sound barrier?
                </h2>
                <p className="font-body max-w-lg text-sm italic leading-relaxed text-text-muted">
                  &quot;The boundary between the performer and the instrument has finally
                  dissolved.&quot;
                </p>
                <div className="flex items-center gap-4">
                  <Button size="lg" onClick={() => router.push("/studio")}>
                    <Play className="h-4 w-4" />
                    Start Creating
                  </Button>
                  <a href="#lyra">
                    <Button variant="outline" size="lg">
                      Explore Features
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </div>
            </GlassPanel>
          </motion.div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-border-subtle px-6 py-10">
          <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-4 text-center">
            <span className="font-heading text-xs font-extrabold tracking-widest text-text-muted">
              OHMS
            </span>
            <nav className="flex items-center gap-6" aria-label="Footer">
              <a
                href="#studio"
                className="font-body text-xs text-text-muted transition-colors hover:text-text"
              >
                Studio
              </a>
              <a
                href="#lyra"
                className="font-body text-xs text-text-muted transition-colors hover:text-text"
              >
                Lyra
              </a>
              <a
                href="#strudel"
                className="font-body text-xs text-text-muted transition-colors hover:text-text"
              >
                Strudel
              </a>
              <a
                href="#gallery"
                className="font-body text-xs text-text-muted transition-colors hover:text-text"
              >
                Gallery
              </a>
            </nav>
            <p className="font-body text-[11px] text-text-muted/60">
              Built with Next.js, Lyria AI, Strudel, and MediaPipe
            </p>
          </div>
        </footer>

        {/* Hidden audio element */}
        <audio
          ref={audioElRef}
          src="/audio/beat-drops.mp3"
          preload="auto"
          playsInline
          crossOrigin="anonymous"
        />
      </main>
    </div>
  );
}
