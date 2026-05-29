import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.HEMIS_PORT || process.env.EMIS_PORT || process.env.PORT || 8080;
export const GEMINI_API_KEY =
  process.env.HEMIS_GEMINI_API_KEY || process.env.EMIS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const DEFAULT_FRONTEND_ORIGINS =
  "https://css.jonathanbello.com,http://localhost:4321,http://127.0.0.1:4321";

export const FRONTEND_ORIGINS = (
  process.env.HEMIS_FRONTEND_ORIGINS ||
  process.env.EMIS_FRONTEND_ORIGINS ||
  process.env.FRONTEND_ORIGINS ||
  DEFAULT_FRONTEND_ORIGINS
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
