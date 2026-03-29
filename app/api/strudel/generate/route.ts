import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

function getApiKey() {
  return (
    process.env.GOOGLE_API_KEY ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    ""
  );
}

function extractCode(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown };
    if (typeof parsed.code === "string" && parsed.code.trim()) {
      return parsed.code.trim();
    }
  } catch {
    // fall through
  }

  const fence = trimmed.match(/```(?:strudel|js|javascript)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();

  return trimmed;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

const ALLOWED_GLOBAL_CALLS = new Set([
  "s",
  "sound",
  "note",
  "n",
  "freq",
  "stack",
  "cat",
  "seq",
  "silence",
  "samples",
  "chord",
  "voicing",
  "voicings",
  "scale",
  "add",
  "sub",
  "mul",
  "div",
  "sine",
  "sine2",
  "perlin",
  "rand",
  "irand",
  "pick",
  "run"
]);

const ALLOWED_METHOD_CALLS = new Set([
  "s",
  "sound",
  "note",
  "n",
  "freq",
  "gain",
  "speed",
  "pan",
  "room",
  "size",
  "cutoff",
  "resonance",
  "attack",
  "decay",
  "sustain",
  "release",
  "shape",
  "distort",
  "crush",
  "hpf",
  "lpf",
  "lpq",
  "slow",
  "fast",
  "stack",
  "cat",
  "seq",
  "add",
  "sub",
  "mul",
  "div",
  "range",
  "rangex",
  "range2",
  "scale",
  "chord",
  "voicing",
  "voicings",
  "off",
  "layer",
  "superimpose",
  "degradeBy",
  "bandpass",
  "vowel",
  "coarse",
  "compressor",
  "postgain",
  "delay",
  "delaytime",
  "delayfeedback",
  "orbit",
  "roomsize",
  "rsize",
  "phaser",
  "tremolo",
  "tremsync",
  "tremolosync",
  "jux",
  "juxBy",
  "mode",
  "dict",
  "set",
  "struct",
  "beat",
  "duckorbit",
  "duckattack",
  "duckdepth"
]);

const ALLOWED_SOUNDS = [
  "bd",
  "sd",
  "hh",
  "oh",
  "cp",
  "rim",
  "sine",
  "sawtooth",
  "square",
  "triangle",
  "white",
  "pink",
  "brown"
];

const ALLOWED_REFERENCE = [
  "Core constructors: s, sound, note, n, freq, stack, cat, seq, silence",
  "Tonal helpers: scale, chord, voicing/voicings",
  "Safe modifiers: fast, slow, gain, pan, speed, room, size, cutoff, resonance, attack, decay, sustain, release, shape, distort, crush, hpf, lpf, lpq",
  "Pattern ops: add, sub, mul, div, range, rangex, range2, off, layer, superimpose, degradeBy",
  `Common sounds/waves: ${ALLOWED_SOUNDS.join(", ")}`
].join("\n");

function hasBalancedBrackets(input: string) {
  const stack: string[] = [];
  const pairs: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{"
  };
  const opens = new Set(["(", "[", "{"]);
  const closes = new Set(Object.keys(pairs));

  for (const ch of input) {
    if (opens.has(ch)) stack.push(ch);
    if (closes.has(ch)) {
      const expectedOpen = pairs[ch];
      const actualOpen = stack.pop();
      if (actualOpen !== expectedOpen) return false;
    }
  }
  return stack.length === 0;
}

function getDisallowedCalls(code: string) {
  const disallowed = new Set<string>();
  const globalCallMatches = code.matchAll(/(^|[^\.\w$])([A-Za-z_]\w*)\s*\(/gm);
  for (const match of globalCallMatches) {
    const fn = match[2];
    if (!ALLOWED_GLOBAL_CALLS.has(fn)) disallowed.add(fn);
  }
  const methodCallMatches = code.matchAll(/\.([A-Za-z_]\w*)\s*\(/g);
  for (const match of methodCallMatches) {
    const method = match[1];
    if (!ALLOWED_METHOD_CALLS.has(method)) disallowed.add(method);
  }
  return [...disallowed];
}

function getSafeFallbackSnippet(prompt: string) {
  const p = prompt.toLowerCase();
  if (p.includes("ambient") || p.includes("pad")) {
    return 'stack(s("hh*8").gain(0.2), note("<c4 e4 g4 b4>").s("triangle").slow(2).room(0.5).size(2).gain(0.35))';
  }
  if (p.includes("drum") || p.includes("beat") || p.includes("techno")) {
    return 'stack(s("bd*4").gain(0.9), s("~ sd ~ sd").gain(0.7), s("hh*8").gain(0.35))';
  }
  return 'stack(s("bd sd hh*2").gain(0.8), note("c3 e3 g3 b3").s("sawtooth").gain(0.35).slow(2))';
}

function looksLikeRunnableStrudel(code: string) {
  const src = code.trim();
  if (!src) return false;
  if (src.includes("```")) return false;
  if (!hasBalancedBrackets(src)) return false;
  if (/\b(import|export|class|async function|require\()/.test(src)) return false;
  if (!/\b(s|note|n|freq|stack|cat|seq)\s*\(/.test(src)) return false;
  if (/\bundefined\b|\bnull\b/.test(src)) return false;
  if (getDisallowedCalls(src).length > 0) return false;
  return true;
}

export async function POST(request: Request) {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return jsonError("Missing Gemini API key on server.", 500);
    }

    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      model?: string;
      currentCode?: string;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const currentCode = typeof body.currentCode === "string" ? body.currentCode.trim() : "";
    const preferredModel = "gemini-3-flash-preview";

    if (!prompt) return jsonError("Prompt is required.", 400);
    if (prompt.length > 4000) return jsonError("Prompt too long.", 400);

    const ai = new GoogleGenAI({ apiKey });
    const instruction =
      [
        "You are a Strudel live-coding assistant.",
        "Return ONLY executable Strudel code as plain text.",
        "No markdown, no JSON, no backticks, no explanations.",
        "Use ONLY the documented allowlist below. Do not invent functions or methods.",
        ALLOWED_REFERENCE,
        "Use Strudel/Tidal-style mini-notation inside double quotes, e.g. s(\"bd sd hh\").",
        "Use valid JS chaining syntax only, e.g. note(\"c4 e4 g4\").s(\"sawtooth\").gain(0.8).",
        "Always return balanced brackets and valid function calls.",
        "Do not use import/export/require/class/function wrappers.",
        "Output 1 to 8 lines max and make it audible immediately.",
        "Include at least one audible pattern such as s(\"...\") or note(...).s(\"...\").",
        "Valid examples:",
        's("bd sd hh*2").gain(0.9)',
        'note("c4 e4 g4 b4").s("sawtooth").room(0.2)',
        'stack(s("bd*2"), s("~ sd").gain(0.8), note("<c4 e4 g4 b4>").s("sawtooth").gain(0.5))'
      ].join(" ");
    const userContent =
      [
        `Prompt: ${prompt}`,
        currentCode ? `Current code:\n${currentCode}` : "",
        "Return a single fresh snippet.",
        "Prefer simple, reliable syntax over advanced tricks."
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 16000);

    const runModel = async (model: string) =>
      ai.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: instruction }] },
          { role: "user", parts: [{ text: userContent }] }
        ],
        config: {
          temperature: 0.35
        }
      });

    const usedModel = preferredModel;
    const response = await runModel(preferredModel);

    const text =
      (response as { text?: string }).text ??
      (typeof (response as { candidates?: unknown[] }).candidates?.[0] === "object"
        ? JSON.stringify((response as { candidates?: unknown[] }).candidates?.[0])
        : "");
    let code = extractCode(text);

    if (!looksLikeRunnableStrudel(code)) {
      const disallowed = getDisallowedCalls(code);
      const repairInstruction = [
        "Fix this Strudel snippet so it is valid and runnable in the Strudel REPL.",
        "Return ONLY corrected Strudel code as plain text.",
        "No markdown, no explanations.",
        "Preserve musical intent but repair syntax and invalid functions.",
        "Must include audible output.",
        "Use ONLY this allowlist:",
        ALLOWED_REFERENCE,
        disallowed.length > 0 ? `Replace unsupported calls: ${disallowed.join(", ")}` : ""
      ].join(" ");

      const repairResponse = await ai.models.generateContent({
        model: preferredModel,
        contents: [
          { role: "user", parts: [{ text: repairInstruction }] },
          { role: "user", parts: [{ text: code }] }
        ],
        config: {
          temperature: 0.2
        }
      });

      const repairText =
        (repairResponse as { text?: string }).text ??
        (typeof (repairResponse as { candidates?: unknown[] }).candidates?.[0] === "object"
          ? JSON.stringify((repairResponse as { candidates?: unknown[] }).candidates?.[0])
          : "");
      code = extractCode(repairText);
    }

    if (!code) return jsonError("Model returned empty code.", 502);
    if (!looksLikeRunnableStrudel(code)) {
      code = getSafeFallbackSnippet(prompt);
    }

    return Response.json(
      {
        code,
        model: usedModel
      },
      { status: 200 }
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to generate Strudel code.", 500);
  }
}
