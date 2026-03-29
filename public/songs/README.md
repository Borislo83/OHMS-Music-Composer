# Songs folder

Drop your soundtrack files in this folder and reference them from `lib/songs.ts`.

This repo ships with a single audio file in `public/audio/beat-drops.mp3`. For now, the provided
soundtracks in `lib/songs.ts` point to symlinks in this folder so the Studio UI can offer multiple
choices without duplicating binaries.

To customize:
- Replace `public/songs/*.mp3` with your own audio files (keep names or update `lib/songs.ts`).
- Supported formats depend on the browser (mp3/wav generally work).

