import {
  JAILBREAK_PATTERNS,
  MAX_REPLY_LENGTH,
  OUT_OF_SCOPE_PATTERNS,
} from "../config/constants.js";

const securityEventCountersByIp = new Map();
const securityEventCountersByConversation = new Map();

export function detectJailbreakAttempt(message = "") {
  const normalized = String(message);
  const matchedPattern = JAILBREAK_PATTERNS.find((pattern) =>
    pattern.test(normalized),
  );
  return {
    isJailbreak: Boolean(matchedPattern),
    matchedPattern: matchedPattern ? String(matchedPattern) : null,
  };
}

export function postFilterReply(reply = "", mode = "tutor_css") {
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

  const blocked =
    tooLong || hasOutOfScopeContent || hasPromptLeak || lacksRoleAlignment;
  return {
    blocked,
    tooLong,
    hasOutOfScopeContent,
    hasPromptLeak,
    lacksRoleAlignment,
    sanitizedReply: tooLong
      ? normalizedReply.slice(0, MAX_REPLY_LENGTH)
      : normalizedReply,
  };
}

export function registerSecurityEvent({ ip, conversationId, event, details = {} }) {
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
