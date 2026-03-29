"use client";

import { TopBar } from "@/components/layout/top-bar";

export default function StrudelPage() {
  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar />
      <div className="flex items-center gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="font-heading text-sm font-bold text-text">Strudel Live Coding</h1>
        <span className="text-xs text-text-muted">Interactive music programming environment</span>
      </div>
      <iframe
        src="/strudel/index.html"
        className="flex-1 border-none"
        title="Strudel Workspace"
        allow="autoplay; microphone"
      />
    </div>
  );
}
