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

/** The ordered list of models to try (from env). */
export function getModelList(): readonly string[] {
  return env.AI_MODELS;
}
