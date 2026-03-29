"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "@/components/layout/top-bar";
import { ParticleBackground } from "@/components/backgrounds/particle-background";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, ArrowRight, Sparkles } from "lucide-react";

export default function StudioIndexPage() {
  const router = useRouter();
  const [title, setTitle] = useState("Sonic Synthesis Session");
  const [joinId, setJoinId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);

      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const body = (await response.json()) as { sessionId?: string; error?: string };
      if (!response.ok || !body.sessionId) {
        throw new Error(body.error || "Failed to create session");
      }

      router.push(`/studio/${body.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setBusy(false);
    }
  }, [router, title]);

  const onJoin = useCallback(() => {
    const id = joinId.trim();
    if (!id) return;
    router.push(`/studio/${id}`);
  }, [joinId, router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <ParticleBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar />

        <main className="flex flex-1 items-center justify-center px-6 py-16">
          <div className="w-full max-w-[900px]">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-10 text-center"
            >
              <h1 className="font-heading text-4xl font-black tracking-tight text-text">
                Studio
              </h1>
              <p className="mt-2 text-sm text-text-muted">
                Create a new session or join an existing one to start making music.
              </p>
            </motion.div>

            {/* Cards Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Create Session */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <GlassPanel className="p-6">
                  <div className="mb-1 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Plus className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="font-heading text-lg font-bold text-text">
                      Create Session
                    </h2>
                  </div>
                  <p className="mb-5 text-xs text-text-muted">
                    Start a new collaborative workspace for music generation.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-text-muted">
                        Session Title
                      </label>
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="My awesome session..."
                      />
                    </div>
                    <Button
                      onClick={createSession}
                      disabled={busy}
                      className="w-full"
                      size="lg"
                    >
                      <Sparkles className="h-4 w-4" />
                      {busy ? "Creating..." : "Create Session"}
                    </Button>
                  </div>
                </GlassPanel>
              </motion.div>

              {/* Join Session */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <GlassPanel className="p-6">
                  <div className="mb-1 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tertiary/10">
                      <ArrowRight className="h-5 w-5 text-tertiary" />
                    </div>
                    <h2 className="font-heading text-lg font-bold text-text">
                      Join Session
                    </h2>
                  </div>
                  <p className="mb-5 text-xs text-text-muted">
                    Paste a session ID to jump into an existing workspace.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-text-muted">
                        Session ID
                      </label>
                      <Input
                        value={joinId}
                        onChange={(e) => setJoinId(e.target.value)}
                        placeholder="Paste session ID..."
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={onJoin}
                      disabled={!joinId.trim()}
                      className="w-full"
                      size="lg"
                    >
                      <ArrowRight className="h-4 w-4" />
                      Join Session
                    </Button>
                  </div>
                </GlassPanel>
              </motion.div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 rounded-xl border border-destructive/30 bg-destructive-dim px-4 py-3 text-sm text-destructive"
              >
                {error}
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
