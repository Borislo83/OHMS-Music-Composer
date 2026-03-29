# Supabase setup (MVP)

This project uses Supabase for:
- Postgres tables (sessions, iterations, feedback, generation jobs)
- Storage bucket `audio` for generated WAV files

## Migrations

- `supabase/migrations/0001_init.sql` — initial MVP schema

Apply via the Supabase SQL editor, or with the Supabase CLI if you have it configured.

## Storage

Create a bucket named `audio` (or set `SUPABASE_AUDIO_BUCKET`) and store objects under:

`sessions/{sessionId}/iterations/{iterationId}/{assetId}.wav`

## RLS

RLS is enabled in the migration, but policies are intentionally left as stubs.

For the hackathon MVP, the Next.js API routes use `SUPABASE_SERVICE_ROLE_KEY` server-side to write rows
and upload to Storage. Before going public, add real policies and auth.

