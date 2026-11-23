import { GenerateContentParameters, GenerateContentResponse, GoogleGenAI } from "@google/genai";

export interface AIProviderResult {
  response: GenerateContentResponse;
  modelUsed: string;
  provider: string;
}

export interface AIProvider {
  readonly name: string;
  readonly supportsLiveWebSocket: boolean;
  generate(params: Omit<GenerateContentParameters, "model">): Promise<AIProviderResult>;
}

export class MissingApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

export const GEMINI_MODEL_CHAIN = [
  process.env.AEGIS_AI_MODEL?.trim() || "gemini-3.5-flash",
  process.env.AEGIS_AI_FALLBACK_MODEL?.trim() || "gemini-3.1-flash-lite",
  "gemini-4-hydrogen",
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

function isFallbackableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const status = Number(record.status ?? record.code ?? 0);
  if (status === 403 || status === 404 || status === 429 || status === 503) {
    return true;
  }
  const msg = String(record.message ?? "").toUpperCase();
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("NOT_FOUND") ||
    msg.includes("MODEL_CAPACITY_EXHAUSTED")
  );
}

export class GeminiAIProvider implements AIProvider {
  readonly name = "gemini";
  readonly supportsLiveWebSocket = false; // Turn-based multimodal via /api/analyze-work; Live WS requires ephemeral token or WS proxy

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey || apiKey === "your_key_here") {
      throw new MissingApiKeyError(
        "GEMINI_API_KEY is missing. Add your Google AI Studio key to .env and restart the server."
      );
    }
    return new GoogleGenAI({ apiKey });
  }

  async generate(
    params: Omit<GenerateContentParameters, "model">
  ): Promise<AIProviderResult> {
    const ai = this.getClient();
    let lastError: unknown;

    for (const model of GEMINI_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          ...params,
          model,
        });
        return { response, modelUsed: model, provider: this.name };
      } catch (err) {
        lastError = err;
        if (!isFallbackableError(err)) {
          throw err;
        }
      }
    }

    throw lastError;
  }
}

export function getAIProvider(): AIProvider {
  // Modular factory: future providers (e.g. Groq / OpenAI-compatible) can be selected via AEGIS_AI_PROVIDER
  return new GeminiAIProvider();
}
