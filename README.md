# Hemis Backend

Backend Express para **Hemis**, asistente contextual de _Citadel of Solar Souls (CSS)_. Hemis opera como tutor de CSS y guia diegetica del juego: responde dudas, evalua intenciones de codigo, considera el contexto de nivel y devuelve orientacion breve para el jugador.

> El repositorio publico conserva la URL historica `CSS-Game-Emis` por continuidad: https://github.com/Jonathan-Bello/CSS-Game-Emis. El nombre del producto y la documentacion canonica es **Hemis**.

## URLs oficiales

- Sitio: https://css.jonathanbello.com/
- GDD: https://css.jonathanbello.com/gdd/
- Demo web: https://css.jonathanbello.com/demo/
- Backend desplegado: https://css-game-emis.onrender.com/

## Endpoints

- `GET /health`: estado del servicio.
- `POST /api/hemis/chat`: endpoint canonico.
- `POST /api/emis/chat`: alias legacy.

## Headers

- Canonico: `X-Hemis-Api-Key`
- Legacy: `X-Emis-Api-Key`

La API key de Gemini se recibe por request desde el jugador. Para despliegues institucionales tambien se puede usar una key de entorno como fallback.

## Variables de entorno

```env
HEMIS_PORT=8080
HEMIS_GEMINI_MODEL=gemini-2.5-flash-lite
HEMIS_FRONTEND_ORIGINS=https://css.jonathanbello.com,http://localhost:4321,http://127.0.0.1:4321
```

Aliases legacy aceptados:

```env
EMIS_PORT=8080
EMIS_GEMINI_MODEL=gemini-2.5-flash-lite
EMIS_FRONTEND_ORIGINS=http://localhost:4321
```

Tambien se aceptan `PORT`, `GEMINI_MODEL`, `FRONTEND_ORIGINS` y `GEMINI_API_KEY` por compatibilidad.

## Desarrollo local

```sh
npm install
npm run dev
```

Prueba de salud:

```sh
curl http://localhost:8080/health
```

Prueba de chat canonico:

```sh
curl -s -X POST http://localhost:8080/api/hemis/chat \
  -H "Content-Type: application/json" \
  -H "X-Hemis-Api-Key: tu_api_key_gemini" \
  -d '{
    "message": "Como uso fill para una bala roja?",
    "chat_surface": "bullet_creator",
    "intent_mode": "auto",
    "player_context": {
      "level": "tutorial_cave",
      "objective": "Crear municion CSS con fill"
    },
    "css_snapshot": "#shape { fill: red; }"
  }'
```

Prueba de alias legacy:

```sh
curl -s -X POST http://localhost:8080/api/emis/chat \
  -H "Content-Type: application/json" \
  -H "X-Emis-Api-Key: tu_api_key_gemini" \
  -d '{"message":"hola","chat_surface":"general_chat"}'
```

## Funcionamiento

- Valida payloads con `zod`.
- Comprime contexto del jugador para reducir tokens.
- Cambia entre modo tutor CSS y guia de juego.
- Aplica filtros de seguridad para evitar prompt injection y fugas de prompt.
- Registra metricas de conversacion y eventos de seguridad.
- Usa fallback local cuando el modelo remoto falla.

## Alcance tecnico actual

- Parser CSS propio en el juego Godot.
- Hemis como tutor/evaluador conectado al backend.
- Wallace CSS queda documentado como posibilidad futura, no como componente activo del prototipo.
- Datos de evaluacion educativa simulados pertenecen a la tesis/documentacion, no a este servicio.
