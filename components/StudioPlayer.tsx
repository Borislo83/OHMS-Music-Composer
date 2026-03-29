"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Volume2 } from "lucide-react";

type Props = {
  src: string;
};

function setRef<T>(ref: React.ForwardedRef<T>, value: T) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as React.MutableRefObject<T>).current = value;
}

const StudioPlayer = forwardRef<HTMLAudioElement, Props>(function StudioPlayer({ src }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedOnce, setHasStartedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wantsPlayingRef = useRef(false);

  const mergedRef = useCallback(
    (node: HTMLAudioElement | null) => {
      audioRef.current = node;
      setRef(ref, node as unknown as HTMLAudioElement);
    },
    [ref]
  );

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const onPlay = () => {
      wantsPlayingRef.current = true;
      setHasStartedOnce(true);
      setIsPlaying(true);
    };
    const onPause = () => {
      wantsPlayingRef.current = false;
      setIsPlaying(false);
    };
    const onEnded = () => {
      wantsPlayingRef.current = false;
      setIsPlaying(false);
    };
    const onVolume = () => setIsMuted(audioEl.muted || audioEl.volume === 0);

    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    audioEl.addEventListener("ended", onEnded);
    audioEl.addEventListener("volumechange", onVolume);
    onVolume();
    setIsPlaying(!audioEl.paused);

    return () => {
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
      audioEl.removeEventListener("ended", onEnded);
      audioEl.removeEventListener("volumechange", onVolume);
    };
  }, []);

  const enableSound = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    try {
      setError(null);
      setNeedsGesture(false);
      audioEl.muted = false;
      audioEl.volume = 1;
      wantsPlayingRef.current = true;
      await audioEl.play();
      setIsPlaying(true);
      setHasStartedOnce(true);
    } catch (e) {
      setNeedsGesture(true);
      setError(e instanceof Error ? e.message : "Autoplay was blocked");
    }
  }, []);


  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (!hasStartedOnce) return;
    if (!wantsPlayingRef.current) return;

    const resume = async () => {
      try {
        setError(null);
        setNeedsGesture(false);
        await audioEl.play();
        setIsPlaying(true);
      } catch {
        setNeedsGesture(true);
      }
    };

    void resume();
  }, [hasStartedOnce, src]);

  const toggle = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    try {
      setError(null);
      if (audioEl.paused) {
        if (!hasStartedOnce || audioEl.muted || needsGesture) {
          await enableSound();
          return;
        }
        wantsPlayingRef.current = true;
        await audioEl.play();
        setIsPlaying(true);
      } else {
        wantsPlayingRef.current = false;
        audioEl.pause();
        setIsPlaying(false);
      }
    } catch (e) {
      setNeedsGesture(true);
      setError(e instanceof Error ? e.message : "Failed to start audio");
    }
  }, [enableSound, hasStartedOnce, needsGesture]);

  const status = useMemo(() => {
    if (error) return error;
    if (!hasStartedOnce) return "";
    if (needsGesture) return "Playback blocked — click Enable Audio.";
    if (isMuted) return "Muted — click Enable Audio for sound.";
    return isPlaying ? "Playing" : "Paused";
  }, [error, hasStartedOnce, isMuted, isPlaying, needsGesture]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm font-bold text-text">Player</h3>
        <span className="ml-auto text-xs text-text-muted">{status}</span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={toggle}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isPlaying ? "Pause" : "Play"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const audioEl = audioRef.current;
            if (!audioEl) return;
            audioEl.currentTime = 0;
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restart
        </Button>
      </div>

      <audio
        ref={mergedRef}
        controls
        preload="metadata"
        src={src}
        className="w-full rounded-xl"
        playsInline
        crossOrigin="anonymous"
      />
    </div>
  );
});

export default StudioPlayer;
