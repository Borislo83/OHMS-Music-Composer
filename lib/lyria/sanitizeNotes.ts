function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// Minimal, pragmatic safety-sanitizer for GenAI music prompts:
// - removes/rewrites artist-name requests that commonly trigger PROHIBITED_CONTENT
// - keeps the intended vibe by swapping in production descriptors
export function sanitizeUserNotesForMusicGenAI(input: string) {
  let text = input ?? "";
  text = text.replace(/\u0000/g, "");

  const lowered = text.toLowerCase();

  // Replace specific known artist-name requests with descriptors.
  // Add more mappings as you observe blocks.
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [
    {
      pattern: /\bdon\s+toliver\b/gi,
      replacement:
        "modern melodic trap / alt-R&B vibe (airy synths, smooth slides, punchy 808s, crisp hats)"
    }
  ];

  for (const r of replacements) {
    text = text.replace(r.pattern, r.replacement);
  }

  // Remove common "in the style of"/"type beat" phrasing (often tied to named artists).
  text = text.replace(/\b(in\s+the\s+style\s+of|in\s+style\s+of|sounds?\s+like)\b/gi, "");
  text = text.replace(/\btype\s+beat\b/gi, "");

  // If the note is just an artist name (or mostly), nudge it into descriptors.
  if (normalizeWhitespace(text).length <= 30 && lowered.includes("don toliver")) {
    text =
      "modern melodic trap / alt-R&B instrumental, dark moody synths, punchy 808, crisp hats, club energy";
  }

  return normalizeWhitespace(text);
}

