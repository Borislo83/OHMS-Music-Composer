import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { generateDummyLyriaAudio, generateLyriaAudio, hashForLyriaSeed } from "@/lib/lyria/vertex";
import { generateLyriaAudioGenAI } from "@/lib/lyria/genai";
import { sanitizeUserNotesForMusicGenAI } from "@/lib/lyria/sanitizeNotes";
import { checkRateLimit } from "@/lib/rateLimit";
import { appendPromptLog } from "@/lib/promptLog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getLastText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function aggregateFeedback(events: Array<{ kind: string; payload: Record<string, unknown> }>) {
  const energyValues: number[] = [];
  const tempoValues: number[] = [];
  const brightnessValues: number[] = [];
  const tags = new Set<string>();
  const notes = new Set<string>();
  const negatives = new Set<string>();
  const texts: string[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};
    if (typeof payload.energy === "number") energyValues.push(payload.energy);
    if (typeof payload.tempo === "number") tempoValues.push(payload.tempo);
    if (typeof payload.brightness === "number") brightnessValues.push(payload.brightness);

    if (Array.isArray(payload.tags)) {
      for (const tag of payload.tags) {
        if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
      }
    }

    const text = getLastText(payload.text) ?? getLastText(payload.note);
    if (text) {
      texts.push(text);
      notes.add(text);
    }

    const negativePrompt = getLastText(payload.negativePrompt);
    if (negativePrompt) {
      for (const chunk of negativePrompt.split(",")) {
        const trimmed = chunk.trim();
        if (trimmed) negatives.add(trimmed);
      }
    }
  }

  const average = (values: number[], fallback: number) => {
    if (values.length === 0) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    energy: average(energyValues, 0.55),
    tempo: average(tempoValues, 122),
    brightness: average(brightnessValues, 0.5),
    tags: Array.from(tags),
    notes: Array.from(notes),
    texts,
    negativePrompt: Array.from(negatives).join(", ")
  };
}

async function loadPromptTemplate() {
  const filePath = new URL("../../../../../prompts/lyria_prompt.txt", import.meta.url);
  const template = await readFile(filePath, "utf8");
  return template;
}

function formatNumber(value: unknown, digits: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

function telemetryToJsonl(
  events: Array<{ kind: string; payload: Record<string, unknown> }>,
  maxLines = 60
) {
  const rows = events
    .filter((e) => e.kind === "hands_telemetry_1s")
    .map((e) => e.payload ?? {})
    .map((p) => {
      // Keep only hands-controlled musical parameters for the prompt event log.
      const trackTimeSec = formatNumber(p.trackTimeSec, 3);
      const bpm = formatNumber(p.bpm, 2);
      return {
        trackTimeSec,
        bpm,
        volumeGain: formatNumber(p.volumeGain, 4),
        reverbMix01: formatNumber(p.reverbMix01, 4),
        echoMix01: formatNumber(p.delayMix01, 4),
        echoTimeSec: formatNumber(p.delayTimeSec, 4),
        echoFeedback: formatNumber(p.delayFeedback, 4)
      };
    })
    .filter((row) => typeof row.trackTimeSec === "number")
    .sort((a, b) => (a.trackTimeSec ?? 0) - (b.trackTimeSec ?? 0));

  const sliced = rows.slice(-maxLines);
  if (sliced.length === 0) return "(no hands telemetry captured)";
  return sliced.map((row) => JSON.stringify(row)).join("\n");
}

function fillTemplate(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function extForMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  return "bin";
}

function apiAudioUrl(storagePath: string) {
  return `/api/audio?path=${encodeURIComponent(storagePath)}`;
}

function getRequestIp(request: Request) {
  const header = (name: string) => request.headers.get(name) ?? request.headers.get(name.toLowerCase());
  const forwarded = header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return header("x-real-ip") ?? header("cf-connecting-ip") ?? null;
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

    let strudelCode: string | null = null;
    let strudelBpm: number | null = null;
    let strudelCps: number | null = null;
    let strudelIsPlaying = false;
    try {
      const reqBody = await request.json();
      if (typeof reqBody.strudelCode === "string") strudelCode = reqBody.strudelCode.slice(0, 2000);
      if (typeof reqBody.strudelBpm === "number") strudelBpm = reqBody.strudelBpm;
      if (typeof reqBody.strudelCps === "number") strudelCps = reqBody.strudelCps;
      if (reqBody.strudelIsPlaying) strudelIsPlaying = true;
    } catch {
      // No body or invalid JSON — that's fine, Strudel context is optional.
    }

    const admin = getSupabaseAdmin();
    const session = await admin.getSession(sessionId);
    if (!session) {
      return jsonError("Session not found", 404);
    }

    const baseIteration = (await admin.ensureDraftIteration(sessionId)) ?? null;
    if (!baseIteration?.id) {
      return jsonError("Unable to resolve base iteration", 500);
    }

    const feedbackEvents = await admin.getRecentFeedbackEvents(sessionId, baseIteration.id, 24);
    const summary = aggregateFeedback(feedbackEvents);

    const template = await loadPromptTemplate();
    const eventLogJsonl = telemetryToJsonl(feedbackEvents, 80);
    const userNotes =
      summary.notes.length > 0
        ? summary.notes.join(" / ")
        : summary.texts.length > 0
          ? summary.texts.join(" / ")
          : "(none)";

    const sanitizedUserNotes = sanitizeUserNotesForMusicGenAI(userNotes).slice(0, 1200);

    const strudelSection =
      strudelIsPlaying && (strudelCode || strudelBpm)
        ? [
            strudelBpm != null ? `Strudel BPM: ${Math.round(strudelBpm)}` : null,
            strudelCps != null ? `Strudel CPS: ${strudelCps.toFixed(2)}` : null,
            strudelCode ? `Strudel code:\n\`\`\`\n${strudelCode}\n\`\`\`` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "(no Strudel pattern active)";

    const prompt = fillTemplate(template, {
      SESSION_TITLE: session.title ?? "Untitled session",
      USER_NOTES: sanitizedUserNotes.length > 0 ? sanitizedUserNotes : "(none)",
      EVENT_LOG_JSONL: eventLogJsonl.slice(0, 12_000),
      STRUDEL_CONTEXT: strudelSection,
    });
    const seedSource = JSON.stringify({
      sessionId,
      baseIterationId: baseIteration.id,
      prompt,
      negativePrompt: summary.negativePrompt
    });
    const seed = hashForLyriaSeed(seedSource);
    const idempotencyKey = createHash("sha256").update(JSON.stringify({
      sessionId,
      baseIterationId: baseIteration.id,
      prompt,
      negativePrompt: summary.negativePrompt,
      seed
    })).digest("hex");

    const existingJob = await admin.getGenerationJobByKey(idempotencyKey);
    if (existingJob) {
      const job = await admin.getGenerationJob(existingJob.id);
      if (job?.status === "succeeded" && job.iteration_id) {
        const asset = await admin.getOne<{ storage_path: string; mime_type?: string }>("audio_assets", {
          filters: [{ column: "iteration_id", value: job.iteration_id }]
        });
        const audioUrl = asset?.storage_path ? apiAudioUrl(asset.storage_path) : null;
        if (audioUrl) {
          return Response.json(
            { jobId: existingJob.id, status: "succeeded", iterationId: job.iteration_id, audioUrl },
            { status: 200 }
          );
        }
      }

      if (job?.status === "running" || job?.status === "queued") {
        return jsonError("Generation already in progress for this input. Try again in a moment.", 409);
      }

      return Response.json({ jobId: existingJob.id, status: job?.status ?? "unknown" }, { status: 200 });
    }

    // Rate limit (protects Google API + storage writes). Requires Supabase migration 0003_rate_limit.sql.
    const ip = getRequestIp(request) ?? "unknown";
    const ipLimit = await checkRateLimit({ key: `gen:ip:${ip}`, limit: 12, windowSec: 60, admin }).catch(
      (e) => {
        throw new Error(
          `Rate limit storage is not initialized in Supabase. Run migration supabase/migrations/0003_rate_limit.sql. (${e instanceof Error ? e.message : "unknown"})`
        );
      }
    );
    if (!ipLimit.allowed) {
      return Response.json(
        { error: "Rate limit exceeded. Try again shortly." },
        {
          status: 429,
          headers: {
            "RateLimit-Limit": String(ipLimit.limit),
            "RateLimit-Remaining": String(ipLimit.remaining),
            "RateLimit-Reset": String(Math.floor(ipLimit.resetAt.getTime() / 1000))
          }
        }
      );
    }

    const sessionLimit = await checkRateLimit({
      key: `gen:session:${sessionId}`,
      limit: 20,
      windowSec: 60,
      admin
    });
    if (!sessionLimit.allowed) {
      return Response.json(
        { error: "Session is generating too fast. Wait a moment and retry." },
        {
          status: 429,
          headers: {
            "RateLimit-Limit": String(sessionLimit.limit),
            "RateLimit-Remaining": String(sessionLimit.remaining),
            "RateLimit-Reset": String(Math.floor(sessionLimit.resetAt.getTime() / 1000))
          }
        }
      );
    }

    const useDummy = process.env.USE_DUMMY_LYRIA === "1";
    const hasGenAiKey = Boolean(
      process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
    const providerPref = (process.env.LYRIA_PROVIDER ?? "").toLowerCase();
    const provider =
      providerPref === "genai" || providerPref === "gemini"
        ? "genai"
        : providerPref === "vertex"
          ? "vertex"
          : hasGenAiKey
            ? "genai"
            : "vertex";

    const jobId = randomUUID();
    const job = await admin.createGenerationJob({
      id: jobId,
      session_id: sessionId,
      base_iteration_id: baseIteration.id,
      status: "running",
      provider: useDummy ? "dummy-lyria" : provider === "genai" ? "genai-lyria" : "vertex-lyria",
      idempotency_key: idempotencyKey,
      request: {
        prompt,
        negativePrompt: summary.negativePrompt,
        seed,
        sessionId,
        baseIterationId: baseIteration.id,
        baseIterationIdx: typeof baseIteration.idx === "number" ? baseIteration.idx : 0,
        feedbackEventCount: feedbackEvents.length
      },
      result: {},
      error: null
    });

    if (!job?.id) {
      return jsonError("Failed to create generation job", 500);
    }

    try {
      const lyria = useDummy
        ? generateDummyLyriaAudio({ durationSec: 6 })
        : provider === "genai"
          ? await generateLyriaAudioGenAI({ prompt, seed })
          : await generateLyriaAudio({
              title: session.title ?? undefined,
              energy: summary.energy,
              tempoBpm: summary.tempo,
              brightness: summary.brightness,
              text: summary.texts.join(" / "),
              tags: summary.tags,
              notes: summary.notes,
              negativePrompt: summary.negativePrompt,
              recentContext: `Continue from iteration ${baseIteration.id}`,
              seed
            });

      await appendPromptLog({
        sessionId,
        provider: useDummy ? "dummy-lyria" : provider === "genai" ? "genai-lyria" : "vertex-lyria",
        model: lyria.modelResource,
        prompt,
        negativePrompt: summary.negativePrompt,
        seed
      });

      const iterationId = randomUUID();
      const assetId = randomUUID();
      const ext = extForMime(lyria.mimeType);
      const storagePath = `sessions/${sessionId}/iterations/${iterationId}/${assetId}.${ext}`;
      const audioBytes = Buffer.from(lyria.audioBase64, "base64");

      await admin.uploadAudioObject(storagePath, audioBytes, lyria.mimeType);

      await admin.insertRow("iterations", {
        id: iterationId,
        session_id: sessionId,
        parent_iteration_id: baseIteration.id,
        idx: typeof baseIteration.idx === "number" ? baseIteration.idx + 1 : 1,
        created_at: new Date().toISOString()
      });

      await admin.insertRow("audio_assets", {
        id: assetId,
        iteration_id: iterationId,
        storage_bucket: process.env.SUPABASE_AUDIO_BUCKET ?? "audio",
        storage_path: storagePath,
        mime_type: lyria.mimeType,
        provider: useDummy ? "dummy-lyria" : provider === "genai" ? "genai-lyria" : "vertex-lyria",
        created_at: new Date().toISOString()
      });

      await admin.patchGenerationJob(job.id, {
        status: "succeeded",
        iteration_id: iterationId,
        result: {
          storagePath,
          mimeType: lyria.mimeType,
          model: lyria.modelResource,
          deployedModelId:
            typeof (lyria as { deployedModelId?: unknown }).deployedModelId === "string"
              ? (lyria as { deployedModelId?: string }).deployedModelId
              : null,
          dummy: useDummy
        },
        updated_at: new Date().toISOString()
      });

      await admin.updateSessionActiveIteration(sessionId, iterationId);
      const audioUrl = apiAudioUrl(storagePath);

      return Response.json({ jobId: job.id, status: "succeeded", iterationId, audioUrl }, { status: 201 });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      await admin.patchGenerationJob(job.id, {
        status: "failed",
        error: message,
        updated_at: new Date().toISOString()
      });
      return jsonError(message, 500);
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to generate music", 500);
  }
}
