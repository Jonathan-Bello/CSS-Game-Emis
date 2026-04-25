import {
  LOCAL_LEVEL_TIPS,
  MAX_SUMMARY_CHARS,
  MODEL,
  RECENT_MESSAGES_AFTER_SUMMARY,
} from "../config/constants.js";

export function buildSystemPromptTutorCSS() {
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

export function buildSystemPromptGuiaJuego() {
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

function resolveLevelFromContext(playerContext = {}) {
  if (!playerContext || typeof playerContext !== "object") return "default";
  const normalizedLevel = String(playerContext.level || "")
    .trim()
    .toLowerCase();
  return normalizedLevel || "default";
}

export function buildLocalFallback({ modeUsed = "tutor_css", playerContext = {} }) {
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

export async function buildPlayerProfile(aiClient, state, playerContext) {
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

export async function refreshRunningSummary(aiClient, state) {
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
