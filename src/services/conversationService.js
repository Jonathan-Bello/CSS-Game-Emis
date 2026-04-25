import {
  CONVERSATION_TTL_MS,
  NEAR_BUDGET_THRESHOLD,
  TOKEN_BUDGET_10M,
  TOKEN_BUDGET_DAY,
} from "../config/constants.js";

const conversationMemory = new Map();

export function pruneExpiredConversations() {
  const now = Date.now();
  for (const [conversationId, entry] of conversationMemory.entries()) {
    if (now - entry.last_activity_at > CONVERSATION_TTL_MS) {
      conversationMemory.delete(conversationId);
    }
  }
}

export function getOrCreateConversationState(conversationId) {
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

export function getBudgetStatus(state, now = Date.now()) {
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

export function registerTokenUsage(state, tokens, at = Date.now()) {
  if (!tokens || tokens <= 0) return;
  state.token_usage_events.push({ at, tokens });
}
