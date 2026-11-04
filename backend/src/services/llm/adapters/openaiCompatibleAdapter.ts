import type {
  LlmGenerationRequest,
  LlmGenerationResult,
  LlmProviderAdapter,
  LlmServiceConfig
} from "../types";
import { resolveProxyDispatcher } from "../proxy-dispatcher";

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAICompatibleAdapter implements LlmProviderAdapter {
  readonly provider = "OPENAI_COMPAT" as const;

  constructor(private readonly config: LlmServiceConfig) {}

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    if (!this.config.apiKey) {
      throw new Error("Missing LLM_API_KEY for OPENAI_COMPAT provider.");
    }

    const model = request.model ?? this.config.taskModels[request.task] ?? this.config.defaultModel;
    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 45000);
    const dispatcher = resolveProxyDispatcher();

    try {
      const requestInit: Record<string, unknown> = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt }
          ],
          temperature: request.temperature ?? 0.2,
          response_format: request.responseFormat === "json_object" ? { type: "json_object" } : undefined
        }),
        signal: controller.signal
      };
      if (dispatcher) {
        requestInit.dispatcher = dispatcher;
      }

      const res = await fetch(endpoint, requestInit as RequestInit);

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`OPENAI_COMPAT request failed (${res.status}): ${detail}`);
      }

      const payload = (await res.json()) as OpenAIChatResponse;
      const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";
      const parsedJson = request.responseFormat === "json_object" ? safeJsonParse(rawText) : undefined;

      return {
        provider: this.provider,
        model,
        rawText,
        json: parsedJson
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown fetch error";
      throw new Error(`OPENAI_COMPAT transport error: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
