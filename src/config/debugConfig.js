/**
 * Configuración de DEBUG FLAGS
 * Controla qué información de debug se registra
 */

const DEBUG_MODE = process.env.DEBUG_MODE === "true" || process.env.DEBUG_MODE === "1";

export const DEBUG_CONFIG = {
  // Mostrar banderas completas en consola
  CONSOLE_VERBOSE: DEBUG_MODE || process.env.DEBUG_VERBOSE === "true",

  // Guardar banderas en un archivo de log
  FILE_LOGGING: DEBUG_MODE && process.env.DEBUG_FILE_LOGGING === "true",
  LOG_FILE_PATH: process.env.DEBUG_LOG_FILE || "./debug-flags.log",

  // Incluir banderas en la respuesta HTTP (para inspeccionar en el cliente)
  INCLUDE_IN_RESPONSE: process.env.DEBUG_INCLUDE_IN_RESPONSE === "true",

  // Mostrar solo información resumida
  SUMMARY_ONLY: process.env.DEBUG_SUMMARY_ONLY === "true",

  // Banderas específicas para mostrar
  SHOW: {
    completeness: DEBUG_MODE || process.env.DEBUG_SHOW_COMPLETENESS === "true",
    message: DEBUG_MODE || process.env.DEBUG_SHOW_MESSAGE === "true",
    player_context: DEBUG_MODE || process.env.DEBUG_SHOW_PLAYER_CONTEXT === "true",
    css_snapshot: DEBUG_MODE || process.env.DEBUG_SHOW_CSS_SNAPSHOT === "true",
    conversation_id: DEBUG_MODE || process.env.DEBUG_SHOW_CONVERSATION_ID === "true",
    intent_mode: DEBUG_MODE || process.env.DEBUG_SHOW_INTENT_MODE === "true",
    missing_fields: DEBUG_MODE || process.env.DEBUG_SHOW_MISSING_FIELDS === "true",
  },
};

/**
 * Verifica si debug debe estar activo basado en headers de request
 */
export function isDebugEnabled(req) {
  // Header X-Debug: true para habilitar en un request específico
  if (req.headers["x-debug"] === "true") {
    return true;
  }
  return DEBUG_CONFIG.CONSOLE_VERBOSE;
}

/**
 * Imprime configuración de debug actual
 */
export function printDebugConfig() {
  if (DEBUG_MODE) {
    console.log("🔧 DEBUG MODE ACTIVO");
    console.log("Configuración actual:");
    console.log(JSON.stringify(DEBUG_CONFIG, null, 2));
  }
}
