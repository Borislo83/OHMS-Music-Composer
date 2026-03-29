import { createHash } from "crypto";
import { GoogleAuth } from "google-auth-library";

const DEFAULT_MODEL = "lyria-002";
const DEFAULT_LOCATION = "us-central1";

type ServiceAccountJson = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

export type LyriaGenerationInput = {
  prompt?: string;
  title?: string;
  energy?: number;
  tempoBpm?: number;
  brightness?: number;
  text?: string;
  tags?: string[];
  notes?: string[];
  negativePrompt?: string;
  recentContext?: string;
  seed?: number;
  sampleCount?: number;
  model?: string;
  location?: string;
  projectId?: string;
};

export type LyriaGenerationResult = {
  audioBase64: string;
  mimeType: string;
  rawResponse: unknown;
  modelResource: string;
  deployedModelId?: string;
};

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i) & 0xff);
  }
}

function createSilentWavBytes(params: {
  durationSec: number;
  sampleRate?: number;
  channels?: number;
}) {
  const sampleRate = params.sampleRate ?? 48_000;
  const channels = params.channels ?? 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.max(1, Math.floor(params.durationSec * sampleRate));
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");

  // fmt subchunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM data is already zeroed (silence).
  return new Uint8Array(buffer);
}

export function generateDummyLyriaAudio(params?: { durationSec?: number }): LyriaGenerationResult {
  const bytes = createSilentWavBytes({ durationSec: params?.durationSec ?? 6 });
  return {
    audioBase64: Buffer.from(bytes).toString("base64"),
    mimeType: "audio/wav",
    rawResponse: { dummy: true },
    modelResource: "dummy/lyria",
    deployedModelId: undefined
  };
}

function safeJsonParse<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Failed to parse JSON credentials for Google authentication");
  }
}

let cachedAuth: GoogleAuth | null = null;

function buildGoogleAuth() {
  if (cachedAuth) return cachedAuth;

  const inlineJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (inlineJson) {
    const creds = safeJsonParse<ServiceAccountJson>(inlineJson);
    cachedAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key
      }
    });
    return cachedAuth;
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    cachedAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    });
    return cachedAuth;
  }

  // Default: rely on Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS file path
  // or GCP metadata server when running on Google infrastructure).
  cachedAuth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  return cachedAuth;
}

async function getGoogleAccessToken() {
  const auth = buildGoogleAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string"
      ? tokenResponse
      : tokenResponse && typeof tokenResponse === "object" && "token" in tokenResponse
        ? (tokenResponse as { token?: string | null }).token
        : null;

  if (!token) {
    throw new Error("Failed to obtain Google access token for Vertex AI");
  }
  return token;
}

function buildPromptSummary(input: {
  title?: string;
  energy?: number;
  tempoBpm?: number;
  brightness?: number;
  text?: string;
  tags?: string[];
  notes?: string[];
  recentContext?: string;
}) {
  const parts: string[] = [];
  if (input.title) parts.push(`Session: ${input.title}`);
  if (typeof input.energy === "number") {
    const value = input.energy;
    parts.push(
      value >= 0.75 ? "Energy: high" : value <= 0.35 ? "Energy: calm" : "Energy: balanced"
    );
  }
  if (typeof input.tempoBpm === "number") {
    const value = input.tempoBpm;
    parts.push(
      value >= 135 ? `Tempo: fast (${Math.round(value)} BPM)` : value <= 90
        ? `Tempo: slow (${Math.round(value)} BPM)`
        : `Tempo: moderate (${Math.round(value)} BPM)`
    );
  }
  if (typeof input.brightness === "number") {
    const value = input.brightness;
    parts.push(
      value >= 0.7 ? "Brightness: bright" : value <= 0.3 ? "Brightness: warm" : "Brightness: neutral"
    );
  }
  if (input.tags?.length) parts.push(`Tags: ${input.tags.join(", ")}`);
  if (input.notes?.length) parts.push(`Notes: ${input.notes.join(" / ")}`);
  if (input.text?.trim()) parts.push(`User request: ${input.text.trim()}`);
  if (input.recentContext?.trim()) parts.push(`Continuity: ${input.recentContext.trim()}`);
  return parts.join(". ");
}

function buildNegativePrompt(negativePrompt?: string, tags?: string[]) {
  const pieces = new Set<string>([
    "spoken word",
    "dialogue",
    "lyrics",
    "vocals",
    "clipping"
  ]);

  for (const token of (negativePrompt ?? "").split(",")) {
    const trimmed = token.trim();
    if (trimmed) pieces.add(trimmed);
  }

  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed.toLowerCase().startsWith("avoid:")) {
      pieces.add(trimmed.slice(6).trim());
    }
  }

  return Array.from(pieces).filter(Boolean).join(", ");
}

export function makeLyriaRequest(input: {
  prompt?: string;
  title?: string;
  energy?: number;
  tempoBpm?: number;
  brightness?: number;
  text?: string;
  tags?: string[];
  notes?: string[];
  negativePrompt?: string;
  recentContext?: string;
  seed?: number;
  sampleCount?: number;
}) {
  const prompt = input.prompt?.trim() ? input.prompt.trim() : buildPromptSummary(input);
  const negative_prompt = buildNegativePrompt(input.negativePrompt, input.tags);
  const seed = input.seed ?? undefined;
  const parameters = {
    ...(typeof seed === "number" ? {} : { sample_count: input.sampleCount ?? 1 })
  };

  return {
    instances: [
      {
        prompt,
        negative_prompt,
        ...(typeof seed === "number" ? { seed } : {})
      }
    ],
    parameters
  };
}

export async function generateLyriaAudio(input: LyriaGenerationInput) {
  const projectId =
    input.projectId ?? process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Missing Google project id (set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT).");
  }

  const location =
    input.location ??
    process.env.VERTEX_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION ??
    DEFAULT_LOCATION;
  const model = input.model ?? process.env.LYRIA_MODEL ?? DEFAULT_MODEL;
  const token = await getGoogleAccessToken();
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  const requestBody = makeLyriaRequest(input);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vertex Lyria request failed: ${errorText}`);
  }

  const body = (await response.json()) as {
    predictions?: Array<{ audioContent?: string; mimeType?: string }>;
    model?: string;
    deployedModelId?: string;
  };

  const prediction = body.predictions?.[0];
  if (!prediction?.audioContent) {
    throw new Error("Vertex Lyria response did not include audioContent");
  }

  return {
    audioBase64: prediction.audioContent,
    mimeType: prediction.mimeType ?? "audio/wav",
    rawResponse: body,
    modelResource: body.model ?? `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
    deployedModelId: body.deployedModelId
  } satisfies LyriaGenerationResult;
}

export function hashForLyriaSeed(input: string) {
  const digest = createHash("sha256").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16);
}
