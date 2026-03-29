"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Radio } from "lucide-react";

export type VoiceCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "restart" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "startMixing" }
  | { type: "stopMixing" }
  | { type: "generateNext" }
  | { type: "captureOn" }
  | { type: "captureOff" }
  | { type: "replOpen" }
  | { type: "replClose" }
  | { type: "strudelPlay" }
  | { type: "strudelStop" }
  | { type: "nextTrack" }
  | { type: "prevTrack" }
  | { type: "strudelGenerate"; prompt: string };

export type VoiceCommandResult = {
  ok: boolean;
  message: string;
};

type Props = {
  onCommand: (command: VoiceCommand, rawText: string) => Promise<VoiceCommandResult> | VoiceCommandResult;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: Array<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  if (/windows/i.test(navigator.userAgent)) return null;
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

const COMPOSE_WAKE_RE = /\bcompose\b/i;

function extractComposePrompt(text: string): string | null {
  const match = text.match(COMPOSE_WAKE_RE);
  if (!match) return null;
  const after = text.slice(match.index! + match[0].length).trim();
  if (/^(open|close|play|start|stop|pause)$/i.test(after)) return null; // fall through to specific commands
  return after;
}

function parseVoiceCommand(raw: string): VoiceCommand | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;

  const composePrompt = extractComposePrompt(text);
  if (composePrompt !== null) {
    return { type: "strudelGenerate", prompt: composePrompt };
  }

  if (/\b(stop mixing|render mixdown|finish mixing)\b/.test(text)) return { type: "stopMixing" };
  if (/\b(start mixing|begin mixing|mixdown start|mix down)\b/.test(text)) return { type: "startMixing" };

  if (/\b(capture on|start capture|arm capture|enable capture)\b/.test(text)) return { type: "captureOn" };
  if (/\b(capture off|stop capture|disarm capture|disable capture)\b/.test(text)) return { type: "captureOff" };

  if (/\b(generate|next (iteration|version|take)|make another)\b/.test(text)) return { type: "generateNext" };

  if (/\b(compose open|open composer|open repl|open strudel|show repl)\b/.test(text)) return { type: "replOpen" };
  if (/\b(compose close|close composer|close repl|hide repl)\b/.test(text)) return { type: "replClose" };
  if (/\b(compose play|compose start)\b/.test(text)) return { type: "strudelPlay" };
  if (/\b(compose stop|compose pause)\b/.test(text)) return { type: "strudelStop" };

  if (/\bnext (track|song|soundtrack)\b/.test(text)) return { type: "nextTrack" };
  if (/\b(prev|previous) (track|song|soundtrack)\b/.test(text)) return { type: "prevTrack" };

  if (/\bunmute|sound on|enable sound\b/.test(text)) return { type: "unmute" };
  if (/\bmute\b/.test(text)) return { type: "mute" };

  if (/\b(restart|start over|from the beginning|from beginning)\b/.test(text)) return { type: "restart" };

  if (/\b(toggle)\b/.test(text)) return { type: "toggle" };
  if (/\b(play|resume|continue)\b/.test(text)) return { type: "play" };
  if (/\b(pause|stop)\b/.test(text)) return { type: "pause" };

  return null;
}

export default function StudioVoiceAgent({ onCommand }: Props) {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const listeningRef = useRef(false);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [lastFinalText, setLastFinalText] = useState("");
  const [lastAction, setLastAction] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const execCommand = useCallback(
    async (text: string) => {
      const command = parseVoiceCommand(text);
      if (!command) {
        setLastAction(`No command recognized from: "${text}"`);
        return;
      }
      try {
        const result = await onCommand(command, text);
        setLastAction(result.message);
      } catch (e) {
        setLastAction(e instanceof Error ? e.message : "Command failed");
      }
    },
    [onCommand]
  );

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim) setInterimText(interim.trim());
      if (finalText.trim()) {
        const cleaned = finalText.trim();
        setLastFinalText(cleaned);
        setInterimText("");
        void execCommand(cleaned);
      }
    };

    recognition.onerror = (event) => {
      setError(event.error || "Speech recognition error");
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore restart errors
        }
      }
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [execCommand]);

  const startListening = useCallback(() => {
    setError(null);
    setInterimText("");
    setListening(true);
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("Speech recognition not available on this device.");
      setListening(false);
      return;
    }
    try {
      recognition.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start microphone");
    }
  }, []);

  const stopListening = useCallback(() => {
    setListening(false);
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  }, []);

  const statusBadge = useMemo(() => {
    if (!supported) return { text: "Unsupported", variant: "outline" as const };
    if (listening) return { text: "Listening", variant: "accent" as const };
    return { text: "Idle", variant: "secondary" as const };
  }, [listening, supported]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm font-bold tracking-tight text-text">Voice Agent</h3>
        <Badge className="ml-auto" variant={statusBadge.variant}>
          {statusBadge.text}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={listening ? "secondary" : "default"} onClick={listening ? stopListening : startListening} disabled={!supported}>
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {listening ? "Stop Listening" : "Start Listening"}
        </Button>
      </div>

      {!supported && (
        <div className="text-xs text-text-muted">
          Speech recognition not supported in this browser.
        </div>
      )}

      {error && <div className="text-xs text-destructive">Voice error: {error}</div>}

      <div className="grid gap-1 text-xs text-text-muted">
        <div>Heard: {interimText ? `“${interimText}”` : lastFinalText ? `“${lastFinalText}”` : "—"}</div>
        <div>Action: {lastAction}</div>
      </div>
    </section>
  );
}
