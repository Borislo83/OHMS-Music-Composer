import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isSafeStoragePath(path: string) {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    if (!isSafeStoragePath(path)) return jsonError("Invalid path", 400);

    const admin = getSupabaseAdmin();
    const upstream = await admin.downloadAudioObject(path);

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    headers.set("cache-control", "private, max-age=3600");
    headers.set("accept-ranges", upstream.headers.get("accept-ranges") ?? "bytes");

    return new Response(upstream.body, {
      status: 200,
      headers
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to fetch audio", 500);
  }
}

