-- Simple server-side rate limiting primitive (service-role only).
-- The Next.js API routes call `rpc('rate_limit_hit')` to atomically count hits per key/window.

create table if not exists public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (key, window_start)
);

create index if not exists rate_limit_counters_updated_at_idx
  on public.rate_limit_counters(updated_at desc);

-- RLS enabled (service role bypasses). Keep policies locked down by default.
alter table public.rate_limit_counters enable row level security;

-- Atomically upsert + increment.
drop function if exists public.rate_limit_hit(text, timestamptz, integer);

create or replace function public.rate_limit_hit(
  p_key text,
  p_window_start timestamptz,
  p_window_sec integer default 60
)
returns table (count integer)
language plpgsql
as $$
declare
  cutoff timestamptz;
begin
  insert into public.rate_limit_counters as r (key, window_start, count, updated_at)
  values (p_key, p_window_start, 1, now())
  on conflict (key, window_start)
  do update set
    count = r.count + 1,
    updated_at = now()
  returning r.count into count;

  -- Best-effort cleanup of old rows.
  cutoff := now() - make_interval(secs => greatest(60, p_window_sec) * 10);
  delete from public.rate_limit_counters where updated_at < cutoff;

  return next;
end;
$$;
