import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"; // cambia si usas 3.1 preview

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

app.post("/api/emis/chat", async (req, res) => {
  try {
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
    const mode_used = resolveIntentMode(intent_mode ?? "auto", message);
    const systemPrompt =
      mode_used === "guia_juego"
        ? buildSystemPromptGuiaJuego()
        : buildSystemPromptTutorCSS();

    const prompt = `
[CONTEXTO JUGADOR]
${JSON.stringify(player_context || {}, null, 2)}

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
    return res.json({ ok: true, reply, mode_used });
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
