"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Music, Home, Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/studio", label: "Studio", icon: Sparkles },
];

export function TopBar() {
  const pathname = usePathname();
  const hideCreate = pathname.startsWith("/studio");
  const hideNav = pathname === "/" || pathname.startsWith("/studio");

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border-subtle bg-bg/80 backdrop-blur-[14px]">
      <div className="flex h-16 items-center justify-between px-8">
        {/* Brand */}
        <Link href="/" className="mr-auto flex items-center gap-3 no-underline">
          <Image src="/ohms-logo.png" alt="OHMS" width={36} height={36} className="rounded-md" />
          <span className="font-heading text-base font-extrabold tracking-tight text-text">
            OHMS
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1">
          {!hideNav &&
            NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold tracking-tight no-underline transition-all duration-200",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-white/[0.05] hover:text-text"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {!hideCreate && (
            <Link
              href="/studio"
              className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-bold text-bg no-underline shadow-[0_0_20px_rgba(0,255,136,0.2)] transition-all duration-200 hover:brightness-110"
            >
              <Music className="h-3.5 w-3.5" />
              Create
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
