"use client";

import { useCallback, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, AlertCircle } from "lucide-react";

type Props = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
};

export default function StrudelAIPanel({ iframeRef }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const injectCode = useCallback(
    (code: string) => {
      let tries = 0;
      const send = () => {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage({ type: "strudel:setCode", code }, "*");
          return;
        }
        if (tries < 10) {
          tries += 1;
          setTimeout(send, 200);
        }
      };
      send();
    },
    [iframeRef]
  );

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/strudel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Generation failed.");
        return;
      }

      setPrompt("");
      injectCode(data.code);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, injectCode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="hidden md:flex w-[320px] flex-shrink-0 flex-col border-l border-border-subtle bg-surface/60 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold text-text">AI Composer</span>
      </div>

      {/* Prompt area fills the panel */}
      <div className="flex-1 flex flex-col p-4 gap-3">
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-400">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your music..."
          className="flex-1 resize-none bg-bg/80 border-border-subtle text-sm text-text placeholder:text-text-muted/60"
          disabled={loading}
        />
        <Button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="w-full gap-2"
          size="sm"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {loading ? "Generating..." : "AI Run"}
        </Button>
      </div>
    </div>
  );
}
