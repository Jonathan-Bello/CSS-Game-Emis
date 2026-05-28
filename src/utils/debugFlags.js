/**
 * Sistema de banderas de debug para verificar qué contexto llega desde el juego
 * Muestra un resumen de los datos recibidos en cada request
 */

export function generateDebugFlags(payload) {
  const flags = {
    timestamp: new Date().toISOString(),
    received_fields: {},
    missing_fields: [],
    context_completeness: {},
    payload_size: JSON.stringify(payload).length,
  };

  // ===== MENSAJE =====
  flags.received_fields.message = {
    present: !!payload.message,
    value_preview: payload.message ? payload.message.slice(0, 100) : null,
    length: payload.message ? payload.message.length : 0,
  };

  // ===== CONVERSATION ID =====
  flags.received_fields.conversation_id = {
    present: !!payload.conversation_id,
    value: payload.conversation_id || null,
  };

  // ===== INTENT MODE =====
  flags.received_fields.intent_mode = {
    present: !!payload.intent_mode,
    value: payload.intent_mode || null,
    valid_values: ["tutor_css", "guia_juego", "auto"],
  };

  // ===== PLAYER CONTEXT =====
  const playerContext = payload.player_context || {};
  const playerContextFields = [
    "screen",
    "level",
    "objective",
    "unlocked_css",
    "zone_id",
    "quest_id",
    "quest_step",
    "nearby_npcs",
    "available_portals",
    "inventory_tags",
    "failed_attempts_css",
  ];

  flags.received_fields.player_context = {
    present: !!payload.player_context,
    fields: {},
  };

  playerContextFields.forEach((field) => {
    const value = playerContext[field];
    const present = value !== undefined && value !== null;

    flags.received_fields.player_context.fields[field] = {
      present,
      type: Array.isArray(value) ? "array" : typeof value,
      length: Array.isArray(value) ? value.length : value ? String(value).length : 0,
      preview: present ? (Array.isArray(value) ? value.slice(0, 3) : String(value).slice(0, 50)) : null,
    };

    if (!present) {
      flags.missing_fields.push(`player_context.${field}`);
    }
  });

  // ===== CSS SNAPSHOTS =====
  flags.received_fields.css_snapshot_fragment = {
    present: !!payload.css_snapshot_fragment,
    length: payload.css_snapshot_fragment ? payload.css_snapshot_fragment.length : 0,
    preview: payload.css_snapshot_fragment ? payload.css_snapshot_fragment.slice(0, 100) : null,
  };

  flags.received_fields.css_snapshot = {
    present: !!payload.css_snapshot,
    length: payload.css_snapshot ? payload.css_snapshot.length : 0,
    preview: payload.css_snapshot ? payload.css_snapshot.slice(0, 100) : null,
  };

  if (!payload.css_snapshot_fragment && !payload.css_snapshot) {
    flags.missing_fields.push("css_snapshot_fragment OR css_snapshot");
  }

  // ===== ANÁLISIS DE COMPLETITUD =====
  flags.context_completeness = {
    has_message: !!payload.message,
    has_player_context: !!payload.player_context,
    player_context_fields_present: Object.values(
      flags.received_fields.player_context.fields
    ).filter((f) => f.present).length,
    player_context_fields_total: playerContextFields.length,
    has_css_input: !!payload.css_snapshot_fragment || !!payload.css_snapshot,
    has_conversation_id: !!payload.conversation_id,
    has_intent_mode: !!payload.intent_mode,
    completeness_percentage: calculateCompleteness(payload),
  };

  return flags;
}

function calculateCompleteness(payload) {
  let total = 0;
  let present = 0;

  // Campos obligatorios/esperados
  const expectedFields = [
    "message",
    "player_context",
    "css_snapshot_fragment",
    "css_snapshot",
    "conversation_id",
    "intent_mode",
  ];

  expectedFields.forEach((field) => {
    total += 1;
    if (payload[field]) {
      present += 1;
    }
  });

  // Subcampos de player_context
  if (payload.player_context) {
    const subfields = [
      "screen",
      "level",
      "objective",
      "zone_id",
      "quest_id",
      "quest_step",
    ];
    subfields.forEach((field) => {
      total += 1;
      if (payload.player_context[field]) {
        present += 1;
      }
    });
  }

  return Math.round((present / total) * 100);
}

/**
 * Imprime las banderas de forma legible en consola
 */
export function printDebugFlags(flags, requestId) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 DEBUG FLAGS - CONTEXTO RECIBIDO DESDE JUEGO");
  console.log("=".repeat(80));
  console.log(`Request ID: ${requestId}`);
  console.log(`Timestamp: ${flags.timestamp}`);
  console.log(`Tamaño del payload: ${flags.payload_size} bytes`);
  console.log("");

  // Resumen de completitud
  console.log("📈 COMPLETITUD DEL CONTEXTO:");
  console.log(`  Porcentaje: ${flags.context_completeness.completeness_percentage}%`);
  console.log(
    `  Campos esperados presentes: ${flags.context_completeness.player_context_fields_present}/${flags.context_completeness.player_context_fields_total}`,
  );
  console.log("");

  // Campos presentes
  console.log("✅ CAMPOS PRESENTES:");
  const presentFields = [];
  if (flags.received_fields.message.present) presentFields.push("message");
  if (flags.received_fields.conversation_id.present) presentFields.push("conversation_id");
  if (flags.received_fields.intent_mode.present) presentFields.push("intent_mode");
  if (flags.received_fields.player_context.present) presentFields.push("player_context");
  if (flags.received_fields.css_snapshot_fragment.present)
    presentFields.push("css_snapshot_fragment");
  if (flags.received_fields.css_snapshot.present) presentFields.push("css_snapshot");

  if (presentFields.length > 0) {
    presentFields.forEach((field) => console.log(`  ✓ ${field}`));
  } else {
    console.log("  ⚠️  No se recibieron campos esperados");
  }
  console.log("");

  // Campos faltantes
  if (flags.missing_fields.length > 0) {
    console.log("❌ CAMPOS FALTANTES O VACÍOS:");
    flags.missing_fields.forEach((field) => console.log(`  ✗ ${field}`));
    console.log("");
  }

  // Detalles de cada campo
  console.log("📋 DETALLES DE CAMPOS:");
  console.log("");

  if (flags.received_fields.message.present) {
    console.log(`  Message:`);
    console.log(`    Presente: ✓`);
    console.log(`    Longitud: ${flags.received_fields.message.length} caracteres`);
    console.log(`    Preview: "${flags.received_fields.message.value_preview}"`);
  }

  if (flags.received_fields.conversation_id.present) {
    console.log(`  Conversation ID:`);
    console.log(`    Presente: ✓`);
    console.log(`    Valor: ${flags.received_fields.conversation_id.value}`);
  }

  if (flags.received_fields.intent_mode.present) {
    console.log(`  Intent Mode:`);
    console.log(`    Presente: ✓`);
    console.log(`    Valor: ${flags.received_fields.intent_mode.value}`);
  }

  if (flags.received_fields.player_context.present) {
    console.log(`  Player Context:`);
    console.log(`    Presente: ✓`);
    console.log(`    Campos:`);
    Object.entries(flags.received_fields.player_context.fields).forEach(([field, info]) => {
      const status = info.present ? "✓" : "✗";
      console.log(`      ${status} ${field}: ${info.type}${info.length > 0 ? ` (${info.length})` : ""}`);
      if (info.preview) {
        console.log(`         Preview: ${JSON.stringify(info.preview)}`);
      }
    });
  }

  if (flags.received_fields.css_snapshot_fragment.present) {
    console.log(`  CSS Snapshot Fragment:`);
    console.log(`    Presente: ✓`);
    console.log(`    Longitud: ${flags.received_fields.css_snapshot_fragment.length} caracteres`);
    console.log(
      `    Preview: "${flags.received_fields.css_snapshot_fragment.preview}"`,
    );
  }

  if (flags.received_fields.css_snapshot.present) {
    console.log(`  CSS Snapshot:`);
    console.log(`    Presente: ✓`);
    console.log(`    Longitud: ${flags.received_fields.css_snapshot.length} caracteres`);
    console.log(`    Preview: "${flags.received_fields.css_snapshot.preview}"`);
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("");
}

/**
 * Exporta las banderas en formato JSON para logging
 */
export function exportDebugFlagsJSON(flags) {
  return JSON.stringify(flags, null, 2);
}
