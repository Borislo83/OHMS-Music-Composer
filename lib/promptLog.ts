import { writeFile, mkdir, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

function safeNowStamp(date = new Date()) {
  // 2026-03-27T20-01-33.123Z (no colons, safe for filenames)
  return date.toISOString().replace(/:/g, "-");
}

function redactSecrets(text: string) {
  // Redact obvious API keys / bearer tokens if they accidentally end up in the prompt.
  return text
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza_REDACTED")
    .replace(/sb_secret_[0-9A-Za-z\-_]{10,}/g, "sb_secret_REDACTED")
    .replace(/Bearer\\s+[A-Za-z0-9\\-_.]+/gi, "Bearer REDACTED");
}

export async function appendPromptLog(params: {
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
}) {
  const enabled = process.env.SAVE_PROMPT_LOGS === "1";
  const disallowInProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (!enabled || disallowInProd) return;

  const dirPath = path.join(process.cwd(), "prompts", "logs");
  await mkdir(dirPath, { recursive: true });

  const id = randomUUID();
  const stamp = safeNowStamp();
  const filePath = path.join(dirPath, `${stamp}_${params.sessionId}_${id}.json`);

  const payload = {
    id,
    savedAt: new Date().toISOString(),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    seed: params.seed ?? null,
    negativePrompt: params.negativePrompt ?? "",
    prompt: redactSecrets(params.prompt)
  };

  try {
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    return;
  }

  // Also maintain a tiny index for easy viewing.
  const indexFilePath = path.join(dirPath, "index.jsonl");
  const line = JSON.stringify({
    id,
    savedAt: payload.savedAt,
    sessionId: payload.sessionId,
    provider: payload.provider,
    model: payload.model,
    seed: payload.seed,
    file: path.basename(filePath)
  });

  let prev = "";
  try {
    prev = await readFile(indexFilePath, "utf8");
  } catch {
    // ignore
  }
  const next = prev ? `${prev.trimEnd()}\n${line}\n` : `${line}\n`;
  try {
    await writeFile(indexFilePath, next, "utf8");
  } catch {
    return;
  }
}
