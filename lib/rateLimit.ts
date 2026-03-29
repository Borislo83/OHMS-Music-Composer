import { getSupabaseAdmin, type SupabaseAdminClient } from "@/lib/supabase/admin";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  key: string;
};

function windowStart(date: Date, windowSec: number) {
  const ms = date.getTime();
  const bucketMs = windowSec * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowSec: number;
  admin?: SupabaseAdminClient;
}) {
  const admin = params.admin ?? getSupabaseAdmin();
  const now = new Date();
  const start = windowStart(now, params.windowSec);
  const resetAt = new Date(start.getTime() + params.windowSec * 1000);

  const result = await admin.rpc<{ count: number }[]>("rate_limit_hit", {
    p_key: params.key,
    p_window_start: start.toISOString(),
    p_window_sec: params.windowSec
  });

  const count = Array.isArray(result) && typeof result[0]?.count === "number" ? result[0].count : 1;
  const remaining = Math.max(0, params.limit - count);
  return {
    allowed: count <= params.limit,
    limit: params.limit,
    remaining,
    resetAt,
    key: params.key
  } satisfies RateLimitResult;
}
