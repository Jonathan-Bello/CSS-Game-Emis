import crypto from "node:crypto";
import { ChatSchema } from "../validation/chatSchema.js";
import {
  SECURITY_NEUTRAL_REPLY,
  MAX_RECENT_MESSAGES,
  MODEL,
  SUMMARY_EVERY_TURNS,
} from "../config/constants.js";
import {
  getBudgetStatus,
  getOrCreateConversationState,
  pruneExpiredConversations,
  registerTokenUsage,
} from "../services/conversationService.js";
import {
  detectJailbreakAttempt,
  postFilterReply,
  registerSecurityEvent,
} from "../services/securityService.js";
import {
  buildLocalFallback,
  buildPlayerProfile,
  buildSystemPromptGuiaJuego,
  buildSystemPromptTutorCSS,
  refreshRunningSummary,
} from "../services/aiService.js";
import {
  compressCssSnapshot,
  compressPlayerContext,
  estimateTokens,
  parseModelReply,
  resolveIntentMode,
  sanitizeCssSnapshot,
  selectOutputTokenBudget,
  isGreetingOnly,
} from "../utils/chatUtils.js";
import {
  generateDebugFlags,
  printDebugFlags,
} from "../utils/debugFlags.js";

function readPlayerApiKey(req) {
  const rawHeader = req.get("X-Hemis-Api-Key") || req.get("X-Emis-Api-Key") || "";
  return rawHeader.trim();
}

function isAuthModelError(error) {
  const status = Number(error?.status || error?.code || error?.response?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    message.includes("api key") ||
    message.includes("apikey") ||
    message.includes("permission") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  );
}

export function createChatHandler(createAiClient) {
  return async function chatHandler(req, res) {
    try {
      const requestStartedAt = Date.now();
      const requestId = crypto.randomUUID().slice(0, 8);
      pruneExpiredConversations();

      const playerApiKey = readPlayerApiKey(req);
      if (!playerApiKey) {
        return res.status(401).json({
          ok: false,
          error: "API key de Gemini requerida para usar Hemis.",
          code: "missing_api_key",
        });
      }

      const parsed = ChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "Payload inválido",
          details: parsed.error.flatten(),
        });
      }

      // 🚩 BANDERAS DE DEBUG - Verificar contexto recibido
      const debugFlags = generateDebugFlags(req.body);
      printDebugFlags(debugFlags, requestId);

      const {
        message,
        player_context,
        css_snapshot,
        css_snapshot_fragment,
        intent_mode,
        chat_surface = "bullet_creator",
      } = parsed.data;
      const aiClient = createAiClient(playerApiKey);
      const requestIp = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
      const conversation_id = parsed.data.conversation_id?.trim() || crypto.randomUUID();
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
      const mode_used = resolveIntentMode(intent_mode ?? "auto", message, chat_surface);
      if (isGreetingOnly(message)) {
        const greetingContext = compressPlayerContext(player_context) || {};
        const place = String(
          greetingContext.current_area_description ||
            greetingContext.zone_id ||
            greetingContext.level ||
            "la zona actual",
        );
        const objectiveText = String(
          greetingContext.objective ||
            "si quieres, dime que ves y te marco el siguiente paso",
        );
        const greetingReply =
          chat_surface === "general_chat"
            ? `Hola, soy Hemis. Te tengo ubicado en ${place}. Objetivo actual: ${objectiveText}. Si quieres, preguntame por la ruta, el puzzle o si tu bala actual te conviene.`
            : "Hola, soy Hemis. Dime que propiedad CSS, forma o comportamiento quieres ajustar en tu bala y lo revisamos.";
        state.recent_messages.push({ role: "user", text: message });
        state.recent_messages.push({ role: "assistant", text: greetingReply });
        state.recent_messages = state.recent_messages.slice(-MAX_RECENT_MESSAGES);
        state.turn_count += 1;
        state.last_activity_at = Date.now();
        registerTokenUsage(state, estimateTokens(message) + estimateTokens(greetingReply));
        return res.json({
          ok: true,
          reply: greetingReply,
          suggested_action_code:
            chat_surface === "general_chat" ? "ASK_GAME_CONTEXT" : "ASK_CSS_GOAL",
          mode_used,
          chat_surface,
          conversation_id,
          follow_up_question: null,
        });
      }
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
            event: "hemis_chat_metrics",
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
            aiClient,
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
      if (false &&
        mode_used === "guia_juego" &&
        (!gameContext.quest_id || !gameContext.quest_step)
      ) {
        const clarificationReply =
          "Te puedo orientar mejor si me dices que ves ahora mismo: zona, puerta, enemigo o puzzle activo.";
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
          suggested_action_code: "ASK_VISIBLE_GAME_CONTEXT",
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
${JSON.stringify({ ...gameContext, chat_surface }, null, 2)}

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
        const response = await aiClient.models.generateContent({
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
            thinkingConfig: { thinkingBudget: 0 },
          },
        });
        parsedModelReply = parseModelReply(response?.text || "");
      } catch (modelError) {
        if (isAuthModelError(modelError)) {
          return res.status(401).json({
            ok: false,
            error: "La API key de Gemini no fue aceptada.",
            code: "invalid_api_key",
          });
        }
        console.warn("Fallo de modelo remoto, aplicando fallback local:", modelError.message);
        parsedModelReply = buildLocalFallback({
          modeUsed: mode_used,
          playerContext: compressedPlayerContext,
        });
      }

      const { reply, suggested_action_code, follow_up_question = null } = parsedModelReply;
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
          await refreshRunningSummary(aiClient, state);
        } catch (summaryError) {
          console.warn("No se pudo refrescar running_summary:", summaryError.message);
        }
      }

      const latencyMs = Date.now() - requestStartedAt;
      console.info(
        JSON.stringify({
          event: "hemis_chat_metrics",
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
  };
}
