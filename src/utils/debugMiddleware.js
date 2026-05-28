/**
 * Middleware para gestionar DEBUG FLAGS
 * Se agrega a app.js para interceptar requests y mostrar información de debug
 */

import { isDebugEnabled, DEBUG_CONFIG } from "../config/debugConfig.js";
import { generateDebugFlags } from "../utils/debugFlags.js";

export function debugFlagsMiddleware(req, res, next) {
  // Adjuntar función para acceder a flags en el controlador si es necesario
  req.getDebugFlags = () => {
    return generateDebugFlags(req.body);
  };

  // Si debug está habilitado y hay body, procesar
  if (req.body && isDebugEnabled(req)) {
    // Almacenar flags en el request para uso posterior
    req.debugFlags = generateDebugFlags(req.body);

    // Si está configurado para incluir en respuesta, adjuntar al res
    if (DEBUG_CONFIG.INCLUDE_IN_RESPONSE) {
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (typeof body === "object" && body !== null) {
          body.__debug_flags = req.debugFlags;
        }
        return originalJson(body);
      };
    }
  }

  next();
}

/**
 * Middleware que solo inyecta las banderas sin mostrar en consola
 * Útil si quieres controlarlo manualmente en los controladores
 */
export function attachDebugFlagsMiddleware(req, res, next) {
  if (req.body) {
    req.debugFlags = generateDebugFlags(req.body);
  }
  next();
}

/**
 * Helper para obtener un resumen simple de las banderas
 */
export function getDebugSummary(flags) {
  return {
    completeness: `${flags.context_completeness.completeness_percentage}%`,
    fields_present: flags.context_completeness.player_context_fields_present,
    fields_total: flags.context_completeness.player_context_fields_total,
    has_message: flags.context_completeness.has_message,
    has_player_context: flags.context_completeness.has_player_context,
    has_css_input: flags.context_completeness.has_css_input,
    has_conversation_id: flags.context_completeness.has_conversation_id,
    has_intent_mode: flags.context_completeness.has_intent_mode,
    missing_fields: flags.missing_fields,
  };
}
