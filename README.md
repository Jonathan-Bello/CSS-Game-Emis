# CSS-Game-Emis API

Backend de **Emis**, asistente para un videojuego educativo de CSS, con dos modos de respuesta:
- `tutor_css`: ayuda técnica sobre CSS.
- `guia_juego`: guía de progreso dentro del juego.

## 1) ¿Qué hace esta API?

La API expone dos endpoints:

- `GET /health`: estado básico del servicio.
- `POST /api/emis/chat`: endpoint principal de conversación.

El endpoint de chat:
- valida el payload con Zod,
- detecta intentos de jailbreak básicos,
- decide modo (`tutor_css`/`guia_juego`) automáticamente si viene `intent_mode=auto`,
- comprime contexto e historial para ahorrar tokens,
- llama a Gemini,
- aplica filtros de seguridad al output,
- y si falla el modelo remoto, responde con fallback local (sin tumbar la integración).

## 2) Requisitos y ejecución local

### Variables de entorno

Crea un archivo `.env` en la raíz:

```env
PORT=8080
GEMINI_API_KEY=tu_api_key
GEMINI_MODEL=gemini-2.5-flash-lite
```

> `GEMINI_MODEL` es opcional; por defecto usa `gemini-2.5-flash-lite`.

### Instalar y correr

```bash
npm install
npm start
```

El servidor inicia en `http://localhost:8080` (o el `PORT` que definas).

## 3) Endpoints

### `GET /health`

#### Respuesta esperada

```json
{
  "ok": true,
  "service": "emis-backend"
}
```

---

### `POST /api/emis/chat`

#### Request body

```json
{
  "conversation_id": "conv_abc123",
  "message": "No logro centrar mi botón",
  "intent_mode": "auto",
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
  },
  "css_snapshot_fragment": ".bullet { display:block; margin-left: 12px; }"
}
```

#### Campos importantes

- `message` (string, requerido): pregunta del jugador.
- `intent_mode` (opcional): `tutor_css`, `guia_juego` o `auto`.
- `conversation_id` (opcional):
  - si lo envías, preservas memoria conversacional;
  - si no, el backend genera uno.
- `player_context` (opcional pero recomendado): estado del juego y progreso.
- `css_snapshot_fragment` (opcional recomendado): CSS actual para diagnóstico.
- `css_snapshot` (opcional legacy): compatibilidad con clientes anteriores.

#### Reglas de validación relevantes

- `message`: 1 a 1200 caracteres.
- `css_snapshot_fragment` / `css_snapshot`: máximo 10000 caracteres.
- `conversation_id`: máximo 120 caracteres.
- Arreglos de contexto limitados (por ejemplo `nearby_npcs` máx. 20 elementos).

Si el payload es inválido, responde HTTP `400` con:

```json
{
  "ok": false,
  "error": "Payload inválido",
  "details": {}
}
```

#### Respuesta base

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

#### Comportamientos especiales

1. **Jailbreak detectado en input**
   - Devuelve respuesta neutral segura.
   - `mode_used: "security_neutral"`.

2. **Falta contexto mínimo en `guia_juego`**
   - Si faltan `quest_id` o `quest_step`, pide aclaración puntual.
   - `suggested_action_code: "PROVIDE_QUEST_CONTEXT"`.

3. **Presupuesto de tokens agotado**
   - Entra en modo ultra breve.
   - `mode_used: "ultra_brief_budget"`.

4. **Falla de modelo remoto / error interno**
   - No rompe al cliente.
   - Responde `ok: true` con `mode_used: "local_fallback"`.

## 4) Ejemplo rápido para probarla (curl)

### Paso A: salud del servicio

```bash
curl -s http://localhost:8080/health | jq
```

### Paso B: chat con contexto de juego + CSS

```bash
curl -s -X POST http://localhost:8080/api/emis/chat \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv_demo_001",
    "message": "No logro centrar el boton de jugar",
    "intent_mode": "auto",
    "player_context": {
      "screen": "bullet_creator",
      "level": "nivel_2",
      "objective": "crear bala con mas daño",
      "quest_id": "quest_portal_bootstrap",
      "quest_step": "step_2_find_mentor",
      "unlocked_css": ["display", "flex"]
    },
    "css_snapshot_fragment": ".container{display:block;} .btn-play{margin-left:20px;}"
  }' | jq
```

### Resultado esperado

Recibirás JSON con estos campos:
- `reply`: respuesta para el jugador.
- `mode_used`: modo aplicado (`tutor_css` o `guia_juego`, etc.).
- `suggested_action_code`: CTA para UI.
- `follow_up_question`: pregunta corta si falta contexto.

## 5) Recomendaciones de integración (Godot o cliente propio)

- Mantén fijo `conversation_id` durante una sesión para conservar contexto.
- Envía `player_context` en cada turno para mejorar precisión de guía.
- Envía `css_snapshot_fragment` con el bloque más relevante, no toda la hoja completa.
- Si `follow_up_question` viene con texto, muéstrala tal cual en UI para completar contexto faltante.
