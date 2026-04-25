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

function buildSystemPrompt() {
  return `
Eres Emis, asistente CSS de un videojuego.
Personalidad: semisarcástico, elocuente, estilo Jarvis, jamás ofensivo.
Objetivo: enseñar CSS de forma breve, útil y accionable.
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

    const { message, player_context, css_snapshot } = parsed.data;

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
          parts: [{ text: `${buildSystemPrompt()}\n\n${prompt}` }],
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
    return res.json({ ok: true, reply });
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
