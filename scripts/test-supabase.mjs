import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} (check .env.local)`);
  return value;
}

function encodeStoragePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function joinUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message ?? response.statusText)
        : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return body;
}

function buildHeaders(extra) {
  const key = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

async function insertRow(table, row) {
  const baseUrl = mustGetEnv("SUPABASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(row)
  });
  const rows = await parseJsonResponse(response);
  return Array.isArray(rows) ? rows[0] : null;
}

async function queryOneById(table, id) {
  const baseUrl = mustGetEnv("SUPABASE_URL").replace(/\/+$/, "");
  const params = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
  const response = await fetch(`${baseUrl}/rest/v1/${table}?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders({ Accept: "application/json" })
  });
  const rows = await parseJsonResponse(response);
  return Array.isArray(rows) ? rows[0] : null;
}

async function uploadAudioObject(path, audioData, contentType = "audio/wav") {
  const baseUrl = mustGetEnv("SUPABASE_URL").replace(/\/+$/, "");
  const bucket = process.env.SUPABASE_AUDIO_BUCKET || "audio";
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
    {
      method: "PUT",
      headers: buildHeaders({
        "Content-Type": contentType,
        "x-upsert": "true"
      }),
      body: audioData
    }
  );
  await parseJsonResponse(response);
}

async function listBuckets() {
  const baseUrl = mustGetEnv("SUPABASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/storage/v1/bucket`, {
    method: "GET",
    headers: buildHeaders({ Accept: "application/json" })
  });
  return parseJsonResponse(response);
}

async function getSignedUrl(path, expiresIn = 60) {
  const baseUrl = mustGetEnv("SUPABASE_URL").replace(/\/+$/, "");
  const bucket = process.env.SUPABASE_AUDIO_BUCKET || "audio";
  const response = await fetch(
    `${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn })
    }
  );
  const body = await parseJsonResponse(response);
  const signedURL = body?.signedURL;
  if (!signedURL) throw new Error("Supabase did not return signedURL");
  return signedURL.startsWith("http") ? signedURL : joinUrl(baseUrl, signedURL);
}

function parseDotEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

async function loadEnvLocal() {
  const raw = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  const parsed = parseDotEnv(raw);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] == null) process.env[k] = v;
  }
}

async function main() {
  await loadEnvLocal();

  mustGetEnv("SUPABASE_URL");
  mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");

  const sessionId = randomUUID();
  const title = `integration-test ${new Date().toISOString()}`;
  await insertRow("sessions", { id: sessionId, title });

  const session = await queryOneById("sessions", sessionId);
  if (!session) throw new Error("Failed to read back inserted session row");

  const iterationId = randomUUID();
  await insertRow("iterations", {
    id: iterationId,
    session_id: sessionId,
    idx: 0
  });

  const feedbackEventId = randomUUID();
  await insertRow("feedback_events", {
    id: feedbackEventId,
    session_id: sessionId,
    iteration_id: iterationId,
    kind: "integration_test",
    payload: { energy: 0.5, tempo: 120, brightness: 0.5, text: "hello" }
  });

  // Storage test: upload a tiny RIFF-like header (not a real WAV, but enough to test upload/sign).
  const storagePath = `sessions/${sessionId}/iterations/${iterationId}/test.wav`;
  const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]); // "RIFF...."
  let signedUrl = null;
  let storageOk = false;
  let storageError = null;
  let existingBuckets = null;
  try {
    await uploadAudioObject(storagePath, bytes, "audio/wav");
    signedUrl = await getSignedUrl(storagePath, 60);
    storageOk = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    storageError = msg;
    existingBuckets = await listBuckets().catch(() => null);
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        sessionId,
        iterationId,
        feedbackEventId,
        storage: {
          bucket: process.env.SUPABASE_AUDIO_BUCKET || "audio",
          ok: storageOk,
          error: storageError,
          existingBuckets: Array.isArray(existingBuckets)
            ? existingBuckets.map((b) => b?.name).filter(Boolean)
            : null
        },
        signedUrlPreview: signedUrl ? signedUrl.slice(0, 60) + "…" : null
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
