"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WebGLShader from "@/components/WebGLShader";
import HandsStudioController from "@/components/HandsStudioController";
import StudioPlayer from "@/components/StudioPlayer";
import StudioVoiceAgent, { type VoiceCommand, type VoiceCommandResult } from "@/components/StudioVoiceAgent";
import FeedbackPanel, { type FeedbackPayload } from "@/components/FeedbackPanel";
import IterationHistory, { type IterationEntry } from "@/components/IterationHistory";
import { SOUNDTRACKS } from "@/lib/songs";
import { renderHandsMixdownWav, type HandsTelemetrySample } from "@/lib/audio/handsMixdown";

import { DAWLayout } from "@/components/layout/daw-layout";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Music, Zap, Radio, ArrowLeft, Home, Hand, PanelLeft, ChevronLeft, ChevronRight, Code, Loader2, HelpCircle, X } from "lucide-react";
import StrudelAIPanel from "@/components/StrudelAIPanel";

type Props = {
  sessionId: string;
};

type MixdownItem = {
  id: string;
  createdAt: string;
  url: string;
  filename: string;
  sizeBytes: number;
};

export default function StudioSessionClient({ sessionId }: Props) {
  const [audioSrc, setAudioSrc] = useState<string>(SOUNDTRACKS[0]?.src ?? "/audio/beat-drops.mp3");
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string>("Fullscreen");
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState<IterationEntry[]>([]);
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [strudelOpen, setStrudelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [selectedSoundtrackId, setSelectedSoundtrackId] = useState<string>(SOUNDTRACKS[0]?.id ?? "beat-drops");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const strudelIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const [mixingEnabled, setMixingEnabled] = useState(false);
  const [mixingBusy, setMixingBusy] = useState(false);
  const [mixingError, setMixingError] = useState<string | null>(null);
  const mixingEnabledRef = useRef(false);
  const mixSourceUrlRef = useRef<string | null>(null);
  const mixSamplesRef = useRef<HandsTelemetrySample[]>([]);
  const [mixdowns, setMixdowns] = useState<MixdownItem[]>([]);
  const mixdownsRef = useRef<MixdownItem[]>([]);

  const strudelStateRef = useRef<{
    code: string | null;
    cps: number | null;
    bpm: number | null;
    isPlaying: boolean;
  } | null>(null);
  const strudelReadyRef = useRef(false);

  const setPlayerRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioEl(node);
  }, []);

  useEffect(() => {
    if (!audioEl) return;
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    const onEnded = () => setAudioPlaying(false);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);
    setAudioPlaying(!audioEl.paused);
    return () => {
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
    };
  }, [audioEl]);

  useEffect(() => {
    mixingEnabledRef.current = mixingEnabled;
  }, [mixingEnabled]);

  useEffect(() => {
    mixdownsRef.current = mixdowns;
  }, [mixdowns]);

  useEffect(() => {
    return () => {
      for (const m of mixdownsRef.current) {
        try {
          URL.revokeObjectURL(m.url);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "strudel:heartbeat") return;
      strudelReadyRef.current = true;
      strudelStateRef.current = {
        code: typeof event.data.code === "string" ? event.data.code : null,
        cps: typeof event.data.cps === "number" ? event.data.cps : null,
        bpm: typeof event.data.bpm === "number" ? event.data.bpm : null,
        isPlaying: Boolean(event.data.isPlaying),
      };
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const captureStatus =
    captureEnabled && audioPlaying ? "Recording" : captureEnabled ? "Armed" : "Off";
  const mixingStatus = mixingBusy ? "Rendering" : mixingEnabled ? "Mixing" : "Off";

  const getLevel = useCallback(() => (busy ? 0.22 : 0.12), [busy]);
  const getPitch = useCallback(
    () => Math.min(1, 0.28 + iterations.length * 0.08),
    [iterations.length]
  );

  const selected = useMemo(() => {
    if (!selectedIterationId) return null;
    return iterations.find((it) => it.iterationId === selectedIterationId) ?? null;
  }, [iterations, selectedIterationId]);

  useEffect(() => {
    if (selected?.audioUrl) setAudioSrc(selected.audioUrl);
  }, [selected?.audioUrl]);

  const refreshIterations = useCallback(
    async (preferredId?: string | null) => {
      try {
        setHistoryBusy(true);
        setHistoryError(null);
        const response = await fetch(`/api/sessions/${sessionId}/iterations`);
        const body = (await response.json()) as {
          iterations?: IterationEntry[];
          activeIterationId?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error || "Failed to load iterations");
        }
        const nextIterations = body.iterations ?? [];
        setIterations(nextIterations);
        setSelectedIterationId((prev) => {
          const desired =
            preferredId ??
            prev ??
            (body.activeIterationId &&
            nextIterations.some((it) => it.iterationId === body.activeIterationId)
              ? body.activeIterationId
              : null) ??
            nextIterations[0]?.iterationId ??
            null;

          if (!desired) return null;
          return nextIterations.some((it) => it.iterationId === desired)
            ? desired
            : nextIterations[0]?.iterationId ?? null;
        });
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : "Failed to load iterations");
      } finally {
        setHistoryBusy(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    void refreshIterations();
  }, [refreshIterations]);

  const submitFeedback = useCallback(
    async (payload: FeedbackPayload) => {
      const response = await fetch(`/api/sessions/${sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as { feedbackEventId?: string; error?: string };
      if (!response.ok || !body.feedbackEventId) {
        throw new Error(body.error || "Failed to submit feedback");
      }
    },
    [sessionId]
  );

  const strudelBusyRef = useRef(false);
  const [strudelGenerating, setStrudelGenerating] = useState(false);

  const generateStrudelFromVoice = useCallback(async (prompt: string) => {
    if (!prompt) {
      setStrudelOpen(true);
      setStatusText("Strudel ready — say what you want to create.");
      return;
    }
    if (strudelBusyRef.current) return;
    strudelBusyRef.current = true;
    setStrudelGenerating(true);
    setStrudelOpen(true);
    setStatusText(`Generating Strudel: "${prompt}"...`);

    try {
      const res = await fetch("/api/strudel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { code?: string; error?: string };

      if (!res.ok || !data.code) {
        throw new Error(data.error ?? "Strudel generation failed.");
      }

      const ready = await new Promise<boolean>((resolve) => {
        let tries = 0;
        const tick = () => {
          if (strudelReadyRef.current && strudelIframeRef.current?.contentWindow) {
            resolve(true);
            return;
          }
          if (tries > 15) {
            resolve(false);
            return;
          }
          tries += 1;
          setTimeout(tick, 200);
        };
        tick();
      });
      if (!ready) {
        throw new Error("Strudel is still loading. Please try again.");
      }

      strudelIframeRef.current?.contentWindow?.postMessage({ type: "strudel:setCode", code: data.code }, "*");
      setStatusText(`Strudel code generated from: "${prompt}"`);
    } catch (e) {
      setStatusText(e instanceof Error ? e.message : "Strudel generation failed.");
    } finally {
      strudelBusyRef.current = false;
      setStrudelGenerating(false);
    }
  }, []);

  const generateNext = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      setStatusText("Generating…");

      const snap = strudelStateRef.current;
      const response = await fetch(`/api/sessions/${sessionId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strudelCode: snap?.code ?? null,
          strudelBpm: snap?.bpm ?? null,
          strudelCps: snap?.cps ?? null,
          strudelIsPlaying: snap?.isPlaying ?? false,
        }),
      });
      const body = (await response.json()) as {
        jobId?: string;
        status?: string;
        iterationId?: string;
        audioUrl?: string;
        error?: string;
      };
      if (!response.ok || !body.audioUrl || !body.iterationId) {
        throw new Error(body.error || "Failed to start generation");
      }

      setAudioSrc(body.audioUrl);
      setSelectedIterationId(body.iterationId);
      await refreshIterations(body.iterationId);
      setStatusText("Generated.");
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
      setBusy(false);
    }
  }, [sessionId]);

  const pickSoundtrack = useCallback(
    (id: string) => {
      const track = SOUNDTRACKS.find((t) => t.id === id) ?? SOUNDTRACKS[0];
      if (!track) return;
      setSelectedSoundtrackId(track.id);
      setSelectedIterationId(null);
      setAudioSrc(track.src);
      setStatusText(`Loaded soundtrack: ${track.name}`);
    },
    []
  );

  const playIteration = useCallback(
    async (entry: IterationEntry) => {
      setSelectedIterationId(entry.iterationId);
      setAudioSrc(entry.audioUrl);
      setStatusText("Loaded iteration.");
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = 0;
      try {
        await el.play();
      } catch {
        // Autoplay policies might block; user can hit play manually.
      }
    },
    []
  );

  const cycleSoundtrack = useCallback(
    (direction: "next" | "prev") => {
      if (SOUNDTRACKS.length === 0) return null;
      const currentIndex = Math.max(
        0,
        SOUNDTRACKS.findIndex((track) => track.id === selectedSoundtrackId)
      );
      const delta = direction === "next" ? 1 : -1;
      const nextIndex = (currentIndex + delta + SOUNDTRACKS.length) % SOUNDTRACKS.length;
      const nextTrack = SOUNDTRACKS[nextIndex];
      pickSoundtrack(nextTrack.id);
      return nextTrack;
    },
    [pickSoundtrack, selectedSoundtrackId]
  );

  const renderMixdownNow = useCallback(
    async (reason: "ended" | "stopped") => {
      try {
        setMixingBusy(true);
        setMixingEnabled(false);
        mixingEnabledRef.current = false;
        setMixingError(null);
        setStatusText(reason === "ended" ? "Rendering mixdown…" : "Stopping + rendering mixdown…");

        const sourceUrl = mixSourceUrlRef.current;
        if (!sourceUrl) throw new Error("Missing source track for mixdown.");
        const samples = mixSamplesRef.current;
        if (!samples || samples.length === 0) throw new Error("No hands telemetry captured for mixdown.");

        const { wav } = await renderHandsMixdownWav({ sourceUrl, samples });
        const url = URL.createObjectURL(wav);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `mixdown_${stamp}.wav`;
        setMixdowns((prev) => [
          { id: crypto.randomUUID(), createdAt: new Date().toISOString(), url, filename, sizeBytes: wav.size },
          ...prev
        ]);
        setStatusText("Mixdown ready.");
      } catch (e) {
        setMixingError(e instanceof Error ? e.message : "Mixdown failed");
        setStatusText("Mixdown failed.");
      } finally {
        setMixingBusy(false);
      }
    },
    []
  );

  const startMixing = useCallback(async () => {
    try {
      setMixingError(null);
      setMixingBusy(false);
      mixSamplesRef.current = [];
      mixSourceUrlRef.current = audioSrc;
      setMixingEnabled(true);
      mixingEnabledRef.current = true;
      setStatusText("Mixing… (hands gestures will be captured)");

      const el = audioEl;
      if (!el) return;
      el.currentTime = 0;
      await el.play().catch(() => {
        // Autoplay policies might block; user can hit play manually.
      });
    } catch (e) {
      setMixingError(e instanceof Error ? e.message : "Failed to start mixing");
      setMixingEnabled(false);
      mixingEnabledRef.current = false;
    }
  }, [audioEl, audioSrc]);

  const stopMixing = useCallback(() => {
    if (!mixingEnabledRef.current) return;
    void renderMixdownNow("stopped");
  }, [renderMixdownNow]);

  const onMixdownSample = useCallback((payload: Record<string, unknown>) => {
    if (!mixingEnabledRef.current) return;
    const trackTimeSec = typeof payload.trackTimeSec === "number" ? payload.trackTimeSec : null;
    if (trackTimeSec == null || !Number.isFinite(trackTimeSec)) return;
    mixSamplesRef.current.push({
      trackTimeSec,
      tempoRate: typeof payload.tempoRate === "number" ? payload.tempoRate : undefined,
      volumeGain: typeof payload.volumeGain === "number" ? payload.volumeGain : undefined,
      delayMix01: typeof payload.delayMix01 === "number" ? payload.delayMix01 : undefined,
      delayTimeSec: typeof payload.delayTimeSec === "number" ? payload.delayTimeSec : undefined,
      delayFeedback: typeof payload.delayFeedback === "number" ? payload.delayFeedback : undefined,
      reverbMix01: typeof payload.reverbMix01 === "number" ? payload.reverbMix01 : undefined
    });
  }, []);

  useEffect(() => {
    if (!audioEl) return;
    const onEnded = () => {
      if (!mixingEnabledRef.current) return;
      void renderMixdownNow("ended");
    };
    audioEl.addEventListener("ended", onEnded);
    return () => audioEl.removeEventListener("ended", onEnded);
  }, [audioEl, renderMixdownNow]);

  const handleVoiceCommand = useCallback(
    async (command: VoiceCommand, rawText: string): Promise<VoiceCommandResult> => {
      const audioElement = audioEl;
      const nowReady = Boolean(audioElement);

      switch (command.type) {
        case "play": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          audioElement.muted = false;
          if (audioElement.volume === 0) audioElement.volume = 1;
          try {
            await audioElement.play();
            return { ok: true, message: "Playing audio." };
          } catch {
            return { ok: false, message: "Play blocked. Click the player once to enable audio." };
          }
        }
        case "pause": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          audioElement.pause();
          return { ok: true, message: "Paused audio." };
        }
        case "toggle": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          if (audioElement.paused) {
            try {
              await audioElement.play();
              return { ok: true, message: "Playing audio." };
            } catch {
              return { ok: false, message: "Play blocked. Click the player once to enable audio." };
            }
          }
          audioElement.pause();
          return { ok: true, message: "Paused audio." };
        }
        case "restart": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          audioElement.currentTime = 0;
          return { ok: true, message: "Restarted track." };
        }
        case "mute": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          audioElement.muted = true;
          return { ok: true, message: "Muted audio." };
        }
        case "unmute": {
          if (!audioElement) return { ok: false, message: "Audio player not ready yet." };
          audioElement.muted = false;
          if (audioElement.volume === 0) audioElement.volume = 1;
          return { ok: true, message: "Unmuted audio." };
        }
        case "startMixing": {
          void startMixing();
          return { ok: true, message: "Starting mix capture." };
        }
        case "stopMixing": {
          stopMixing();
          return { ok: true, message: "Stopping mix and rendering." };
        }
        case "generateNext": {
          void generateNext();
          return { ok: true, message: "Generating next iteration." };
        }
        case "captureOn": {
          setCaptureEnabled(true);
          return { ok: true, message: "Capture enabled." };
        }
        case "captureOff": {
          setCaptureEnabled(false);
          return { ok: true, message: "Capture disabled." };
        }
        case "replOpen": {
          setStrudelOpen(true);
          return { ok: true, message: "Strudel REPL opened." };
        }
        case "replClose": {
          setStrudelOpen(false);
          return { ok: true, message: "Strudel REPL closed." };
        }
        case "strudelPlay": {
          strudelIframeRef.current?.contentWindow?.postMessage({ type: "strudel:play" }, "*");
          return { ok: true, message: "Strudel playing." };
        }
        case "strudelStop": {
          strudelIframeRef.current?.contentWindow?.postMessage({ type: "strudel:stop" }, "*");
          return { ok: true, message: "Strudel stopped." };
        }
        case "strudelGenerate": {
          void generateStrudelFromVoice(command.prompt);
          return {
            ok: true,
            message: command.prompt
              ? `Generating Strudel code for: "${command.prompt}"`
              : "Strudel listening — say what you want.",
          };
        }
        case "nextTrack": {
          const track = cycleSoundtrack("next");
          return { ok: Boolean(track), message: track ? `Loaded ${track.name}.` : "No soundtrack available." };
        }
        case "prevTrack": {
          const track = cycleSoundtrack("prev");
          return { ok: Boolean(track), message: track ? `Loaded ${track.name}.` : "No soundtrack available." };
        }
        default: {
          return { ok: false, message: `Unhandled command: ${rawText}` };
        }
      }
    },
    [audioEl, cycleSoundtrack, generateNext, generateStrudelFromVoice, setCaptureEnabled, setStrudelOpen, startMixing, stopMixing]
  );

  return (
    <div className={`landingRoot${strudelOpen ? " strudelActive" : ""}`}>
      <WebGLShader getLevel={getLevel} getPitch={getPitch} />

      <DAWLayout
        topBar={<TopBar />}
        sidebar={
          sidebarOpen ? (
          <div className="flex flex-col gap-4 p-4">
            {/* Session Info */}
            <div className="flex flex-col gap-2">
              <h1 className="font-heading text-lg font-extrabold tracking-tight text-text">
                Studio Session ID
              </h1>
              <Badge variant="secondary" className="w-fit font-mono text-[10px]">
                {sessionId}
              </Badge>
            </div>

            {/* Nav Links */}
            <nav className="flex flex-col gap-1">
              <Link
                href="/studio"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-text-muted no-underline transition-colors hover:bg-white/[0.06] hover:text-text"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Link>
              <Link
                href="/"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-text-muted no-underline transition-colors hover:bg-white/[0.06] hover:text-text"
              >
                <Home className="h-3.5 w-3.5" />
                Home
              </Link>
            </nav>

            {/* Voice Commands Help */}
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHelpOpen((p) => !p)}
                className="flex items-center gap-2 justify-start text-xs font-semibold text-text-muted hover:text-text"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Voice Commands
              </Button>
              {helpOpen && (
                <div className="rounded-lg border border-border-subtle bg-surface/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-text">Voice Commands</span>
                    <button onClick={() => setHelpOpen(false)} className="p-0.5 rounded hover:bg-white/[0.06] cursor-pointer">
                      <X className="h-3 w-3 text-text-muted" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 text-[11px] text-text-muted">
                    <div><span className="text-primary font-semibold">&quot;compose [prompt]&quot;</span> — AI generate Strudel code</div>
                    <div><span className="text-primary font-semibold">&quot;compose open/close&quot;</span> — toggle composer</div>
                    <div><span className="text-primary font-semibold">&quot;compose play/start&quot;</span> — play Strudel</div>
                    <div><span className="text-primary font-semibold">&quot;compose stop/pause&quot;</span> — stop Strudel</div>
                    <div><span className="text-primary font-semibold">&quot;play&quot; / &quot;pause&quot;</span> — playback control</div>
                    <div><span className="text-primary font-semibold">&quot;restart&quot;</span> — restart track</div>
                    <div><span className="text-primary font-semibold">&quot;mute&quot; / &quot;unmute&quot;</span> — toggle mute</div>
                    <div><span className="text-primary font-semibold">&quot;next/previous track&quot;</span> — switch tracks</div>
                    <div><span className="text-primary font-semibold">&quot;generate&quot;</span> — generate next iteration</div>
                    <div><span className="text-primary font-semibold">&quot;start/stop mixing&quot;</span> — mix capture</div>
                    <div><span className="text-primary font-semibold">&quot;capture on/off&quot;</span> — telemetry capture</div>
                  </div>
                </div>
              )}
            </div>

            {/* Directions */}
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDirectionsOpen((p) => !p)}
                className="flex items-center gap-2 justify-start text-xs font-semibold text-text-muted hover:text-text"
              >
                <Hand className="h-3.5 w-3.5" />
                Directions
              </Button>
              {directionsOpen && (
                <div className="rounded-lg border border-border-subtle bg-surface/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-text">Directions</span>
                    <button onClick={() => setDirectionsOpen(false)} className="p-0.5 rounded hover:bg-white/[0.06] cursor-pointer">
                      <X className="h-3 w-3 text-text-muted" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 text-[11px] text-text-muted">
                    <div>Start audio in Player, then enable Hands.</div>
                    <div>Tempo: left-side hand up/down.</div>
                    <div>Volume: right-side hand up/down.</div>
                    <div>Pinch left hand = Echo/Delay.</div>
                    <div>Pinch right hand = Reverb.</div>
                  </div>
                </div>
              )}
            </div>

            {/* Iteration History */}
            <IterationHistory
              iterations={iterations}
              selectedIterationId={selectedIterationId}
              onSelect={(id) => setSelectedIterationId(id)}
              onPlay={playIteration}
            />
            {historyBusy && <div className="text-xs text-text-dim">Loading iterations…</div>}
            {historyError && <div className="text-xs text-destructive">{historyError}</div>}
          </div>
          ) : null
        }
        main={
          <div className="flex flex-col gap-6">
            {/* Status Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((p) => !p)} className="h-8 w-8 p-0" title="Toggle Sidebar">
                  <PanelLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-muted">{statusText}</span>
              </div>
              {error ? <span className="text-sm text-destructive">Error: {error}</span> : null}
            </div>

            {/* Hands Controller */}
            <HandsStudioController
              sessionId={sessionId}
              audioEl={audioEl}
              captureEnabled={captureEnabled}
              captureStatus={captureStatus}
              onCaptureChange={setCaptureEnabled}
              mixdownEnabled={mixingEnabled}
              onMixdownSample={onMixdownSample}
              strudelIframeRef={strudelIframeRef}
              strudelOpen={strudelOpen}
              voiceAgent={<StudioVoiceAgent onCommand={handleVoiceCommand} />}
            />
          </div>
        }
        rightPanel={
          <div className="flex flex-col gap-6 p-6">
            {/* Player */}
            <StudioPlayer ref={setPlayerRef} src={audioSrc} />

            {/* Generate Button */}
            <Button size="lg" onClick={generateNext} disabled={busy} className="w-full">
              <Zap className="h-4 w-4" />
              {busy ? "Generating…" : "Generate Next"}
            </Button>

            {/* Soundtracks Section */}
            <section className="flex flex-col gap-3">
              <h3 className="font-heading text-sm font-bold tracking-tight text-text">
                <Radio className="mr-2 inline-block h-4 w-4 text-primary" />
                Soundtracks
              </h3>
              <div className="flex flex-col gap-3">
                {SOUNDTRACKS.map((t) => {
                  const active = t.id === selectedSoundtrackId && !selectedIterationId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`glass-card cursor-pointer rounded-xl border p-4 text-left transition-all duration-200 hover:border-border-bright ${
                        active
                          ? "border-primary/30 bg-primary-dim"
                          : "border-border-subtle bg-surface/40"
                      }`}
                      onClick={() => pickSoundtrack(t.id)}
                    >
                      <div className="font-bold text-sm text-text">{t.name}</div>
                      <div className="text-text-muted text-xs mt-1">{t.description}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Mixdown (does not create a new iteration) */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-sm font-bold tracking-tight text-text">
                  <Music className="mr-2 inline-block h-4 w-4 text-primary" />
                  Mixdown
                </h3>
                <Badge
                  variant={
                    mixingStatus === "Mixing"
                      ? "accent"
                      : mixingStatus === "Rendering"
                        ? "secondary"
                        : "outline"
                  }
                  className="w-fit"
                  title="Captures your hands gestures during playback and bakes them into a downloadable WAV when the track ends"
                >
                  Mix: {mixingStatus}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={startMixing} disabled={mixingEnabled || mixingBusy}>
                  Start mixing track
                </Button>
                <Button size="sm" variant="ghost" onClick={stopMixing} disabled={!mixingEnabled || mixingBusy}>
                  Stop & Render
                </Button>
              </div>
              {mixingError && <div className="text-xs text-destructive">Mixdown error: {mixingError}</div>}
              {mixdowns.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-text-muted">Downloads</div>
                  {mixdowns.slice(0, 3).map((m) => (
                    <div
                      key={m.id}
                      className="glass-card rounded-xl border border-border-subtle bg-surface/40 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-text">{m.filename}</div>
                          <div className="text-[11px] text-text-dim">
                            {(m.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                        <a
                          className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-bg no-underline transition-all hover:brightness-110 active:scale-[0.98]"
                          href={m.url}
                          download={m.filename}
                        >
                          Download
                        </a>
                      </div>
                      <audio className="mt-3 w-full" controls preload="metadata" src={m.url} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Feedback Panel */}
            <FeedbackPanel onSubmit={submitFeedback} disabled={busy} />
          </div>
        }
        bottomDrawer={
          <div className={`strudelDrawer${strudelOpen ? " strudelDrawerOpen" : ""}`}>
            {/* Embedded Toggle Tab */}
            <button
              onClick={() => setStrudelOpen((prev) => !prev)}
              className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full z-[110] flex items-center gap-2.5 rounded-t-2xl rounded-b-none border border-b-0 border-primary/40 bg-surface/95 px-10 py-3 text-sm font-bold tracking-wide text-primary shadow-[0_-4px_20px_rgba(0,255,136,0.12)] backdrop-blur-md transition-all hover:bg-primary/15 hover:border-primary hover:text-white cursor-pointer"
              aria-label={strudelOpen ? "Close Live Composer" : "Launch Live Composer"}
            >
              <Code className="h-5 w-5" />
              {strudelOpen ? "Close Composer" : "Launch Composer"}
            </button>

            <div className="strudelDrawerHandle" onClick={() => setStrudelOpen(false)}>
              <span className="strudelDrawerGrip" />
            </div>
            {strudelGenerating && (
              <div className="absolute top-0 left-0 right-0 z-[120] flex items-center gap-2 bg-surface/90 backdrop-blur-sm px-4 py-2 border-b border-primary/30">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs font-semibold text-primary">Generating Strudel code...</span>
                <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-full bg-primary/60 rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                </div>
              </div>
            )}
            <div className="strudelDrawerContent">
              <iframe
                ref={strudelIframeRef}
                className="strudelFrame"
                src="/strudel/embed/index.html"
                allow="autoplay; microphone"
                title="Strudel REPL"
              />
              <StrudelAIPanel iframeRef={strudelIframeRef} />
            </div>
          </div>
        }
      />
    </div>
  );
}
