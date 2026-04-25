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
