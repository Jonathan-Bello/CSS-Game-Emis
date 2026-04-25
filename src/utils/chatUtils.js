import {
  MAX_CSS_BLOCK_LENGTH,
  MAX_SANITIZED_CSS_LENGTH,
  CSS_INTENT_TERMS,
  GAME_INTENT_TERMS,
  NON_CSS_LINE_PATTERNS,
} from "../config/constants.js";

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function uniqStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value).trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function compressPlayerContext(playerContext) {
  if (!playerContext) return undefined;
  return {
    ...playerContext,
    unlocked_css: uniqStrings(playerContext.unlocked_css || []),
    nearby_npcs: uniqStrings(playerContext.nearby_npcs || []),
    available_portals: uniqStrings(playerContext.available_portals || []),
    inventory_tags: uniqStrings(playerContext.inventory_tags || []),
    failed_attempts_css: uniqStrings(playerContext.failed_attempts_css || []),
  };
}

export function parseModelReply(rawText = "") {
  const cleaned = String(rawText).trim().replace(/```json|```/g, "").trim();
  if (!cleaned) {
    return {
      reply: "No pude responder ahora mismo. Intenta otra vez.",
      suggested_action_code: "RETRY_REQUEST",
    };
  }

  try {
    const parsed = JSON.parse(cleaned);
    const reply = String(parsed?.reply || "").trim();
    const suggested_action_code = String(parsed?.suggested_action_code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .slice(0, 80);

    if (!reply) throw new Error("reply vacío");
    return {
      reply,
      suggested_action_code: suggested_action_code || "FOLLOW_GUIDANCE",
    };
  } catch {
    return {
      reply: cleaned.slice(0, 1000),
      suggested_action_code: "FOLLOW_GUIDANCE",
    };
  }
}

export function compactCssText(text, maxLen = 1600) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n/* ...css truncado para ahorrar tokens... */`;
}

export function sanitizeCssSnapshot(cssSnapshot = "") {
  if (!cssSnapshot) return "";
  const cssText = String(cssSnapshot);
  const cleanedLines = cssText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const matchesNonCss = NON_CSS_LINE_PATTERNS.some((pattern) =>
        pattern.test(trimmed),
      );
      return !matchesNonCss;
    });

  const cleanedText = cleanedLines.join("\n");
  const blockMatches = Array.from(cleanedText.matchAll(/([^{}]+)\{([^{}]*)\}/g));
  if (!blockMatches.length) {
    return compactCssText(cleanedText, Math.min(MAX_SANITIZED_CSS_LENGTH, 1200));
  }

  const sanitizedBlocks = blockMatches.map((match) => {
    const selector = String(match[1] || "").trim().slice(0, 120);
    const body = String(match[2] || "").trim().slice(0, MAX_CSS_BLOCK_LENGTH);
    return `${selector} {\n${body}\n}`;
  });

  return compactCssText(
    sanitizedBlocks.join("\n\n"),
    MAX_SANITIZED_CSS_LENGTH,
  );
}

export function compressCssSnapshot(cssSnapshot, playerContext, message, state) {
  if (!cssSnapshot) return "";

  const hintText = [
    playerContext?.level,
    playerContext?.screen,
    playerContext?.objective,
    message,
    ...state.recent_messages.filter((m) => m.role === "user").slice(-2).map((m) => m.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hintedSelectors = Array.from(
    new Set(
      (hintText.match(/[.#][a-z0-9_-]+/gi) || []).map((s) => s.toLowerCase()),
    ),
  );

  const blockMatches = Array.from(cssSnapshot.matchAll(/([^{}]+)\{[^{}]*\}/g));
  if (!blockMatches.length) {
    return compactCssText(cssSnapshot, 1600);
  }

  const usefulBlocks = blockMatches
    .map((match) => match[0].trim())
    .filter((block) => {
      const selector = block.split("{")[0].toLowerCase();
      if (hintedSelectors.some((token) => selector.includes(token))) return true;
      if (playerContext?.level && selector.includes(playerContext.level.toLowerCase())) {
        return true;
      }
      if (playerContext?.screen && selector.includes(playerContext.screen.toLowerCase())) {
        return true;
      }
      return false;
    });

  if (!usefulBlocks.length) {
    return compactCssText(
      blockMatches
        .slice(-6)
        .map((m) => m[0].trim())
        .join("\n\n"),
      1800,
    );
  }

  return compactCssText(usefulBlocks.join("\n\n"), 1800);
}

export function resolveIntentMode(intentMode, message) {
  if (intentMode === "tutor_css" || intentMode === "guia_juego") {
    return intentMode;
  }

  const normalizedMessage = message.toLowerCase();
  const hasCssTerms = CSS_INTENT_TERMS.some((term) =>
    normalizedMessage.includes(term),
  );
  if (hasCssTerms) return "tutor_css";

  const hasGameTerms = GAME_INTENT_TERMS.some((term) =>
    normalizedMessage.includes(term),
  );
  if (hasGameTerms) return "guia_juego";

  return "tutor_css";
}

export function selectOutputTokenBudget(message) {
  const normalized = message.toLowerCase();
  const asksExplanationOrCode = [
    "explica",
    "por qué",
    "porque",
    "snippet",
    "ejemplo",
    "código",
    "codigo",
    "muestra",
  ].some((term) => normalized.includes(term));

  if (asksExplanationOrCode) {
    return { maxOutputTokens: 240, response_mode: "explain_snippet" };
  }
  return { maxOutputTokens: 140, response_mode: "simple_doubt" };
}
