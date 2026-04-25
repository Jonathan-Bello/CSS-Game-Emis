# CSS-Game-Emis

## Integración de `player_context` desde Godot

Antes de cada llamada a `/api/emis/chat`, construye `player_context` con estado verificable del juego (desde nodos/singletons como `GameState`, `QuestManager`, `Inventory`, `PortalManager`):

```json
{
  "player_context": {
    "screen": "world_map",
    "level": "nivel_2",
    "objective": "activar portal al dojo",
    "unlocked_css": ["display", "flex"],
    "zone_id": "zone_campus_north",
    "quest_id": "quest_portal_bootstrap",
    "quest_step": "step_2_find_mentor",
    "nearby_npcs": ["npc_lina", "npc_guardian"],
    "available_portals": ["portal_1", "portal_2"],
    "inventory_tags": ["css_scroll", "portal_key"],
    "failed_attempts_css": ["flex_direction_invalid", "missing_display_flex"]
  }
}
```

Notas:
- `quest_id` y `quest_step` son críticos para `intent_mode=guia_juego`; si faltan, Emis pedirá una sola aclaración breve.
- El backend devuelve `suggested_action_code` para CTA contextual en UI (por ejemplo: `OPEN_PORTAL_2`, `REVIEW_FLEXBOX_HINT`).

## Contrato recomendado de `POST /api/emis/chat` (Godot)

### Request

```json
{
  "conversation_id": "conv_abc123",
  "message": "No logro centrar mi botón",
  "intent_mode": "auto",
  "player_context": {
    "screen": "bullet_creator",
    "level": "nivel_2",
    "objective": "crear bala con más daño",
    "quest_id": "quest_portal_bootstrap",
    "quest_step": "step_2_find_mentor"
  },
  "css_snapshot_fragment": ".bullet { display:block; margin-left: 12px; }"
}
```

- `css_snapshot_fragment` es el campo recomendado.
- `css_snapshot` legacy sigue aceptado por compatibilidad.

### Response

```json
{
  "ok": true,
  "reply": "texto para jugador",
  "conversation_id": "conv_abc123",
  "mode_used": "tutor_css",
  "suggested_action_code": "FOLLOW_GUIDANCE",
  "follow_up_question": null
}
```

- `follow_up_question` será string cuando Emis necesite un dato puntual.
- Si el modelo remoto falla, el backend responde igualmente con `ok: true`, `mode_used: "local_fallback"` y un tip estático por `player_context.level`.
