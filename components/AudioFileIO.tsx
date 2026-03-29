"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, AlertCircle } from "lucide-react";

type Props = {
  title?: string;
  getAudioEl?: () => HTMLAudioElement | null;
  currentSrc?: string;
  defaultLabel?: string;
  onSetSrc?: (src: string, meta: { kind: "file" | "url"; name?: string }) => void;
};

function safeFilename(name: string) {
  return name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
}

export default function AudioFileIO({
  title = "Audio",
  getAudioEl,
  currentSrc,
  defaultLabel = "current",
  onSetSrc
}: Props) {
  const objectUrlRef = useRef<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>(defaultLabel);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  const onPickFile = useCallback(
    (file: File) => {
      setError(null);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;

      const audioEl = getAudioEl?.() ?? null;
      if (audioEl) {
        audioEl.src = objectUrl;
        audioEl.load();
      }

      setFileLabel(file.name);
      onSetSrc?.(objectUrl, { kind: "file", name: file.name });
    },
    [getAudioEl, onSetSrc]
  );

  const download = useCallback(() => {
    try {
      setError(null);
      const audioEl = getAudioEl?.() ?? null;
      const src = (audioEl?.currentSrc || audioEl?.src || currentSrc || "").trim();
      if (!src) throw new Error("No audio source to download.");

      const filenameBase =
        fileLabel && fileLabel !== defaultLabel ? fileLabel : `${title.toLowerCase()}-audio.wav`;
      const filename = safeFilename(filenameBase);

      const a = document.createElement("a");
      a.href = src;
      a.download = filename;
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }, [currentSrc, defaultLabel, fileLabel, getAudioEl, title]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted">{title}</span>
        <span className="text-xs text-text-dim">{fileLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" asChild>
          <label className="cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            Upload
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPickFile(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </Button>
        <Button variant="ghost" size="sm" onClick={download}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" /> {error}
        </div>
      )}
    </div>
  );
}
