"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Check, AlertCircle } from "lucide-react";

export type FeedbackPayload = {
  note: string;
};

type Props = {
  onSubmit: (payload: FeedbackPayload) => Promise<void>;
  disabled?: boolean;
};

export default function FeedbackPanel({ onSubmit, disabled }: Props) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef("");

  useEffect(() => {
    if (disabled) return;
    const trimmed = note.trim();
    if (trimmed === lastSavedRef.current) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(async () => {
      try {
        setBusy(true);
        setError(null);
        setOk(null);
        await onSubmit({ note: trimmed });
        lastSavedRef.current = trimmed;
        setOk("Saved.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save notes");
      } finally {
        setBusy(false);
      }
    }, 600);
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, [disabled, note, onSubmit]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm font-bold text-text">User Notes</h3>
      </div>
      <p className="text-xs text-text-muted">
        Add any additional information for increased specificity.
      </p>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. punchier kick, wider pads, slower tempo..."
        rows={3}
        disabled={disabled || busy}
      />

      <div className="flex items-center gap-3">
        {busy && <span className="text-xs text-text-muted">Saving…</span>}
        {ok && (
          <span className="flex items-center gap-1 text-xs text-secondary">
            <Check className="h-3 w-3" /> {ok}
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
