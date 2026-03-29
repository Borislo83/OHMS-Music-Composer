"use client";

import WebGLShader from "@/components/WebGLShader";

type Props = {
  getLevel: () => number;
  getPitch?: () => number;
  className?: string;
};

const fragHome = `
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
  float r = length(p);
  float ang = atan(p.y, p.x);

  float lvl = clamp(u_level, 0.0, 1.0);
  float pit = clamp(u_pitch, 0.0, 1.0);
  float drive = clamp(0.6 * lvl + 0.4 * pit, 0.0, 1.0);
  float t = u_time * (0.22 + 0.42 * lvl + 0.12 * pit);

  // Background
  vec3 baseBg = vec3(0.02, 0.03, 0.05);
  float haze = fbm(p * 1.08 + vec2(t * 0.04, -t * 0.03));
  vec3 col = baseBg + vec3(0.01, 0.012, 0.02) * haze;

  // Sphere (pulsating)
  float pulse = 0.5 + 0.5 * sin(u_time * (2.1 + 2.9 * drive));
  float pulseAmt = (0.018 + 0.03 * drive) * (0.35 + 0.65 * pulse);
  float sphereR = 0.30 + 0.03 * lvl + 0.012 * sin(t * 0.85 + pit * 2.2) + pulseAmt;
  float aa = 2.0 / u_res.y;
  float sphereMask = 1.0 - smoothstep(sphereR - aa * 2.0, sphereR + aa * 2.0, r);

  // 3D normal (make z read stronger)
  float rr = r / max(sphereR, 1e-4);
  float z = sqrt(max(1.0 - rr * rr, 0.0));
  z = mix(z, pow(z, 0.65), 0.7);
  vec3 n = normalize(vec3(p / sphereR, z));

  vec3 l = normalize(vec3(-0.26 + 0.22 * sin(u_time * 0.55), 0.52, 0.83));
  vec3 v = vec3(0.0, 0.0, 1.0);
  float diff = clamp(dot(n, l), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.9);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 26.0);

  // Rainbow surface: hue varies by angle + rings + pitch.
  float wob = fbm(p * (2.4 + pit * 1.2) + vec2(t * 0.08, -t * 0.06));
  float surf = rr * (16.0 + 26.0 * lvl + 40.0 * pit);
  float ringPhase = surf - t * (2.7 + 2.2 * lvl + 0.9 * pit) + wob * 5.0;
  float rings = 0.5 + 0.5 * sin(ringPhase);
  rings = pow(rings, 4.0);

  float hueBase = fract(0.36 + 0.20 * pit + 0.15 * sin(ang * 3.0) + 0.03 * u_time);
  float hue = fract(hueBase + 0.14 * rings + 0.05 * sin(u_time * 0.4 + ang * 2.0));
  vec3 rainbow = hsv2rgb(vec3(hue, 0.90, 1.0));

  // Dark core vignette — keeps the center readable for text overlay.
  float coreBlack = 1.0 - smoothstep(0.05, 0.09, rr);
  float haloWhite = exp(-rr * 10.0) * (0.30 + 0.20 * pulse);
  float centerDarken = smoothstep(0.55, 0.0, rr) * 0.65;

  vec3 sphereCol = baseBg;
  sphereCol += vec3(1.0) * haloWhite;
  sphereCol = mix(sphereCol, vec3(0.0), coreBlack);
  sphereCol += rainbow * (0.18 + 0.18 * diff + 0.85 * rim + (0.25 + 0.8 * lvl) * rings);
  sphereCol += vec3(1.0) * spec * (0.12 + 0.20 * lvl) * (0.65 + 0.45 * pulse);
  sphereCol = mix(sphereCol, baseBg, centerDarken);

  col = mix(col, sphereCol, sphereMask);

  // Subtle outline so it reads on dark monitors.
  float edge = 1.0 - smoothstep(aa * 0.8, aa * 5.0, abs(r - sphereR));
  col += hsv2rgb(vec3(hueBase + u_time * 0.02, 0.9, 1.0)) * edge * (0.22 + 0.75 * drive);

  // Soft outer waves (keep very subtle on the home page)
  float rOut = max(r - sphereR, 0.0);
  float outWarp = rOut + (wob - 0.5) * (0.07 + 0.05 * lvl);
  float wFreq = 12.0 + 10.0 * lvl + 18.0 * pit;
  float phase = outWarp * wFreq - t * (3.1 + 2.0 * lvl + 0.7 * pit) + wob * 2.8;
  float w = 0.5 + 0.5 * sin(phase);
  w = pow(w, 2.6);
  float atten = 1.0 / (1.0 + 1.35 * outWarp);
  float outside = smoothstep(sphereR * 0.985, sphereR * 1.02, r);
  col += rainbow * w * atten * (0.06 + 0.18 * lvl) * outside;

  // Tonemap
  col = col / (col + vec3(0.55));
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function HomeShader({ getLevel, getPitch, className }: Props) {
  return (
    <WebGLShader
      getLevel={getLevel}
      getPitch={getPitch}
      fragmentSource={fragHome}
      className={className}
    />
  );
}

