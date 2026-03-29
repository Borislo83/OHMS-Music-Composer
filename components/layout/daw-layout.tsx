"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface DAWLayoutProps {
  topBar?: React.ReactNode;
  sidebar?: React.ReactNode;
  main: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomDrawer?: React.ReactNode;
  className?: string;
}

export function DAWLayout({
  topBar,
  sidebar,
  main,
  rightPanel,
  bottomDrawer,
  className,
}: DAWLayoutProps) {
  return (
    <div className={cn("flex h-screen flex-col overflow-hidden bg-transparent z-10 relative", className)}>
      {/* Top Bar */}
      {topBar}

      {/* Main Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {sidebar && (
          <aside className="flex w-[260px] flex-shrink-0 flex-col border-r border-border-subtle bg-bg/50 backdrop-blur-md overflow-y-auto">
            {sidebar}
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 relative z-10">
          {main}
        </main>

        {/* Right Panel */}
        {rightPanel && (
          <aside className="flex w-[320px] flex-shrink-0 flex-col border-l border-border-subtle bg-bg/50 backdrop-blur-md overflow-y-auto">
            {rightPanel}
          </aside>
        )}
      </div>

      {/* Bottom Drawer */}
      {bottomDrawer}
    </div>
  );
}
