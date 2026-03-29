import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const title = isPlainObject(body) && typeof body.title === "string" ? body.title.trim() : "";
    const sessionTitle = title.length > 0 ? title.slice(0, 120) : "Untitled session";

    const sessionId = randomUUID();
    const admin = getSupabaseAdmin();

    await admin.insertRow("sessions", {
      id: sessionId,
      title: sessionTitle
    });

    return Response.json({ sessionId }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to create session", 500);
  }
}
