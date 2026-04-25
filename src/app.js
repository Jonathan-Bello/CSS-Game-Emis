import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createChatHandler } from "./controllers/chatController.js";

export function createApp(aiClient) {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin: true,
      methods: ["POST", "GET"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

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

  app.post("/api/emis/chat", createChatHandler(aiClient));

  return app;
}
