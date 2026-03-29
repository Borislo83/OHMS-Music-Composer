# OHMS Music Composer

Runner-up project at the Google Gemini DeepMind Hackathon (UCLA). This is a Next.js app that combines a reactive WebGL landing experience with AI-assisted music generation and a session workflow backed by Supabase. We have decided to make this project available open source with a MIT license. Link to kaggle in description and also below.
https://www.kaggle.com/competitions/ucla-gemini-api-hackathon/writeups/ohms-music-composer
https://youtu.be/iJxfOEhL5Ek?si=wIfLwDV6boKvY3hk


## Highlights
- Audio-reactive landing experience (WebGL shaders)
- Session-based generation flow
- Optional Gemini / Vertex AI integration for music generation
- Supabase-backed storage and metadata

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Setup
This repo is safe for public sharing. All secrets are excluded and only an optional `.env.example` is included.

1. Copy `.env.example` to `.env.local`.
2. Uncomment only the sections you use.

### Supabase (optional)
Required only if you use the session APIs or storage:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `SUPABASE_AUDIO_BUCKET` (defaults to `audio`)

### Gemini / Vertex AI (optional)
Required only if you enable music generation:
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`)
- `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `LYRIA_MODEL`

### Auth (optional)
If using service-account auth, set one of:
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`

## Build / Start

```bash
npm run build
npm start
```

## Deploy (Vercel)
- Import the repo
- Framework preset: Next.js
- Build command: `npm run build`
- Output: default

## Safety Notes
- No secrets are checked into the repo.
- `.env*` files are gitignored (except `.env.example`).
- Log files and prompt logs are excluded.

## Credits
Built by the OHMS team for the Google Gemini DeepMind Hackathon at UCLA.
