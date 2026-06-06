import {
  GoogleGenerativeAI,
  type FunctionDeclarationsTool,
  type GenerativeModel,
  type Schema,
} from "@google/generative-ai";
import { env } from "../../../config/env";
import { ServiceUnavailableError } from "../../../shared/errors";

let genAI: GoogleGenerativeAI | undefined;

function getGenAI(): GoogleGenerativeAI {
  if (!env.GEMINI_API_KEY) {
    throw new ServiceUnavailableError(
      "AI features require a GEMINI_API_KEY. Set it in your .env file and restart.",
    );
  }
  genAI ??= new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return genAI;
}

let _availableCache: { models: string[]; expiresAt: number } | undefined;

/**
 * Fetches available Gemini models from the API, filters to those in env.AI_MODELS
 * (preserving priority order), and caches the result for 60 seconds.
 * Returns an empty array if the API key is missing or the request fails.
 */
export async function getAvailableModels(): Promise<string[]> {
  if (!env.GEMINI_API_KEY) return [];

  const now = Date.now();
  if (_availableCache && now < _availableCache.expiresAt) {
    return _availableCache.models;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
    );
    if (!res.ok) return [];

    const data = (await res.json()) as { models?: { name: string }[] };
    const available = new Set(
      (data.models ?? []).map((m) => m.name.replace(/^models\//, "")),
    );

    const filtered = env.AI_MODELS.filter((m) => available.has(m));
    _availableCache = { models: filtered, expiresAt: now + 60_000 };
    return filtered;
  } catch {
    return [];
  }
}

export interface ModelOptions {
  tools?: FunctionDeclarationsTool[];
  systemInstruction?: string;
  responseSchema?: Schema;
}

/**
 * Returns a GenerativeModel with the given options.
 * Tries each model in env.AI_MODELS in order; the runner handles per-call fallback.
 */
export function getModel(modelName: string, options: ModelOptions = {}): GenerativeModel {
  return getGenAI().getGenerativeModel({
    model: modelName,
    ...(options.systemInstruction && { systemInstruction: options.systemInstruction }),
    ...(options.tools?.length && { tools: options.tools }),
    ...(options.responseSchema && {
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: options.responseSchema,
      },
    }),
  });
}

export function getModelList(): readonly string[] {
  return env.AI_MODELS;
}
