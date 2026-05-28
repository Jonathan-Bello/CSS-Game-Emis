import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createChatHandler } from "./controllers/chatController.js";
import { FRONTEND_ORIGINS } from "./config/env.js";

const REPLY_PREVIEW_MAX_CHARS = 180;

function buildReplyPreview(body) {
  if (!body || typeof body !== "object") return null;

  const previewSource =
    typeof body.reply === "string"
      ? body.reply
      : typeof body.error === "string"
        ? body.error
        : null;

  if (!previewSource) return null;

  return previewSource
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REPLY_PREVIEW_MAX_CHARS);
}

function requestConsoleLogger(req, res, next) {
  const requestStartedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = function jsonWithConsoleLog(body) {
    console.info(
      JSON.stringify({
        event: "emis_request_completed",
        method: req.method,
        path: req.originalUrl,
        status_code: res.statusCode,
        ok: body && typeof body === "object" ? body.ok : undefined,
        conversation_id:
          body && typeof body === "object" ? body.conversation_id : undefined,
        mode_used: body && typeof body === "object" ? body.mode_used : undefined,
        reply_preview: buildReplyPreview(body),
        duration_ms: Date.now() - requestStartedAt,
      }),
    );

    return originalJson(body);
  };

  next();
}

function resolveCorsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (FRONTEND_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Origen no permitido por CORS"));
}

export function createApp(createAiClient) {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin: resolveCorsOrigin,
      methods: ["POST", "GET"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Emis-Api-Key"],
    }),
  );
  app.use(requestConsoleLogger);

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (_, res) => {
    res.json({ ok: true, service: "emis-backend" });
  });

  app.post("/api/emis/chat", createChatHandler(createAiClient));

  return app;
}
