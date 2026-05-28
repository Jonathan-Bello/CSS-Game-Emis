# 🚩 Sistema de Debug Flags - Banderas de Contexto

Este sistema te permite verificar qué contexto está llegando a la API desde el juego Godot. Es útil para debugging y validación de datos.

## 📋 Archivos Creados

### 1. **src/utils/debugFlags.js**
   - Función `generateDebugFlags(payload)` - Genera banderas detalladas del payload
   - Función `printDebugFlags(flags, requestId)` - Imprime las banderas en consola de forma legible
   - Función `exportDebugFlagsJSON(flags)` - Exporta banderas en JSON

### 2. **src/config/debugConfig.js**
   - Configuración centralizada de debug
   - Control mediante variables de entorno
   - Función `isDebugEnabled(req)` para verificar si debug está activo

### 3. **src/utils/debugMiddleware.js**
   - Middleware para app.js
   - `debugFlagsMiddleware` - Intercepta requests y procesa flags
   - `getDebugSummary()` - Resumen simplificado de banderas

### 4. **.env.debug.example**
   - Ejemplo de variables de entorno disponibles

## 🚀 Uso Rápido

### Opción 1: Mostrar Banderas en Consola (YA INTEGRADO)

Las banderas ya están integradas en `chatController.js` y se mostrarán automáticamente si `DEBUG_MODE` está activo.

**En tu `.env`:**
```bash
DEBUG_MODE=true
```

Cuando hagas una request, verás en la consola algo como:

```
================================================================================
📊 DEBUG FLAGS - CONTEXTO RECIBIDO DESDE JUEGO
================================================================================
Request ID: a1b2c3d4
Timestamp: 2026-05-23T10:30:45.123Z
Tamaño del payload: 2845 bytes

📈 COMPLETITUD DEL CONTEXTO:
  Porcentaje: 65%
  Campos esperados presentes: 7/11

✅ CAMPOS PRESENTES:
  ✓ message
  ✓ conversation_id
  ✓ player_context
  ✓ css_snapshot

❌ CAMPOS FALTANTES O VACÍOS:
  ✗ player_context.nearby_npcs
  ✗ player_context.available_portals

📋 DETALLES DE CAMPOS:
  ...
```

### Opción 2: Debug en Request Específico (Sin Variable de Entorno)

Envía un header en tu request:

```bash
curl -X POST http://localhost:PORT/api/chat \
  -H "X-Debug: true" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Opción 3: Incluir Banderas en Respuesta HTTP

Para ver las banderas en el JSON de respuesta:

```bash
DEBUG_INCLUDE_IN_RESPONSE=true
```

La respuesta incluirá un campo `__debug_flags`.

## 🎯 Variables de Entorno Disponibles

```bash
# Modo completo de debug
DEBUG_MODE=true

# Mostrar solo resumen de completitud
DEBUG_SUMMARY_ONLY=true

# Mostrar flags específicas
DEBUG_SHOW_COMPLETENESS=true
DEBUG_SHOW_MESSAGE=true
DEBUG_SHOW_PLAYER_CONTEXT=true
DEBUG_SHOW_CSS_SNAPSHOT=true
DEBUG_SHOW_CONVERSATION_ID=true
DEBUG_SHOW_INTENT_MODE=true
DEBUG_SHOW_MISSING_FIELDS=true

# Incluir en respuesta HTTP
DEBUG_INCLUDE_IN_RESPONSE=true

# Logging a archivo
DEBUG_FILE_LOGGING=true
DEBUG_LOG_FILE=./logs/debug-flags.log
```

## 📊 Qué Verifican las Banderas

### Completitud del Contexto
- **Porcentaje**: % de campos esperados que están presentes
- **Campos presentes**: Cuántos campos del player_context se recibieron

### Campos Verificados

**Obligatorios:**
- `message` - El mensaje del usuario
- `conversation_id` - ID de la conversación

**Player Context (Contexto del Jugador):**
- `screen` - Pantalla actual del juego
- `level` - Nivel actual
- `objective` - Objetivo actual
- `unlocked_css` - Array de CSS desbloqueados
- `zone_id` - ID de la zona
- `quest_id` - ID de la misión
- `quest_step` - Paso de la misión
- `nearby_npcs` - Array de NPCs cercanos
- `available_portals` - Array de portales disponibles
- `inventory_tags` - Array de tags del inventario
- `failed_attempts_css` - Array de CSS con intentos fallidos

**CSS:**
- `css_snapshot_fragment` - Fragment de CSS actual
- `css_snapshot` - Snapshot completo de CSS

**Intención:**
- `intent_mode` - Modo de intención (tutor_css, guia_juego, auto)

## 📈 Interpretación de Resultados

### Verde ✓ - Bien
- El campo está presente
- Tiene datos

### Rojo ✗ - Problema
- El campo está ausente
- El campo está vacío o null

### Amarillo ⚠️ - Atención
- Completitud baja (< 50%)
- Faltan múltiples campos esperados

## 🔧 Agregar Middleware a app.js (Opcional)

Si quieres un control más fino, puedes agregar el middleware:

```javascript
import { debugFlagsMiddleware } from "./src/utils/debugMiddleware.js";

// En tu app.js, después de los parsers:
app.use(express.json());
app.use(debugFlagsMiddleware); // ← Agregar aquí

// Ahora puedes acceder a las banderas en controladores:
req.debugFlags // Las banderas del request
req.getDebugFlags() // Función para obtenerlas
```

## 💡 Ejemplo de Respuesta con Debug Flags

```json
{
  "ok": true,
  "reply": "...",
  "conversation_id": "...",
  "__debug_flags": {
    "timestamp": "2026-05-23T10:30:45.123Z",
    "context_completeness": {
      "completeness_percentage": 65,
      "player_context_fields_present": 7,
      "player_context_fields_total": 11
    },
    "received_fields": {
      "message": { "present": true, "length": 42 },
      "player_context": { "present": true, "fields": {...} }
    },
    "missing_fields": ["nearby_npcs", "available_portals"]
  }
}
```

## 🎮 Desde el Lado del Juego (Godot)

Cuando veas flags incompletas, asegúrate que en Godot estés enviando:

1. **Mensaje**: Siempre obligatorio
2. **Conversation ID**: Para mantener contexto
3. **Player Context**: Completo con todos los datos disponibles
4. **CSS Snapshot**: El código CSS actual del jugador
5. **Intent Mode**: El tipo de ayuda que necesita

## 📝 Notas

- Las banderas se generan en **CADA request** si DEBUG_MODE está activo
- El overhead es mínimo (análisis de datos JSON)
- Puedes dejar activado en desarrollo/staging sin problemas
- Para producción, usa variables específicas que no ralenticen

## 🆘 Troubleshooting

**No veo los logs de debug:**
- Verifica que `DEBUG_MODE=true` en `.env`
- Reinicia el servidor después de cambiar `.env`
- Verifica los headers del request si usas `X-Debug: true`

**Las banderas no aparecen en respuesta:**
- Asegúrate de `DEBUG_INCLUDE_IN_RESPONSE=true`
- El servidor debe estar en modo debug

**Demasiada información en consola:**
- Usa `DEBUG_SUMMARY_ONLY=true` para ver solo lo importante
- Usa variables específicas como `DEBUG_SHOW_MISSING_FIELDS=true`
