# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install deps + copy MediaPipe WASM files to public/
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint (flat config, Next.js core-web-vitals + TS)
```

There are no tests configured in this project.

## Architecture

This is a **Next.js 16 App Router** project (React 19, TypeScript, strict mode) for an audio-reactive music creation tool called "Beat Drops."

### Core flow

1. **Studio sessions** — Users create sessions stored in Supabase, then iteratively generate music clips via Google Vertex AI's **Lyria** model. The loop is: create session → submit feedback → generate audio → listen → repeat.
2. **API routes** (`app/api/`) — Server-side Next.js route handlers that manage sessions, feedback, and generation jobs. All DB access goes through `lib/supabase/admin.ts` (a custom REST client using Supabase's PostgREST API with service-role key — no `@supabase/supabase-js` SDK).
3. **Lyria integration** (`lib/lyria/vertex.ts`) — Calls Vertex AI's Lyria music generation endpoint. Authenticates via Google service account credentials. Has a `generateDummyLyriaAudio()` fallback that returns silent WAV for development without credentials.
4. **Rate limiting** (`lib/rateLimit.ts`) — Uses a Supabase RPC function (`rate_limit_hit`) for server-side rate limiting on generation requests.

### Frontend pages

- `/` — Audio landing page with WebGL shader background
- `/studio` — Create/join collaborative sessions
- `/studio/[sessionId]` — Session workspace (feedback panel, audio player, iteration history)
- `/hands` — MediaPipe hand-tracking synth controller
- `/beatdrops` — Audio visualizer
- `/strudel` — Redirects to static Strudel live-coding environment

### Key patterns

- **MediaPipe WASM** — The `postinstall` script copies `@mediapipe/tasks-vision` WASM files to `public/mediapipe/wasm/`. These are loaded client-side by `lib/mediapipe.ts`.
- **Strudel** — `@strudel/*` packages are declared as untyped modules in `strudel.d.ts`.
- **WebGL shaders** — `components/WebGLShader.tsx` and `WebGLShaderWaveform.tsx` render audio-reactive backgrounds using raw WebGL.
- **Path alias** — `@/*` maps to project root via tsconfig paths.

### Database (Supabase)

Schema lives in `supabase/migrations/`. Key tables: `sessions`, `iterations`, `audio_assets`, `feedback_events`, `generation_jobs`. RLS is enabled but policies are stubbed out (service-role key bypasses RLS).

### Environment variables

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase connection
- `SUPABASE_AUDIO_BUCKET` — Storage bucket name (default: "audio")
- `VERTEX_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` — GCP project for Lyria
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` or `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` — Service account auth
- `GOOGLE_API_KEY` — Optional API key for Vertex requests
