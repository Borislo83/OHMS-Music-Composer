"use client";

import WebGLShader from "@/components/WebGLShader";

type Props = {
  getLevel: () => number;
  getPitch: () => number;
};

const fragWaveform = `
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

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
}

float fbm(vec2 p) {
  float f = 0.0;
  float a = 0.55;
  for (int i = 0; i < 5; i++) {
    f += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return f;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float x = p.x;
  float y = p.y;

  float lvl = clamp(u_level, 0.0, 1.0);
  float pitch = clamp(u_pitch, 0.0, 1.0);

  // Slower time base to reduce flicker/intensity.
  float t = u_time * (0.45 + 0.75 * pitch) + 2.8 * fbm(vec2(u_time * 0.02, pitch * 1.6));

  vec3 col = vec3(0.02, 0.03, 0.05);

  float shimmer = fbm(p * 2.0 + vec2(t * 0.05, -t * 0.04));
  col += vec3(0.012, 0.015, 0.03) * (shimmer - 0.5);

  float baseLine = exp(-abs(y) * 70.0) * (0.32 + 0.6 * lvl);
  col += vec3(0.0, 1.0, 0.53) * baseLine * 0.10;

  float ampBase = 0.03 + 0.075 * lvl;
  float freqBase = mix(1.6, 6.8, pitch);
  float speedBase = mix(0.85, 2.8, pitch);

  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float layer = fi / 11.0;
    float spread = (layer - 0.5) * 0.52;
    float amp = ampBase * mix(1.0, 0.25, layer);
    float freq = freqBase * (1.0 + 0.25 * layer) * 6.2831853;
    float speed = speedBase * (1.0 + 0.18 * layer);
    float phase = 1.35 * fi + 0.6 * sin(fi * 0.7);

    float wob = fbm(vec2(x * (1.6 + 1.2 * layer), t * (0.09 + 0.04 * layer))) - 0.5;
    float yWave = sin(x * freq + t * speed + phase + wob * 1.1) * amp;
    yWave += 0.55 * sin(x * freq * 0.54 - t * speed * 0.6 + phase) * amp;

    float blur = 68.0 + 42.0 * layer;
    float wA = exp(-abs(y - (yWave + spread)) * blur);
    float wB = exp(-abs(y - (-yWave - spread)) * blur);
    float w = (wA + wB) * (0.12 + 0.3 * (1.0 - layer)) * (0.6 + 0.6 * lvl);

    // Green-biased palette for neon aesthetic.
    float hue = fract(0.34 + 0.10 * pitch + 0.10 * layer + 0.008 * t);
    vec3 c = hsv2rgb(vec3(hue, 0.65, 0.95));
    col += c * w;
  }

  float glow = exp(-abs(y) * 24.0) * (0.1 + 0.18 * lvl);
  col += vec3(0.0, 0.85, 0.50) * glow;

  float vignette = smoothstep(1.15, 0.15, length(p * vec2(1.15, 0.9)));
  col *= 0.65 + 0.55 * vignette;

  // Gentle highlight rolloff to avoid harsh high-contrast flashes.
  col = col / (col + vec3(0.65));

  gl_FragColor = vec4(col, 1.0);
}
`;

export default function WebGLShaderWaveform({ getLevel, getPitch }: Props) {
  return <WebGLShader getLevel={getLevel} getPitch={getPitch} fragmentSource={fragWaveform} />;
}
