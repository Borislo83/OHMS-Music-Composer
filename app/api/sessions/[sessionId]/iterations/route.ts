import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function apiAudioUrl(storagePath: string) {
  return `/api/audio?path=${encodeURIComponent(storagePath)}`;
}

function filenameFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last || "iteration-audio";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> | { sessionId: string } }
) {
  try {
    const { sessionId } = await Promise.resolve(params);
    if (!isUuid(sessionId)) return jsonError("Invalid sessionId", 400);

    const admin = getSupabaseAdmin();
    const session = await admin.getSession(sessionId);
    if (!session) return jsonError("Session not found", 404);

    const iterations = await admin.queryRows<{
      id: string;
      idx?: number | null;
      created_at?: string | null;
    }>("iterations", {
      filters: [{ column: "session_id", value: sessionId }],
      orderBy: { column: "created_at", ascending: false },
      limit: 200
    });

    if (iterations.length === 0) {
      return Response.json({ iterations: [], activeIterationId: session.active_iteration_id ?? null }, { status: 200 });
    }

    const iterationIds = iterations.map((it) => it.id);
    const assets = await admin.queryRows<{
      id: string;
      iteration_id: string;
      storage_path: string;
      mime_type?: string | null;
      created_at?: string | null;
    }>("audio_assets", {
      filters: [{ column: "iteration_id", operator: "in", value: iterationIds }]
    });

    const assetByIteration = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) {
      const existing = assetByIteration.get(asset.iteration_id);
      if (!existing) {
        assetByIteration.set(asset.iteration_id, asset);
        continue;
      }
      const currentStamp = existing.created_at ? Date.parse(existing.created_at) : 0;
      const nextStamp = asset.created_at ? Date.parse(asset.created_at) : 0;
      if (nextStamp >= currentStamp) assetByIteration.set(asset.iteration_id, asset);
    }

    const missingIds = iterations
      .filter((iteration) => !assetByIteration.has(iteration.id))
      .map((iteration) => iteration.id);
    const missingSet = new Set(missingIds);
    const fallbackByIteration = new Map<string, { path: string; created_at?: string | null }>();

    if (missingIds.length > 0) {
      const objects = await admin.listAudioObjects(`sessions/${sessionId}/iterations`);
      for (const object of objects) {
        const path = object.name ?? "";
        if (!path) continue;
        const match = path.match(new RegExp(`^sessions/${sessionId}/iterations/([^/]+)/`));
        if (!match) continue;
        const iterationId = match[1];
        if (!missingSet.has(iterationId)) continue;
        const existing = fallbackByIteration.get(iterationId);
        const currentStamp = existing?.created_at ? Date.parse(existing.created_at) : 0;
        const nextStamp = object.created_at ? Date.parse(object.created_at) : 0;
        if (!existing || nextStamp >= currentStamp) {
          fallbackByIteration.set(iterationId, { path, created_at: object.created_at ?? null });
        }
      }
    }

    const entries = iterations
      .map((iteration) => {
        const asset = assetByIteration.get(iteration.id);
        const fallback = fallbackByIteration.get(iteration.id);
        if (!asset && !fallback) return null;
        const storagePath = asset?.storage_path ?? fallback?.path ?? "";
        return {
          iterationId: iteration.id,
          idx: iteration.idx ?? null,
          createdAt: iteration.created_at ?? null,
          audioUrl: apiAudioUrl(storagePath),
          filename: filenameFromPath(storagePath),
          mimeType: asset?.mime_type ?? null
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return Response.json(
      { iterations: entries, activeIterationId: session.active_iteration_id ?? null },
      { status: 200 }
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load iterations", 500);
  }
}
