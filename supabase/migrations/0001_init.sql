-- MVP schema for iterative music sessions (Lyria-driven)
-- Apply via Supabase SQL editor or Supabase CLI migrations.

create extension if not exists pgcrypto;

-- Sessions (shared workspace)
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled session',
  owner_id uuid null,
  active_iteration_id uuid null,
  is_public boolean not null default false,
  join_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);

-- Participants (auth optional; allow anonymous participant_id)
create table if not exists public.session_members (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid null,
  participant_id text null,
  role text not null default 'editor',
  created_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (session_id, participant_id)
);

-- Versioned iterations/clips
create table if not exists public.iterations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  parent_iteration_id uuid null references public.iterations(id) on delete set null,
  idx integer not null,
  spec jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (session_id, idx)
);

-- Stored audio artifacts for an iteration
create table if not exists public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  iteration_id uuid not null references public.iterations(id) on delete cascade,
  provider text not null default 'vertex-lyria',
  provider_job_id text null,
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null default 'audio/wav',
  duration_sec numeric null,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

-- Append-only feedback events
create table if not exists public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  iteration_id uuid null references public.iterations(id) on delete set null,
  user_id uuid null,
  participant_id text null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Generation jobs (even if sync, keep a job record for idempotency/audit)
create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  base_iteration_id uuid null references public.iterations(id) on delete set null,
  iteration_id uuid null references public.iterations(id) on delete set null,
  requested_by uuid null,
  provider text not null default 'vertex-lyria',
  status text not null default 'queued',
  idempotency_key text not null,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  unique (idempotency_key),
  constraint generation_jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'canceled')
  )
);

create index if not exists iterations_session_id_idx on public.iterations(session_id, idx);
create index if not exists audio_assets_iteration_id_idx on public.audio_assets(iteration_id);
create index if not exists feedback_events_session_id_created_at_idx
  on public.feedback_events(session_id, created_at desc);
create index if not exists generation_jobs_session_id_created_at_idx
  on public.generation_jobs(session_id, created_at desc);

-- RLS: enable, but keep policies minimal for MVP (service-role server writes).
alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.iterations enable row level security;
alter table public.audio_assets enable row level security;
alter table public.feedback_events enable row level security;
alter table public.generation_jobs enable row level security;

-- Policy stubs (fill in once you add Auth + roles):
-- create policy "read public sessions" on public.sessions
--   for select using (is_public = true);
--
-- create policy "read member sessions" on public.sessions
--   for select using (
--     exists(select 1 from public.session_members m where m.session_id = sessions.id and m.user_id = auth.uid())
--   );
