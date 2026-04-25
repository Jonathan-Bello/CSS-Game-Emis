export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
export const CONVERSATION_TTL_MS = 30 * 60 * 1000;
export const MAX_RECENT_MESSAGES = 8;
export const SUMMARY_EVERY_TURNS = 5;
export const RECENT_MESSAGES_AFTER_SUMMARY = 4;
export const MAX_SUMMARY_CHARS = 1200;
export const TOKEN_BUDGET_10M = 5000;
export const TOKEN_BUDGET_DAY = 30000;
export const NEAR_BUDGET_THRESHOLD = 0.9;
export const MAX_CSS_BLOCK_LENGTH = 500;
export const MAX_SANITIZED_CSS_LENGTH = 2500;
export const MAX_REPLY_LENGTH = 1100;

export const SECURITY_NEUTRAL_REPLY =
  "No puedo ayudar con esa solicitud. Si quieres, pregúntame algo de CSS (selector, propiedad, layout) o sobre tu progreso actual en el juego.";

export const JAILBREAK_PATTERNS = [
  /ignora(?:r)?\s+(?:las?\s+)?reglas?/i,
  /revela(?:r)?\s+(?:el\s+)?prompt/i,
  /act[úu]a\s+como\s+sistema/i,
  /ignore\s+(?:all\s+)?rules?/i,
  /reveal\s+(?:the\s+)?prompt/i,
  /act\s+as\s+system/i,
];

export const OUT_OF_SCOPE_PATTERNS = [
  /hack(?:ear|ing)?/i,
  /malware/i,
  /phishing/i,
  /fraude/i,
  /bypass/i,
  /tarjeta\s+de\s+cr[eé]dito/i,
];

export const NON_CSS_LINE_PATTERNS = [
  /^\s*</,
  /^\s*(?:https?:\/\/|www\.)/i,
  /^\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b/i,
  /^\s*(?:function|const|let|var)\b/i,
];

export const CSS_INTENT_TERMS = [
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

export const GAME_INTENT_TERMS = [
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

export const LOCAL_LEVEL_TIPS = {
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
