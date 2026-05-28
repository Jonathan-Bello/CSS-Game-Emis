import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "./env.js";

export function createAiClient(apiKey = GEMINI_API_KEY) {
  return new GoogleGenAI({ apiKey });
}
