import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"; // cambia si usas 3.1 preview
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_MESSAGES = 8; // 4 turnos completos (user+assistant)
const SUMMARY_EVERY_TURNS = 5;
const RECENT_MESSAGES_AFTER_SUMMARY = 4; // mantiene los 2 últimos turnos completos
const MAX_SUMMARY_CHARS = 1200;
const TOKEN_BUDGET_10M = 5000;
const TOKEN_BUDGET_DAY = 30000;
const NEAR_BUDGET_THRESHOLD = 0.9;
const MAX_CSS_BLOCK_LENGTH = 500;
const MAX_SANITIZED_CSS_LENGTH = 2500;
const MAX_REPLY_LENGTH = 1100;
const SECURITY_NEUTRAL_REPLY =
  "No puedo ayudar con esa solicitud. Si quieres, pregúntame algo de CSS (selector, propiedad, layout) o sobre tu progreso actual en el juego.";
const JAILBREAK_PATTERNS = [
  /ignora(?:r)?\s+(?:las?\s+)?reglas?/i,
  /revela(?:r)?\s+(?:el\s+)?prompt/i,
  /act[úu]a\s+como\s+sistema/i,
  /ignore\s+(?:all\s+)?rules?/i,
  /reveal\s+(?:the\s+)?prompt/i,
  /act\s+as\s+system/i,
];
const OUT_OF_SCOPE_PATTERNS = [
  /hack(?:ear|ing)?/i,
  /malware/i,
  /phishing/i,
  /fraude/i,
  /bypass/i,
  /tarjeta\s+de\s+cr[eé]dito/i,
];
const NON_CSS_LINE_PATTERNS = [
  /^\s*</, // HTML/XML
  /^\s*(?:https?:\/\/|www\.)/i,
  /^\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b/i,
  /^\s*(?:function|const|let|var)\b/i,
];

/**
 * conversationMemory guarda estado ligero por conversación para ahorrar tokens.
 * key: conversation_id
 * value: {
 *   recent_messages: Array<{ role: "user" | "assistant", text: string }>,
 *   running_summary: string,
 *   player_profile: {
 *     frequent_css_errors: string[],
 *     current_level: string,
 *     learning_style: string,
 *   },
 *   token_usage_events: Array<{ at: number, tokens: number }>,
 *   turn_count: number,
 *   last_activity_at: number,
 * }
 */
const conversationMemory = new Map();
const securityEventCountersByIp = new Map();
const securityEventCountersByConversation = new Map();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// Ajusta orígenes según tu caso (web export / tools)
app.use(
  cors({
    origin: true,
    methods: ["POST", "GET"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 req/min por IP
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "emis-backend" });
});

const ChatSchema = z.object({
  message: z.string().min(1).max(1200),
  intent_mode: z.enum(["tutor_css", "guia_juego", "auto"]).optional(),
  player_context: z
    .object({
      screen: z.string().optional(), // ej: bullet_creator
      level: z.string().optional(), // ej: nivel_2
      objective: z.string().optional(), // ej: crear bala con más daño
      unlocked_css: z.array(z.string()).optional(),
      zone_id: z.string().max(120).optional(),
      quest_id: z.string().max(120).optional(),
      quest_step: z.string().max(120).optional(),
      nearby_npcs: z.array(z.string().max(120)).max(20).optional(),
      available_portals: z.array(z.string().max(120)).max(20).optional(),
      inventory_tags: z.array(z.string().max(120)).max(40).optional(),
      failed_attempts_css: z.array(z.string().max(120)).max(30).optional(),
    })
    .optional(),
  css_snapshot_fragment: z.string().max(10000).optional(),
  css_snapshot: z.string().max(10000).optional(),
  conversation_id: z.string().max(120).optional(),
});

const LOCAL_LEVEL_TIPS = {
  nivel_1:
    "Tip nivel_1: empieza con selectores simples (.clase, #id) y ajusta color + font-size antes de tocar layout.",
  nivel_2:
    "Tip nivel_2: activa display:flex en el contenedor y prueba justify-content + align-items para alinear elementos rápido.",
  nivel_3:
    "Tip nivel_3: usa grid-template-columns con unidades fr para dividir espacio sin números mágicos.",
  nivel_4:
    "Tip nivel_4: combina position:relative en el padre con position:absolute en hijos solo cuando necesites overlays precisos.",
  default:
    "Tip general: prueba cambios pequeños (1 propiedad por intento) y valida visualmente qué propiedad causó el efecto.",
};

function buildSystemPromptTutorCSS() {
  return `
Eres Emis, asistente CSS de un videojuego.
Personalidad: semisarcástico, elocuente, estilo Jarvis, jamás ofensivo.
Objetivo: tutorizar CSS de forma breve, útil y accionable.
Formato de salida:
- Devuelve ÚNICAMENTE JSON válido con esta forma exacta:
{
  "reply": "texto para el jugador",
  "suggested_action_code": "CODIGO_ACCION_EN_MAYUSCULAS"
}
Formato de "reply":
1) Diagnóstico rápido
2) Sugerencia CSS (snippet corto)
3) Por qué funciona
4) Siguiente paso
Reglas:
- Prioriza propiedades simples y entendibles.
- Si falta contexto, pregunta 1 cosa puntual.
- No inventes APIs ni mecánicas que no se hayan dicho.
- Solo puedes recomendar rutas/mecánicas presentes en game_context.
- Máximo 180 palabras.
`.trim();
}

function buildSystemPromptGuiaJuego() {
  return `
Eres Emis, guía dentro de un videojuego educativo de CSS.
Personalidad: semisarcástico, elocuente, estilo Jarvis, jamás ofensivo.
Objetivo: orientar progreso del jugador dentro del mundo y destrabar su siguiente acción.
Formato de salida:
- Devuelve ÚNICAMENTE JSON válido con esta forma exacta:
{
  "reply": "texto para el jugador",
  "suggested_action_code": "CODIGO_ACCION_EN_MAYUSCULAS"
}
Formato de "reply":
1) Estado/objetivo actual (muy corto)
2) Qué hacer ahora (paso concreto)
3) Señal o pista para validar avance
Reglas:
- Prioriza navegación, misión, nivel y portales por encima de teoría extensa.
- Evita explicaciones largas de CSS salvo que el jugador lo pida explícitamente.
- Si falta contexto, pregunta 1 cosa puntual.
- No inventes zonas, NPCs, APIs ni mecánicas no mencionadas.
- Solo puedes recomendar rutas/mecánicas presentes en game_context.
- Máximo 140 palabras.
`.trim();
}

const CSS_INTENT_TERMS = [
  "display",
  "flex",
  "grid",
  "selector",
  "padding",
  "margin",
  "color",
  "position",
  "class",
  "id",
  "css",
];

const GAME_INTENT_TERMS = [
  "dónde",
  "donde",
  "mision",
  "misión",
  "portal",
  "nivel",
  "objetivo",
  "progreso",
  "mapa",
  "ir a",
];

function resolveIntentMode(intentMode, message) {
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

function pruneExpiredConversations() {
  const now = Date.now();
  for (const [conversationId, entry] of conversationMemory.entries()) {
    if (now - entry.last_activity_at > CONVERSATION_TTL_MS) {
      conversationMemory.delete(conversationId);
    }
  }
}

function getOrCreateConversationState(conversationId) {
  const existing = conversationMemory.get(conversationId);
  if (existing) return existing;

  const initialState = {
    recent_messages: [],
    running_summary: "",
    player_profile: {
      frequent_css_errors: [],
      current_level: "desconocido",
      learning_style: "desconocido",
    },
    token_usage_events: [],
    turn_count: 0,
    last_activity_at: Date.now(),
  };
  conversationMemory.set(conversationId, initialState);
  return initialState;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function uniqStrings(values = []) {
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

function compressPlayerContext(playerContext) {
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

function parseModelReply(rawText = "") {
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

function compactCssText(text, maxLen = 1600) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n/* ...css truncado para ahorrar tokens... */`;
}

function detectJailbreakAttempt(message = "") {
  const normalized = String(message);
  const matchedPattern = JAILBREAK_PATTERNS.find((pattern) =>
    pattern.test(normalized),
  );
  return {
    isJailbreak: Boolean(matchedPattern),
    matchedPattern: matchedPattern ? String(matchedPattern) : null,
  };
}

function sanitizeCssSnapshot(cssSnapshot = "") {
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

function postFilterReply(reply = "", mode = "tutor_css") {
  const normalizedReply = String(reply || "").trim();
  const tooLong = normalizedReply.length > MAX_REPLY_LENGTH;
  const hasOutOfScopeContent = OUT_OF_SCOPE_PATTERNS.some((pattern) =>
    pattern.test(normalizedReply),
  );
  const hasPromptLeak = /system prompt|prompt interno|instrucciones internas/i.test(
    normalizedReply,
  );

  const lacksRoleAlignment =
    mode === "tutor_css"
      ? !/(css|selector|propiedad|layout|estilo|clase|id)/i.test(normalizedReply)
      : !/(quest|misi[oó]n|nivel|portal|objetivo|progreso|mapa)/i.test(
          normalizedReply,
        );

  const blocked = tooLong || hasOutOfScopeContent || hasPromptLeak || lacksRoleAlignment;
  return {
    blocked,
    tooLong,
    hasOutOfScopeContent,
    hasPromptLeak,
    lacksRoleAlignment,
    sanitizedReply: tooLong ? normalizedReply.slice(0, MAX_REPLY_LENGTH) : normalizedReply,
  };
}

function registerSecurityEvent({ ip, conversationId, event, details = {} }) {
  const nextIpCount = (securityEventCountersByIp.get(ip) || 0) + 1;
  securityEventCountersByIp.set(ip, nextIpCount);
  const nextConversationCount =
    (securityEventCountersByConversation.get(conversationId) || 0) + 1;
  securityEventCountersByConversation.set(conversationId, nextConversationCount);

  console.warn(
    JSON.stringify({
      event: "emis_security_event",
      security_event_type: event,
      ip,
      conversation_id: conversationId,
      ip_event_count: nextIpCount,
      conversation_event_count: nextConversationCount,
      details,
    }),
  );
}

function compressCssSnapshot(cssSnapshot, playerContext, message, state) {
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

function getBudgetStatus(state, now = Date.now()) {
  const tenMinWindowMs = 10 * 60 * 1000;
  const dayWindowMs = 24 * 60 * 60 * 1000;
  const tenMinStart = now - tenMinWindowMs;
  const dayStart = now - dayWindowMs;

  state.token_usage_events = state.token_usage_events.filter(
    (event) => event.at >= dayStart,
  );

  const used10m = state.token_usage_events
    .filter((event) => event.at >= tenMinStart)
    .reduce((sum, event) => sum + event.tokens, 0);
  const usedDay = state.token_usage_events.reduce(
    (sum, event) => sum + event.tokens,
    0,
  );

  return {
    used10m,
    usedDay,
    remaining10m: Math.max(0, TOKEN_BUDGET_10M - used10m),
    remainingDay: Math.max(0, TOKEN_BUDGET_DAY - usedDay),
    isNearLimit:
      used10m >= TOKEN_BUDGET_10M * NEAR_BUDGET_THRESHOLD ||
      usedDay >= TOKEN_BUDGET_DAY * NEAR_BUDGET_THRESHOLD,
    isAtLimit: used10m >= TOKEN_BUDGET_10M || usedDay >= TOKEN_BUDGET_DAY,
  };
}

function registerTokenUsage(state, tokens, at = Date.now()) {
  if (!tokens || tokens <= 0) return;
  state.token_usage_events.push({ at, tokens });
}

function selectOutputTokenBudget(message) {
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

function resolveLevelFromContext(playerContext = {}) {
  if (!playerContext || typeof playerContext !== "object") return "default";
  const normalizedLevel = String(playerContext.level || "")
    .trim()
    .toLowerCase();
  return normalizedLevel || "default";
}

function buildLocalFallback({ modeUsed = "tutor_css", playerContext = {} }) {
  const level = resolveLevelFromContext(playerContext);
  const tip = LOCAL_LEVEL_TIPS[level] || LOCAL_LEVEL_TIPS.default;
  const modeLead =
    modeUsed === "guia_juego"
      ? "No pude contactar al motor remoto, así que voy con guía local."
      : "No pude contactar al motor remoto, así que voy con tutor local.";

  return {
    reply: `${modeLead} ${tip}`,
    suggested_action_code:
      modeUsed === "guia_juego" ? "OPEN_CURRENT_QUEST_LOG" : "APPLY_LEVEL_TIP",
    follow_up_question:
      modeUsed === "guia_juego"
        ? "¿Cuál es tu quest_step actual para darte un paso exacto?"
        : "¿Qué propiedad CSS estás intentando ajustar ahora?",
  };
}

async function buildPlayerProfile(aiClient, state, playerContext) {
  const profilePrompt = `
Actualiza SOLO este perfil JSON del alumno basado en el contexto nuevo:
${JSON.stringify(state.player_profile)}

Contexto del jugador:
${JSON.stringify(playerContext || {}, null, 2)}

Devuelve ÚNICAMENTE JSON válido con forma exacta:
{
  "frequent_css_errors": ["..."],
  "current_level": "...",
  "learning_style": "..."
}
Reglas:
- frequent_css_errors: máximo 4 strings cortos.
- current_level y learning_style: una frase breve.
`.trim();

  const profileResponse = await aiClient.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: profilePrompt }] }],
    config: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 180,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = profileResponse?.text?.trim() || "";
  const normalizedRaw = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(normalizedRaw);
  if (
    !parsed ||
    !Array.isArray(parsed.frequent_css_errors) ||
    typeof parsed.current_level !== "string" ||
    typeof parsed.learning_style !== "string"
  ) {
    throw new Error("Formato de perfil inválido");
  }

  return {
    frequent_css_errors: parsed.frequent_css_errors.slice(0, 4).map(String),
    current_level: parsed.current_level.slice(0, 120),
    learning_style: parsed.learning_style.slice(0, 120),
  };
}

async function refreshRunningSummary(aiClient, state) {
  const messagesToSummarize = state.recent_messages
    .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
    .join("\n");

  const summaryPrompt = `
Resume la conversación para memoria de tutor (60-90 palabras).
Incluye: progreso del alumno, dudas pendientes, y próximo paso recomendado.
No repitas literalmente frases largas.

Resumen previo:
${state.running_summary || "(vacío)"}

Mensajes recientes:
${messagesToSummarize || "(sin mensajes)"}
`.trim();

  const summaryResponse = await aiClient.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: summaryPrompt }] }],
    config: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 180,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const summaryText = (summaryResponse?.text?.trim() || "").slice(
    0,
    MAX_SUMMARY_CHARS,
  );
  state.running_summary = summaryText || state.running_summary;
  state.recent_messages = state.recent_messages.slice(
    -RECENT_MESSAGES_AFTER_SUMMARY,
  );
}

app.post("/api/emis/chat", async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    pruneExpiredConversations();

    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Payload inválido",
          details: parsed.error.flatten(),
        });
    }

    const { message, player_context, css_snapshot, css_snapshot_fragment, intent_mode } =
      parsed.data;
    const requestIp = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
    const conversation_id =
      parsed.data.conversation_id?.trim() || crypto.randomUUID();
    const state = getOrCreateConversationState(conversation_id);
    const jailbreakDetection = detectJailbreakAttempt(message);
    if (jailbreakDetection.isJailbreak) {
      registerSecurityEvent({
        ip: requestIp,
        conversationId: conversation_id,
        event: "jailbreak_attempt_pre_filter",
        details: {
          matchedPattern: jailbreakDetection.matchedPattern,
          message_preview: message.slice(0, 180),
        },
      });
      return res.json({
        ok: true,
        reply: SECURITY_NEUTRAL_REPLY,
        suggested_action_code: "ASK_VALID_CSS_OR_PROGRESS_QUESTION",
        mode_used: "security_neutral",
        conversation_id,
        follow_up_question: null,
      });
    }

    state.last_activity_at = Date.now();
    const mode_used = resolveIntentMode(intent_mode ?? "auto", message);
    const systemPrompt =
      mode_used === "guia_juego"
        ? buildSystemPromptGuiaJuego()
        : buildSystemPromptTutorCSS();
    const compressedPlayerContext = compressPlayerContext(player_context);
    const cssSnapshotInput = css_snapshot_fragment || css_snapshot || "";
    const sanitizedCssSnapshot = sanitizeCssSnapshot(cssSnapshotInput);
    const compressedCssSnapshot = compressCssSnapshot(
      sanitizedCssSnapshot,
      compressedPlayerContext,
      message,
      state,
    );

    const budgetBefore = getBudgetStatus(state);
    if (budgetBefore.isAtLimit) {
      const ultraBriefReply =
        "Estoy en modo ahorro extremo. Haz una pregunta más específica (selector + propiedad + resultado esperado).";
      const inputSize = message.length + (compressedCssSnapshot?.length || 0);
      const estimatedInputTokens = estimateTokens(message);
      const estimatedOutputTokens = estimateTokens(ultraBriefReply);
      registerTokenUsage(state, estimatedInputTokens + estimatedOutputTokens);
      const latencyMs = Date.now() - requestStartedAt;
      console.info(
        JSON.stringify({
          event: "emis_chat_metrics",
          conversation_id,
          input_size: inputSize,
          estimated_tokens: estimatedInputTokens + estimatedOutputTokens,
          latency_ms: latencyMs,
          mode_used: "ultra_brief_budget",
        }),
      );

      return res.json({
        ok: true,
        reply: ultraBriefReply,
        suggested_action_code: "REFINE_QUESTION",
        mode_used: "ultra_brief_budget",
        conversation_id,
        follow_up_question: null,
      });
    }

    let updatedPlayerProfile = state.player_profile;
    if (!budgetBefore.isNearLimit) {
      try {
        updatedPlayerProfile = await buildPlayerProfile(
          ai,
          state,
          compressedPlayerContext,
        );
        state.player_profile = updatedPlayerProfile;
      } catch (profileError) {
        console.warn("No se pudo refrescar player_profile:", profileError.message);
      }
    }

    const recentTurnsText =
      state.recent_messages
        .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
        .join("\n") || "(sin historial reciente)";

    const gameContext = compressedPlayerContext || {};
    if (mode_used === "guia_juego" && (!gameContext.quest_id || !gameContext.quest_step)) {
      const clarificationReply =
        "Para guiarte bien, dime tu quest_id y quest_step actuales.";
      const estimatedOutputTokens = estimateTokens(clarificationReply);
      registerTokenUsage(state, estimateTokens(message) + estimatedOutputTokens);

      state.recent_messages.push({ role: "user", text: message });
      state.recent_messages.push({ role: "assistant", text: clarificationReply });
      state.recent_messages = state.recent_messages.slice(-MAX_RECENT_MESSAGES);
      state.turn_count += 1;
      state.last_activity_at = Date.now();

      return res.json({
        ok: true,
        reply: clarificationReply,
        suggested_action_code: "PROVIDE_QUEST_CONTEXT",
        mode_used,
        conversation_id,
        follow_up_question: "¿Cuál es tu quest_step exacto ahora mismo?",
      });
    }

    const prompt = `
[RESUMEN ACUMULADO]
${state.running_summary || "(sin resumen todavía)"}

[ÚLTIMOS TURNOS]
${recentTurnsText}

[GAME CONTEXT]
${JSON.stringify(gameContext, null, 2)}

[PERFIL DEL JUGADOR]
${JSON.stringify(updatedPlayerProfile, null, 2)}

[CSS ACTUAL]
${compressedCssSnapshot || "(sin css)"}

[PREGUNTA]
${message}
`.trim();

    const estimatedInputTokens = estimateTokens(`${systemPrompt}\n\n${prompt}`);
    const { maxOutputTokens: selectedMaxOutputTokens, response_mode } =
      selectOutputTokenBudget(message);
    const dynamicMaxOutputTokens = Math.max(
      120,
      Math.min(
        selectedMaxOutputTokens,
        budgetBefore.remaining10m,
        budgetBefore.remainingDay,
      ),
    );

    let parsedModelReply;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${prompt}` }],
          },
        ],
        config: {
          temperature: 0.6,
          topP: 0.9,
          maxOutputTokens: dynamicMaxOutputTokens,
          // si usas 2.5 y quieres ahorrar:
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      parsedModelReply = parseModelReply(response?.text || "");
    } catch (modelError) {
      console.warn("Fallo de modelo remoto, aplicando fallback local:", modelError.message);
      parsedModelReply = buildLocalFallback({
        modeUsed: mode_used,
        playerContext: compressedPlayerContext,
      });
    }

    const { reply, suggested_action_code, follow_up_question = null } =
      parsedModelReply;
    const postFilter = postFilterReply(reply, mode_used);
    if (postFilter.blocked) {
      registerSecurityEvent({
        ip: requestIp,
        conversationId: conversation_id,
        event: "model_output_blocked_post_filter",
        details: {
          tooLong: postFilter.tooLong,
          hasOutOfScopeContent: postFilter.hasOutOfScopeContent,
          hasPromptLeak: postFilter.hasPromptLeak,
          lacksRoleAlignment: postFilter.lacksRoleAlignment,
        },
      });
    }
    const finalReply = postFilter.blocked
      ? SECURITY_NEUTRAL_REPLY
      : postFilter.sanitizedReply;
    const finalSuggestedActionCode = postFilter.blocked
      ? "ASK_VALID_CSS_OR_PROGRESS_QUESTION"
      : suggested_action_code;
    const estimatedOutputTokens = estimateTokens(finalReply);
    registerTokenUsage(state, estimatedInputTokens + estimatedOutputTokens);

    state.recent_messages.push({ role: "user", text: message });
    state.recent_messages.push({ role: "assistant", text: finalReply });
    state.recent_messages = state.recent_messages.slice(-MAX_RECENT_MESSAGES);
    state.turn_count += 1;
    state.last_activity_at = Date.now();

    if (state.turn_count % SUMMARY_EVERY_TURNS === 0) {
      try {
        await refreshRunningSummary(ai, state);
      } catch (summaryError) {
        console.warn("No se pudo refrescar running_summary:", summaryError.message);
      }
    }

    const latencyMs = Date.now() - requestStartedAt;
    console.info(
      JSON.stringify({
        event: "emis_chat_metrics",
        conversation_id,
        input_size: prompt.length,
        estimated_tokens: estimatedInputTokens + estimatedOutputTokens,
        latency_ms: latencyMs,
        mode_used: response_mode,
      }),
    );

    return res.json({
      ok: true,
      reply: finalReply,
      suggested_action_code: finalSuggestedActionCode,
      mode_used,
      conversation_id,
      follow_up_question,
    });
  } catch (err) {
    console.error(err);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const safeConversationId =
      typeof body.conversation_id === "string" && body.conversation_id.trim()
        ? body.conversation_id.trim().slice(0, 120)
        : crypto.randomUUID();
    const safeIntentMode =
      body.intent_mode === "guia_juego" || body.intent_mode === "tutor_css"
        ? body.intent_mode
        : "tutor_css";
    const fallback = buildLocalFallback({
      modeUsed: safeIntentMode,
      playerContext: body.player_context || {},
    });

    return res.status(200).json({
      ok: true,
      reply: fallback.reply,
      conversation_id: safeConversationId,
      mode_used: "local_fallback",
      suggested_action_code: fallback.suggested_action_code,
      follow_up_question: fallback.follow_up_question,
    });
  }
});

app.listen(port, () => {
  console.log(`Emis backend corriendo en http://localhost:${port}`);
});
