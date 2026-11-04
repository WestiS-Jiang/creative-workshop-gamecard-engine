import { GeminiAdapter } from "./adapters/geminiAdapter";
import { OpenAICompatibleAdapter } from "./adapters/openaiCompatibleAdapter";
import type { LlmProviderAdapter, LlmServiceConfig } from "./types";

export function buildProviderAdapter(config: LlmServiceConfig): LlmProviderAdapter {
  if (config.provider === "OPENAI_COMPAT") {
    return new OpenAICompatibleAdapter(config);
  }

  if (config.provider === "GEMINI") {
    return new GeminiAdapter(config);
  }

  const neverProvider: never = config.provider;
  throw new Error(`Unsupported LLM provider: ${String(neverProvider)}`);
}

