import type {
  LlmGenerationRequest,
  LlmGenerationResult,
  LlmProviderAdapter,
  LlmServiceConfig,
  LlmToolDeclaration
} from "../types";
import { resolveProxyDispatcher } from "../proxy-dispatcher";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          id?: string;
          name?: string;
          args?: unknown;
        };
      }>;
    };
  }>;
}

export class GeminiAdapter implements LlmProviderAdapter {
  readonly provider = "GEMINI" as const;

  constructor(private readonly config: LlmServiceConfig) {}

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    if (!this.config.apiKey) {
      throw new Error("Missing LLM_API_KEY for GEMINI provider.");
    }

    const model = request.model ?? this.config.taskModels[request.task] ?? this.config.defaultModel;
    const endpoint = buildGeminiEndpoint(this.config.baseUrl, model, this.config.apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 45000);
    const dispatcher = resolveProxyDispatcher();

    try {
      const hasToolRuntime = !!request.toolRuntime && request.toolRuntime.declarations.length > 0;
      if (hasToolRuntime) {
        return await this.generateWithToolLoop({
          request,
          model,
          endpoint,
          signal: controller.signal,
          dispatcher
        });
      }

      const payload = await this.fetchGenerateContentWithSchemaFallback({
        endpoint,
        signal: controller.signal,
        dispatcher,
        body: {
          contents: [
            {
              role: "user",
              parts: [{ text: request.systemPrompt }, { text: request.userPrompt }]
            }
          ],
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            responseMimeType: request.responseFormat === "json_object" ? "application/json" : "text/plain",
            ...(request.responseFormat === "json_object" && request.responseSchema
              ? { responseSchema: sanitizeSchemaForGemini(request.responseSchema) }
              : {})
          }
        }
      });

      const rawText = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim() ?? "";
      const parsedJson = request.responseFormat === "json_object" ? safeJsonParse(rawText) : undefined;

      return {
        provider: this.provider,
        model,
        rawText,
        json: parsedJson
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown fetch error";
      throw new Error(`GEMINI transport error: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async generateWithToolLoop(input: {
    request: LlmGenerationRequest;
    model: string;
    endpoint: string;
    signal: AbortSignal;
    dispatcher: unknown;
  }): Promise<LlmGenerationResult> {
    const { request, model, endpoint, signal, dispatcher } = input;
    const toolRuntime = request.toolRuntime;
    if (!toolRuntime) {
      throw new Error("GEMINI tool loop misconfigured: missing toolRuntime.");
    }

    const maxRounds = Math.max(1, Math.min(16, Number(toolRuntime.maxRounds ?? 8) || 8));
    const history: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [
      {
        role: "user",
        parts: [{ text: request.systemPrompt }, { text: request.userPrompt }]
      }
    ];

    for (let round = 0; round < maxRounds; round += 1) {
      const payload = await this.fetchGenerateContentWithSchemaFallback({
        endpoint,
        signal,
        dispatcher,
        body: {
          contents: history,
          tools: [{ functionDeclarations: toGeminiFunctionDeclarations(toolRuntime.declarations) }],
          toolConfig: {
            functionCallingConfig: {
              mode: "AUTO"
            }
          },
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            responseMimeType: request.responseFormat === "json_object" ? "application/json" : "text/plain",
            ...(request.responseFormat === "json_object" && request.responseSchema
              ? { responseSchema: sanitizeSchemaForGemini(request.responseSchema) }
              : {})
          }
        }
      });

      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const calls = parts
        .map((part) => part.functionCall)
        .filter((fn): fn is NonNullable<typeof fn> => !!fn && typeof fn.name === "string")
        .map((fn) => ({
          id: typeof fn.id === "string" ? fn.id : undefined,
          name: String(fn.name),
          args: normalizeCallArgs(fn.args)
        }));

      if (calls.length === 0) {
        const rawText = parts.map((part) => part.text ?? "").join("\n").trim();
        const parsedJson = request.responseFormat === "json_object" ? safeJsonParse(rawText) : undefined;
        return {
          provider: this.provider,
          model,
          rawText,
          json: parsedJson
        };
      }

      history.push({
        role: "model",
        parts: calls.map((call) => ({
          functionCall: {
            ...(call.id ? { id: call.id } : {}),
            name: call.name,
            args: call.args
          }
        }))
      });

      const responseParts: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        let output: unknown;
        try {
          output = await toolRuntime.handler({ name: call.name, args: call.args });
        } catch (error) {
          output = {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
        responseParts.push({
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name: call.name,
            response: {
              output
            }
          }
        });
      }

      history.push({
        role: "user",
        parts: responseParts
      });
    }

    throw new Error(`GEMINI tool loop exceeded max rounds (${maxRounds}).`);
  }

  private async fetchGenerateContent(input: {
    endpoint: string;
    signal: AbortSignal;
    dispatcher: unknown;
    body: Record<string, unknown>;
  }): Promise<GeminiResponse> {
    const requestInit: Record<string, unknown> = {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input.body),
      signal: input.signal
    };
    if (input.dispatcher) {
      requestInit.dispatcher = input.dispatcher;
    }

    const res = await fetch(input.endpoint, requestInit as RequestInit);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`GEMINI request failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as GeminiResponse;
  }

  private async fetchGenerateContentWithSchemaFallback(input: {
    endpoint: string;
    signal: AbortSignal;
    dispatcher: unknown;
    body: Record<string, unknown>;
  }): Promise<GeminiResponse> {
    try {
      return await this.fetchGenerateContent(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isSchemaCompatibilityError(message)) {
        throw error;
      }
      const downgraded = removeResponseSchemaFromBody(input.body);
      return this.fetchGenerateContent({
        ...input,
        body: downgraded
      });
    }
  }
}

function buildGeminiEndpoint(baseUrl: string, model: string, apiKey: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const encodedKey = encodeURIComponent(apiKey);

  // Support fully qualified endpoint in env, e.g.:
  // https://.../v1beta/models/gemini-3-flash-preview:generateContent
  if (/\/models\/[^/]+:generateContent/i.test(trimmed)) {
    const withModel = trimmed.replace(/\/models\/[^/]+:generateContent/i, `/models/${model}:generateContent`);
    return withModel.includes("?") ? `${withModel}&key=${encodedKey}` : `${withModel}?key=${encodedKey}`;
  }

  // Default official Gemini base form, e.g.:
  // https://generativelanguage.googleapis.com/v1beta
  return `${trimmed}/models/${model}:generateContent?key=${encodedKey}`;
}

function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchemaForGemini(item));
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  Object.entries(input).forEach(([key, value]) => {
    // Gemini structured output parser rejects this keyword on some gateways.
    if (key === "additionalProperties") {
      return;
    }
    // Drop non-essential JSON Schema/meta fields to maximize provider compatibility.
    if (key === "$schema" || key === "title" || key === "default" || key === "examples") {
      return;
    }
    output[key] = sanitizeSchemaForGemini(value);
  });
  return output;
}

function isSchemaCompatibilityError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("unknown name \"additionalproperties\"") ||
    text.includes("unknown name \"responseschema\"") ||
    text.includes("invalid json payload received")
  );
}

function removeResponseSchemaFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  const generationConfig =
    next.generationConfig && typeof next.generationConfig === "object" && !Array.isArray(next.generationConfig)
      ? ({ ...(next.generationConfig as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (generationConfig) {
    delete generationConfig.responseSchema;
    next.generationConfig = generationConfig;
  }
  return next;
}

function toGeminiFunctionDeclarations(declarations: LlmToolDeclaration[]): Array<Record<string, unknown>> {
  return declarations.map((item) => ({
    name: item.name,
    description: item.description,
    parameters: item.parameters
  }));
}

function normalizeCallArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(rawArgs) ? rawArgs : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
