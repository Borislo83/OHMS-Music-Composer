"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  getLevel: () => number;
  getPitch?: () => number;
  fragmentSource?: string;
  className?: string;
  onError?: (message: string) => void;
};

const vert = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const frag = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_pitch;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float r = length(p);
  float ang = atan(p.y, p.x);

  float lvl = clamp(u_level, 0.0, 1.0);
  float pit = clamp(u_pitch, 0.0, 1.0);
  float t = u_time * (0.18 + 0.34 * lvl + 0.12 * pit);

  // Background-only shader (no sphere): keep other pages calmer than the home hero.
  vec3 baseBg = vec3(0.02, 0.03, 0.05);

  float swirl =
    0.55
    + 0.35 * sin(r * 7.0 - t * (0.7 + 1.4 * pit))
    + 0.22 * sin(ang * 3.0 + t * (0.22 + 0.35 * lvl))
    + 0.18 * sin((p.x - p.y) * 8.0 - t * 0.32);
  swirl = clamp(swirl, 0.0, 1.0);

  float hueBase = fract(0.36 + 0.15 * pit + 0.02 * u_time + 0.06 * sin(ang * 2.0 + t * 0.2));
  vec3 aur = hsv2rgb(vec3(hueBase + 0.10 * swirl, 0.70, 1.0));

  vec3 col = baseBg + vec3(0.01, 0.012, 0.02) * swirl;

  float bands = 0.5 + 0.5 * sin((p.x * 1.2 + p.y * 0.8) * (10.0 + 10.0 * pit) + t * (0.9 + 1.3 * lvl));
  bands = pow(bands, 2.2);
  col += aur * bands * (0.04 + 0.10 * lvl);

  float radial = 0.5 + 0.5 * sin(r * (14.0 + 16.0 * pit) - t * (1.7 + 2.2 * lvl));
  radial = pow(radial, 2.5);
  col += aur * radial * (0.02 + 0.07 * pit);

  float vignette = smoothstep(1.15, 0.18, length(p * vec2(1.1, 0.92)));
  col *= 0.65 + 0.55 * vignette;

  // Tonemap to keep neon punch.
  col = col / (col + vec3(0.55));

  gl_FragColor = vec4(col, 1.0);
}
`;

function pickFloatPrecision(gl: WebGLRenderingContext) {
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (highp && highp.precision > 0) return "highp";
  return "mediump";
}

function normalizeFragmentPrecision(
  source: string,
  precision: "highp" | "mediump" | "lowp"
) {
  const hasPrecision = /precision\s+(highp|mediump|lowp)\s+float\s*;/.test(source);
  if (hasPrecision) {
    return source.replace(/precision\s+highp\s+float\s*;/, `precision ${precision} float;`);
  }
  return `precision ${precision} float;\n${source}`;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string) {
  const precision = pickFloatPrecision(gl);
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, normalizeFragmentPrecision(fsSource, precision));
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "Unknown link error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

export default function WebGLShader({
  getLevel,
  getPitch,
  fragmentSource,
  className,
  onError
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      setWebglOk(false);
      const msg = "WebGL is not supported or is disabled in this browser.";
      setWebglError(msg);
      onError?.(msg);
      return;
    }

    let program: WebGLProgram | null = null;
    try {
      program = createProgram(gl, vert, fragmentSource ?? frag);
    } catch (e) {
      setWebglOk(false);
      const msg = e instanceof Error ? e.message : "Unknown shader error";
      setWebglError(msg);
      // Surface useful diagnostics for shader compile/link failures.
      console.error("[WebGLShader] Failed to compile/link program:", msg);
      onError?.(msg);
      return;
    }

    const aPos = gl.getAttribLocation(program, "a_pos");
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uLevel = gl.getUniformLocation(program, "u_level");
    const uPitch = gl.getUniformLocation(program, "u_pitch");

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        3, -1,
        -1, 3
      ]),
      gl.STATIC_DRAW
    );

    gl.useProgram(program);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    const start = performance.now();
    const tick = (now: number) => {
      resize();
      const t = (now - start) / 1000;
      gl.uniform1f(uTime, t);
      gl.uniform1f(uLevel, getLevel());
      if (uPitch && getPitch) gl.uniform1f(uPitch, getPitch());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
    };
  }, [fragmentSource, getLevel, getPitch, onError]);

  if (!webglOk) {
    return (
      <>
        <div className={`bgFallback ${className ?? ""}`} aria-hidden="true" />
        <Canvas2DFallback getLevel={getLevel} getPitch={getPitch} className={className} />
        {webglError ? (
          <div
            style={{
              position: "fixed",
              left: 12,
              bottom: 12,
              zIndex: 3,
              maxWidth: 560,
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 12,
              lineHeight: 1.4,
              backdropFilter: "blur(10px)"
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>WebGL fallback active</div>
            <div style={{ opacity: 0.9 }}>{webglError}</div>
          </div>
        ) : null}
      </>
    );
  }

  return <canvas ref={canvasRef} className={`bgCanvas ${className ?? ""}`} aria-hidden="true" />;
}

function Canvas2DFallback({
  getLevel,
  getPitch,
  className
}: {
  getLevel: () => number;
  getPitch?: () => number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    const draw = (now: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = now / 1000;
      const level = Math.max(0, Math.min(1, getLevel()));
      const pitch = Math.max(0, Math.min(1, getPitch ? getPitch() : 0));

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0A0F1E";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * (0.15 + 0.05 * level);
      const hue = (145 + t * 14 + pitch * 80) % 360;

      // Radiating waves.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 14; i++) {
        const phase = t * (1.8 + level * 2.4 + pitch * 1.5) + i * 0.62;
        const waveR = radius + i * (24 + pitch * 10) + (Math.sin(phase) * 10 + level * 14);
        const alpha = (0.08 + 0.22 * level) * Math.exp(-i * 0.18);
        ctx.strokeStyle = `hsla(${(hue + i * 14) % 360} 95% 65% / ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0, waveR), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Sphere fill.
      const fill = ctx.createRadialGradient(
        cx - radius * 0.25,
        cy - radius * 0.25,
        radius * 0.12,
        cx,
        cy,
        radius
      );
      fill.addColorStop(0, "rgba(255,255,255,0.95)");
      fill.addColorStop(0.25, `hsla(${hue} 70% 75% / 0.55)`);
      fill.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Sphere rim.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${hue} 95% 70% / ${0.72 + 0.18 * level})`;
      ctx.lineWidth = 4;
      ctx.shadowColor = `hsla(${hue} 95% 70% / 0.65)`;
      ctx.shadowBlur = 18 + 28 * level;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [getLevel, getPitch]);

  return <canvas ref={canvasRef} className={`bgCanvas ${className ?? ""}`} aria-hidden="true" />;
}
