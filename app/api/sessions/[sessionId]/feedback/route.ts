import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAnyPayload(payload: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};

  const put = (key: string, value: unknown) => {
    if (key.length > 80) return;
    if (value == null) {
      normalized[key] = null;
      return;
    }
    if (typeof value === "string") {
      normalized[key] = value.slice(0, 500);
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      normalized[key] = value;
      return;
    }
    if (typeof value === "boolean") {
      normalized[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      normalized[key] = value
        .slice(0, 50)
        .map((item) => {
          if (item == null) return null;
          if (typeof item === "string") return item.slice(0, 200);
          if (typeof item === "number") return Number.isFinite(item) ? item : null;
          if (typeof item === "boolean") return item;
          return null;
        })
        .filter((item) => item !== null);
      return;
    }
    if (isPlainObject(value)) {
      // One-level shallow object only.
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value).slice(0, 30)) {
        if (typeof k !== "string" || k.length > 80) continue;
        if (v == null) out[k] = null;
        else if (typeof v === "string") out[k] = v.slice(0, 200);
        else if (typeof v === "number") out[k] = Number.isFinite(v) ? v : null;
        else if (typeof v === "boolean") out[k] = v;
      }
      normalized[key] = out;
      return;
    }
  };

  for (const [key, value] of Object.entries(payload).slice(0, 60)) {
    put(key, value);
  }
  return normalized;
}

function normalizeNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function normalizeFeedbackPayload(payload: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  const energy = normalizeNumber(payload.energy, 0, 1);
  const tempo = normalizeNumber(payload.tempo, 60, 180);
  const brightness = normalizeNumber(payload.brightness, 0, 1);

  if (energy !== null) normalized.energy = energy;
  if (tempo !== null) normalized.tempo = tempo;
  if (brightness !== null) normalized.brightness = brightness;

  if (typeof payload.text === "string" && payload.text.trim()) {
    normalized.text = payload.text.trim().slice(0, 1000);
  }

  if (Array.isArray(payload.tags)) {
    normalized.tags = payload.tags
      .filter((tag) => typeof tag === "string" && tag.trim().length > 0)
      .map((tag) => tag.trim().slice(0, 80))
      .slice(0, 20);
  }

  if (typeof payload.note === "string" && payload.note.trim()) {
    normalized.note = payload.note.trim().slice(0, 1000);
  }

  if (typeof payload.negativePrompt === "string" && payload.negativePrompt.trim()) {
    normalized.negativePrompt = payload.negativePrompt.trim().slice(0, 500);
  }

  if (typeof payload.iterationId === "string" && isUuid(payload.iterationId)) {
    normalized.iterationId = payload.iterationId;
  }

  return normalized;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> | { sessionId: string } }
) {
  try {
    const { sessionId } = await Promise.resolve(params);
    if (!isUuid(sessionId)) {
      return jsonError("Invalid sessionId", 400);
    }

    const body = await request.json().catch(() => null);
    if (!isPlainObject(body)) {
      return jsonError("Invalid JSON body", 400);
    }

    const admin = getSupabaseAdmin();
    const session = await admin.getSession(sessionId);
    if (!session) {
      return jsonError("Session not found", 404);
    }

    const draftIteration = await admin.ensureDraftIteration(sessionId);
    if (!draftIteration?.id) {
      return jsonError("Unable to prepare session iteration", 500);
    }

    const requestedKind = typeof body.kind === "string" ? body.kind.trim().slice(0, 80) : "";
    const rawPayload = isPlainObject(body.payload) ? body.payload : body;

    const kind = requestedKind.length > 0 ? requestedKind : "studio_feedback";
    const payload =
      kind === "studio_feedback" ? normalizeFeedbackPayload(rawPayload) : sanitizeAnyPayload(rawPayload);
    const feedbackEventId = randomUUID();

    const requestedIterationId =
      (typeof body.iterationId === "string" && isUuid(body.iterationId) ? body.iterationId : null) ??
      (typeof (payload as Record<string, unknown>).iterationId === "string" &&
      isUuid(String((payload as Record<string, unknown>).iterationId))
        ? String((payload as Record<string, unknown>).iterationId)
        : null);

    await admin.insertRow("feedback_events", {
      id: feedbackEventId,
      session_id: sessionId,
      iteration_id: requestedIterationId ?? draftIteration.id,
      kind,
      payload
    });

    return Response.json({ feedbackEventId }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to save feedback", 500);
  }
}
