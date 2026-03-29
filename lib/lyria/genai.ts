import { GoogleGenAI, Modality } from "@google/genai";
import { Buffer } from "buffer";

export type GenAiLyriaResult = {
  audioBase64: string;
  mimeType: string;
  rawResponse: unknown;
  modelResource: string;
  deployedModelId?: string;
};

function getApiKey() {
  return (
    process.env.GOOGLE_API_KEY ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    ""
  );
}

function dataToBase64(data: unknown) {
  if (typeof data === "string" && data.length > 0) return data;
  if (data instanceof Uint8Array && data.byteLength > 0) return Buffer.from(data).toString("base64");
  return null;
}

function normalizeSeedInt32(seed: unknown) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return undefined;
  const n = Math.floor(seed);
  // GenAI expects a signed int32. Keep it positive for stability.
  const max = 2_147_483_647;
  const positive = Math.abs(n);
  return positive > max ? positive % max : positive;
}

function buildModelCandidates(model: string) {
  const trimmed = model.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("models/")) return [trimmed];
  return [trimmed, `models/${trimmed}`];
}

function summarizeParts(parts: unknown) {
  if (!Array.isArray(parts)) return [];
  return parts.slice(0, 8).map((p) => {
    const part = p as Record<string, unknown>;
    const inlineData = part.inlineData as Record<string, unknown> | undefined;
    const fileData = part.fileData as Record<string, unknown> | undefined;
    const text = typeof part.text === "string" ? part.text : undefined;
    const data = inlineData?.data;
    return {
      keys: Object.keys(part).slice(0, 6),
      textPreview: text ? text.slice(0, 120) : undefined,
      inline: inlineData
        ? {
            mimeType: typeof inlineData.mimeType === "string" ? inlineData.mimeType : undefined,
            dataType: typeof data,
            dataLen: typeof data === "string" ? data.length : undefined
          }
        : undefined,
      file: fileData
        ? {
            mimeType: typeof fileData.mimeType === "string" ? fileData.mimeType : undefined,
            uri:
              typeof (fileData as { fileUri?: unknown }).fileUri === "string"
                ? String((fileData as { fileUri?: string }).fileUri)
                : typeof (fileData as { uri?: unknown }).uri === "string"
                  ? String((fileData as { uri?: string }).uri)
                  : undefined
          }
        : undefined
    };
  });
}

export async function generateLyriaAudioGenAI(params: {
  prompt: string;
  model?: string;
  seed?: number;
}): Promise<GenAiLyriaResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Missing Google API key (set GOOGLE_API_KEY or GEMINI_API_KEY).");
  }

  const model = params.model ?? process.env.GENAI_LYRIA_MODEL ?? "lyria-3-clip-preview";
  const ai = new GoogleGenAI({ apiKey });

  const modelCandidates = buildModelCandidates(model);
  const modalityAttempts: Modality[][] = [
    [Modality.AUDIO],
    [Modality.AUDIO, Modality.TEXT]
  ];

  let lastResponse: unknown = null;
  let lastModelTried = model;
  let lastModalities: Modality[] = [];

  for (const modelName of modelCandidates) {
    for (const responseModalities of modalityAttempts) {
      lastModelTried = modelName;
      lastModalities = responseModalities;
      const response = await ai.models.generateContent({
        model: modelName,
        // Use explicit Content[] form (more robust across modalities than a raw string).
        contents: [{ role: "user", parts: [{ text: params.prompt }] }],
        config: {
          responseModalities,
          candidateCount: 1,
          seed: normalizeSeedInt32(params.seed)
        }
      });

      lastResponse = response;
      const candidates = response.candidates ?? [];

      // Fast-path: the SDK exposes a `data` convenience getter for inline data parts.
      // If the model returns inline audio, this should be populated.
      const responseData = dataToBase64((response as unknown as { data?: unknown }).data);
      if (responseData) {
        const firstMime =
          candidates[0]?.content?.parts?.find((p) => (p.inlineData?.mimeType ?? "").startsWith("audio/"))?.inlineData
            ?.mimeType ?? "";
        return {
          audioBase64: responseData,
          mimeType: firstMime || "audio/mpeg",
          rawResponse: response,
          modelResource: modelName,
          deployedModelId: undefined
        };
      }

      for (const cand of candidates) {
        const parts = cand.content?.parts ?? [];
        for (const part of parts) {
          const mimeType = part.inlineData?.mimeType ?? "";
          const b64 = dataToBase64(part.inlineData?.data);
          if (b64 && (!mimeType || mimeType.startsWith("audio/"))) {
            return {
              audioBase64: b64,
              mimeType: mimeType || "audio/mpeg",
              rawResponse: response,
              modelResource: modelName,
              deployedModelId: undefined
            };
          }
        }
      }
    }
  }

  const response = lastResponse as {
    candidates?: Array<{
      content?: { parts?: unknown[] };
      finishReason?: string;
      finishMessage?: string;
    }>;
    text?: unknown;
    promptFeedback?: unknown;
    sdkHttpResponse?: { status?: unknown };
  };
  const candidates = response?.candidates ?? [];
  const parts0 = candidates[0]?.content?.parts ?? [];
  const finishReason = candidates[0]?.finishReason ?? "unknown";
  const finishMessage = candidates[0]?.finishMessage ?? "";
  const responseText = response?.text;
  const promptFeedback = response?.promptFeedback;
  const httpStatus = response?.sdkHttpResponse?.status;
  const summary = summarizeParts(parts0);
  throw new Error(
    `GenAI Lyria response did not include inline audio data (finishReason=${finishReason}${
      finishMessage ? `; finishMessage=${JSON.stringify(finishMessage)}` : ""
    }${
      typeof httpStatus === "number" ? `; httpStatus=${httpStatus}` : ""
    }; modelTried=${lastModelTried}; modalities=${lastModalities.join(",")}). parts=${JSON.stringify(
      summary
    )}; promptFeedback=${JSON.stringify(promptFeedback)}; text=${JSON.stringify(
      typeof responseText === "string" ? responseText.slice(0, 600) : responseText
    )}`
  );
}
