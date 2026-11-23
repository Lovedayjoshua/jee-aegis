import {
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";

export interface AIProviderResult {
  response: GenerateContentResponse;
  modelUsed: string;
  provider: string;
}

export interface AIStreamResult {
  stream: AsyncGenerator<GenerateContentResponse, void, unknown>;
  modelUsed: string;
  provider: string;
}

export interface AIProvider {
  readonly name: string;
  readonly supportsLiveWebSocket: boolean;
  generate(
    params: Omit<GenerateContentParameters, "model">,
    timeoutMs?: number
  ): Promise<AIProviderResult>;
  generateStream(
    params: Omit<GenerateContentParameters, "model">
  ): Promise<AIStreamResult>;
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
  "gemma-4-26b-a4b-it",
  "gemini-4-hydrogen",
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

function isFallbackableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const status = Number(record.status ?? record.code ?? 0);
  if (status === 403 || status === 404 || status === 408 || status === 429 || status === 503 || status === 504) {
    return true;
  }
  const msg = String(record.message ?? "").toUpperCase();
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("TIMEOUT") ||
    msg.includes("TIMED OUT") ||
    msg.includes("ABORT") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("NOT_FOUND") ||
    msg.includes("MODEL_CAPACITY_EXHAUSTED")
  );
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown AI error");
  // Redact any accidental key-like token
  return raw.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]");
}

function withFastDefaults(
  model: string,
  params: Omit<GenerateContentParameters, "model">
): GenerateContentParameters {
  const isGemini3Or4 = model.startsWith("gemini-3") || model.startsWith("gemini-4");
  const existingConfig = params.config ?? {};
  const config =
    isGemini3Or4 && !existingConfig.thinkingConfig
      ? {
          ...existingConfig,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        }
      : existingConfig;

  return {
    ...params,
    model,
    config,
  };
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, model: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT: Model ${model} exceeded ${ms}ms limit`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class GeminiAIProvider implements AIProvider {
  readonly name = "gemini";
  readonly supportsLiveWebSocket = false;

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
    params: Omit<GenerateContentParameters, "model">,
    timeoutMs = 15000
  ): Promise<AIProviderResult> {
    const ai = this.getClient();
    let lastError: unknown;

    for (let i = 0; i < GEMINI_MODEL_CHAIN.length; i++) {
      const model = GEMINI_MODEL_CHAIN[i];
      const perAttemptTimeout = i === 0 ? timeoutMs : Math.min(timeoutMs, 10000);
      try {
        const response = await raceWithTimeout(
          ai.models.generateContent(withFastDefaults(model, params)),
          perAttemptTimeout,
          model
        );
        return { response, modelUsed: model, provider: this.name };
      } catch (err) {
        lastError = err;
        console.warn(
          `[AEGIS AI] Model ${model} failed (${sanitizeErrorMessage(err).slice(0, 140)})`
        );
        if (!isFallbackableError(err)) {
          throw new Error(sanitizeErrorMessage(err));
        }
      }
    }

    throw new Error(sanitizeErrorMessage(lastError));
  }

  async generateStream(
    params: Omit<GenerateContentParameters, "model">
  ): Promise<AIStreamResult> {
    const ai = this.getClient();
    let lastError: unknown;

    for (let i = 0; i < GEMINI_MODEL_CHAIN.length; i++) {
      const model = GEMINI_MODEL_CHAIN[i];
      try {
        const stream = await raceWithTimeout(
          ai.models.generateContentStream(withFastDefaults(model, params)),
          10000,
          model
        );
        return { stream, modelUsed: model, provider: this.name };
      } catch (err) {
        lastError = err;
        console.warn(
          `[AEGIS AI Stream] Model ${model} failed (${sanitizeErrorMessage(err).slice(0, 140)})`
        );
        if (!isFallbackableError(err)) {
          throw new Error(sanitizeErrorMessage(err));
        }
      }
    }

    throw new Error(sanitizeErrorMessage(lastError));
  }
}

export function getAIProvider(): AIProvider {
  return new GeminiAIProvider();
}
