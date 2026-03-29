"use client";

import { cn } from "@/lib/utils";
import { History, Music, Play, Download } from "lucide-react";

export type IterationEntry = {
  iterationId: string;
  audioUrl: string;
  createdAt?: string | null;
  idx?: number | null;
  filename?: string | null;
  mimeType?: string | null;
};

type Props = {
  iterations: IterationEntry[];
  selectedIterationId: string | null;
  onSelect: (iterationId: string) => void;
  onPlay?: (entry: IterationEntry) => void;
};

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function formatStamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default function IterationHistory({
  iterations,
  selectedIterationId,
  onSelect,
  onPlay
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm font-bold text-text">History</h3>
      </div>

      {iterations.length === 0 ? (
        <p className="text-xs text-text-muted">
          No iterations yet. Click &quot;Generate Next&quot;.
        </p>
      ) : (
        <div className="space-y-1.5">
          {iterations.map((it) => {
            const isSelected = it.iterationId === selectedIterationId;
            const stamp = formatStamp(it.createdAt);
            const filename = it.filename?.trim() || `iteration-${shortId(it.iterationId)}.audio`;
            return (
              <div
                key={it.iterationId}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-all duration-150",
                  isSelected
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-transparent bg-white/[0.04] text-text-muted hover:bg-white/[0.08] hover:text-text"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(it.iterationId)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Music className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{shortId(it.iterationId)}</span>
                    {stamp && (
                      <span className="block truncate text-[11px] text-text-dim">
                        {stamp}
                      </span>
                    )}
                  </span>
                </button>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (onPlay ? onPlay(it) : onSelect(it.iterationId))}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text"
                    title="Play this iteration"
                  >
                    <Play className="h-3 w-3" />
                    Play
                  </button>
                  <a
                    href={it.audioUrl}
                    download={filename}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-bg no-underline transition-all hover:brightness-110 active:scale-[0.98]"
                    title={`Download ${filename}`}
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
