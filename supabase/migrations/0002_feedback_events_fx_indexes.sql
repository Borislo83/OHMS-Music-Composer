-- Optional: indexes to speed up querying hands telemetry + FX values.
-- Safe to run multiple times.

create index if not exists feedback_events_kind_created_at_idx
  on public.feedback_events(kind, created_at desc);

-- Allows fast filtering on payload keys (jsonb containment / path queries).
-- If your dataset is tiny, you can skip this.
create index if not exists feedback_events_payload_gin_idx
  on public.feedback_events using gin (payload jsonb_path_ops);

