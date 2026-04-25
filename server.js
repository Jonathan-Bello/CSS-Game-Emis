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
 *   turn_count: number,
 *   last_activity_at: number,
 * }
 */
const conversationMemory = new Map();

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
    })
    .optional(),
  css_snapshot: z.string().max(10000).optional(),
  conversation_id: z.string().max(120).optional(),
});

function buildSystemPromptTutorCSS() {
  return `
Eres Emis, asistente CSS de un videojuego.
Personalidad: semisarcástico, elocuente, estilo Jarvis, jamás ofensivo.
Objetivo: tutorizar CSS de forma breve, útil y accionable.
Formato de respuesta:
1) Diagnóstico rápido
2) Sugerencia CSS (snippet corto)
3) Por qué funciona
4) Siguiente paso
Reglas:
- Prioriza propiedades simples y entendibles.
- Si falta contexto, pregunta 1 cosa puntual.
- No inventes APIs ni mecánicas que no se hayan dicho.
- Máximo 180 palabras.
`.trim();
}

function buildSystemPromptGuiaJuego() {
  return `
Eres Emis, guía dentro de un videojuego educativo de CSS.
Personalidad: semisarcástico, elocuente, estilo Jarvis, jamás ofensivo.
Objetivo: orientar progreso del jugador dentro del mundo y destrabar su siguiente acción.
Formato de respuesta:
1) Estado/objetivo actual (muy corto)
2) Qué hacer ahora (paso concreto)
3) Señal o pista para validar avance
Reglas:
- Prioriza navegación, misión, nivel y portales por encima de teoría extensa.
- Evita explicaciones largas de CSS salvo que el jugador lo pida explícitamente.
- Si falta contexto, pregunta 1 cosa puntual.
- No inventes zonas, NPCs, APIs ni mecánicas no mencionadas.
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
    turn_count: 0,
    last_activity_at: Date.now(),
  };
  conversationMemory.set(conversationId, initialState);
  return initialState;
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

    const { message, player_context, css_snapshot, intent_mode } = parsed.data;
    const conversation_id =
      parsed.data.conversation_id?.trim() || crypto.randomUUID();
    const state = getOrCreateConversationState(conversation_id);
    state.last_activity_at = Date.now();
    const mode_used = resolveIntentMode(intent_mode ?? "auto", message);
    const systemPrompt =
      mode_used === "guia_juego"
        ? buildSystemPromptGuiaJuego()
        : buildSystemPromptTutorCSS();

    let updatedPlayerProfile = state.player_profile;
    try {
      updatedPlayerProfile = await buildPlayerProfile(ai, state, player_context);
      state.player_profile = updatedPlayerProfile;
    } catch (profileError) {
      console.warn("No se pudo refrescar player_profile:", profileError.message);
    }

    const recentTurnsText =
      state.recent_messages
        .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
        .join("\n") || "(sin historial reciente)";

    const prompt = `
[RESUMEN ACUMULADO]
${state.running_summary || "(sin resumen todavía)"}

[ÚLTIMOS TURNOS]
${recentTurnsText}

[CONTEXTO JUGADOR]
${JSON.stringify(player_context || {}, null, 2)}

[PERFIL DEL JUGADOR]
${JSON.stringify(updatedPlayerProfile, null, 2)}

[CSS ACTUAL]
${css_snapshot || "(sin css)"}

[PREGUNTA]
${message}
`.trim();

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
        maxOutputTokens: 300,
        // si usas 2.5 y quieres ahorrar:
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const reply =
      response?.text?.trim() ||
      "No pude responder ahora mismo. Intenta otra vez.";

    state.recent_messages.push({ role: "user", text: message });
    state.recent_messages.push({ role: "assistant", text: reply });
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

    return res.json({ ok: true, reply, mode_used, conversation_id });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Error interno del servidor" });
  }
});

app.listen(port, () => {
  console.log(`Emis backend corriendo en http://localhost:${port}`);
});
