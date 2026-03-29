"use client";

import { useEffect, useRef } from "react";

type Props = {
  getLevel: () => number;
  size?: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export default function RainbowBlobIcon({ getLevel, size = 92 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const center = { x: size / 2, y: size / 2 };
    const baseR = size * 0.33;
    const points = 84;

    const draw = (tMs: number) => {
      const t = tMs / 1000;
      const level = clamp01(getLevel());

      ctx.clearRect(0, 0, size, size);

      const wobble = (0.085 + 0.03 * Math.sin(t * 0.35)) + level * 0.22;
      const spin = t * (0.5 + level * 0.9);
      const hueBase = (140 + t * 10 + level * 40) % 360;
      const breathe = 1 + 0.04 * Math.sin(t * 0.65) + 0.02 * Math.sin(t * 1.1);

      const ctxWithConic = ctx as CanvasRenderingContext2D & {
        createConicGradient?: (startAngle: number, x: number, y: number) => CanvasGradient;
      };
      const gradient =
        typeof ctxWithConic.createConicGradient === "function"
          ? ctxWithConic.createConicGradient(spin, center.x, center.y)
          : ctx.createLinearGradient(0, 0, size, size);

      const stops = [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1];
      for (let i = 0; i < stops.length; i++) {
        const h = (hueBase + i * 18) % 360;
        gradient.addColorStop(stops[i], `hsl(${h} 82% ${52 + level * 6}%)`);
      }

      const angleStep = (Math.PI * 2) / points;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const a = i * angleStep;
        const n1 = Math.sin(a * 3 + t * 0.95 + level * 1.1);
        const n2 = Math.sin(a * 7 - t * 0.8);
        const n3 = Math.sin(a * 11 + t * 0.55);
        const n4 = Math.sin(a * 5 + t * 0.42 + Math.sin(t * 0.25) * 0.8);
        const n = (n1 * 0.45 + n2 * 0.25 + n3 * 0.12 + n4 * 0.18) * wobble;
        const r = baseR * breathe * (1 + n) * (1 + level * 0.12);
        const x = center.x + Math.cos(a) * r;
        const y = center.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      ctx.save();
      ctx.shadowColor = `hsla(${(hueBase + 20) % 360} 95% 70% / 0.4)`;
      ctx.shadowBlur = 14 + level * 10;
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `rgba(255,255,255,${0.22 + level * 0.12})`;
      ctx.lineWidth = 1.35;
      ctx.stroke();
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [getLevel, size]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
