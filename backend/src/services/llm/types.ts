export type LlmTask =
  | "MAP_STRUCTURED_EXTRACT"
  | "MAP_EVENT_EXTRACTION"
  | "MAP_RULE_PROBING"
  | "CORE_CHARACTER_SUMMARY"
  | "RPG_STAT_DESIGN"
  | "VISUAL_STYLE_RECOMMEND"
  | "GAME_CARD"
  | "GAME_CARD_ASSISTANT"
  | "CRA_PATCH"
  | "MAIN_LOOP_TURN";

export type ProviderName = "OPENAI_COMPAT" | "GEMINI";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolRuntime {
  declarations: LlmToolDeclaration[];
  handler: (call: { name: string; args: Record<string, unknown> }) => Promise<unknown> | unknown;
  maxRounds?: number;
}

export interface LlmGenerationRequest {
  task: LlmTask;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  responseFormat?: "json_object" | "text";
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
  toolRuntime?: LlmToolRuntime;
}

export interface LlmGenerationResult {
  provider: ProviderName;
  model: string;
  rawText: string;
  json?: unknown;
}

export interface LlmProviderAdapter {
  readonly provider: ProviderName;
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

export interface LlmServiceConfig {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  taskModels: Partial<Record<LlmTask, string>>;
}
