import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 8080;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_FRONTEND_ORIGINS = "http://localhost:4321,http://127.0.0.1:4321";

export const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || DEFAULT_FRONTEND_ORIGINS)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
