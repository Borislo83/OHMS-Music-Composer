import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0F1E",
        panel: {
          DEFAULT: "#111827",
          light: "#1a2236",
        },
        primary: {
          DEFAULT: "#00FF88",
          dim: "rgba(0, 255, 136, 0.15)",
          glow: "rgba(0, 255, 136, 0.25)",
        },
        secondary: {
          DEFAULT: "#22C55E",
          dim: "rgba(34, 197, 94, 0.15)",
        },
        tertiary: {
          DEFAULT: "#3B82F6",
          dim: "rgba(59, 130, 246, 0.15)",
        },
        text: {
          DEFAULT: "#E2E8F0",
          muted: "#94A3B8",
          dim: "#64748B",
        },
        border: {
          DEFAULT: "rgba(0, 255, 136, 0.12)",
          subtle: "rgba(255, 255, 255, 0.08)",
          bright: "rgba(0, 255, 136, 0.3)",
        },
        destructive: {
          DEFAULT: "#EF4444",
          dim: "rgba(239, 68, 68, 0.15)",
        },
        surface: {
          DEFAULT: "rgba(17, 24, 39, 0.6)",
          solid: "#111827",
          elevated: "rgba(26, 34, 54, 0.8)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "22px",
        "3xl": "28px",
      },
      boxShadow: {
        glow: "0 0 30px rgba(0, 255, 136, 0.08)",
        "glow-sm": "0 0 15px rgba(0, 255, 136, 0.06)",
        "glow-lg": "0 0 60px rgba(0, 255, 136, 0.12)",
        glass: "0 30px 110px rgba(0, 0, 0, 0.55)",
        card: "0 18px 70px rgba(0, 0, 0, 0.35)",
      },
      backdropBlur: {
        glass: "14px",
      },
      animation: {
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-up": "slide-up 0.5s ease-out",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 255, 136, 0.1)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 255, 136, 0.2)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
