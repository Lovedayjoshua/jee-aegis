import { GenerateContentParameters, GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL_CHAIN, getAIProvider, MissingApiKeyError } from "@/lib/ai/provider";

export const PRIMARY_MODEL = GEMINI_MODEL_CHAIN[0];
export const FALLBACK_MODEL = GEMINI_MODEL_CHAIN[1] ?? GEMINI_MODEL_CHAIN[0];

export { MissingApiKeyError };

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your_key_here") {
    throw new MissingApiKeyError(
      "GEMINI_API_KEY is missing. Add your Google AI Studio key to .env and restart the server."
    );
  }
  return new GoogleGenAI({ apiKey });
}

export async function generateContentWithFallback(
  params: Omit<GenerateContentParameters, "model">
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const provider = getAIProvider();
  const { response, modelUsed } = await provider.generate(params);
  return { response, modelUsed };
}
