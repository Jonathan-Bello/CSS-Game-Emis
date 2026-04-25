import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "./env.js";

export function createAiClient() {
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}
