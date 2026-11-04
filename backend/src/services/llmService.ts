import {
  CORE_CHARACTER_SUMMARY_SYSTEM_PROMPT,
  generateCharacterSummaryPrompt,
  generateGameCardAssistantPrompt,
  generateGameCardPrompt,
  generateMapExtractionPrompt,
  generateTurnPrompt,
  generateRpgStatDesignPrompt,
  generateVisualStyleRecommendPrompt,
  GAME_CARD_ASSISTANT_SYSTEM_PROMPT,
  GAME_CARD_SYSTEM_PROMPT,
  MAP_EVENT_EXTRACTION_PROMPT,
  MAP_RULE_PROBING_PROMPT,
  RPG_STAT_DESIGN_SYSTEM_PROMPT,
  VISUAL_STYLE_RECOMMEND_SYSTEM_PROMPT,
  MAP_STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
  TURN_RENDER_PROMPT_CONTRACT
} from "../engine/map-reduce/prompts";
import type { ConflictGroup } from "../engine/map-reduce/types";
import { getStructuredOutputSchema } from "./llm/response-schemas";
import { buildProviderAdapter } from "./llm/providerFactory";
import type { LlmServiceConfig, LlmTask, ProviderName } from "./llm/types";

export interface LlmService {
  extractStructuredMap(input: { chapterIndex: number; chapterText: string; baselineContext?: string }): Promise<Record<string, unknown>>;
  extractMapEvents(input: { chapterIndex: number; chapterText: string; baselineContext?: string }): Promise<Record<string, unknown>>;
  extractImplicitRules(input: { chapterIndex: number; chapterText: string; baselineContext?: string }): Promise<Record<string, unknown>>;
  designRpgStats(input: {
    implicitRules: string[];
    coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
  }): Promise<Record<string, unknown>>;
  recommendVisualStyles(input: {
    genre: string;
    sourceSummary: string;
    sourceFileName?: string;
  }): Promise<Record<string, unknown>>;
  summarizeCoreCharacters(input: {
    characters: Array<{
      entity_id: string;
      name: string;
      known_biography?: string;
      known_appearance?: string;
      raw_profile: string;
    }>;
  }): Promise<Record<string, unknown>>;
  generateGameCardMarkdown(input: {
    globalStateTree: unknown;
    implicitRules: string[];
    timelineActs: Array<{ act: string; summary: string; chunk_ids: string[] }>;
    characterCandidates?: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
    directivesMarkdown?: string;
    targetActCount?: number;
    maxPlayableRoles?: number;
    sourceCharCount?: number;
    sourceFileName?: string;
  }): Promise<string>;
  askGameCardAssistant(input: {
    referenceMarkdown: string;
    editableMarkdown: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    preset?: "STRICT" | "CREATIVE";
  }): Promise<string>;
  generatePatchNarrative(group: ConflictGroup): Promise<string | null>;
  generateCraPatchNarrative(group: ConflictGroup): Promise<string | null>;
  generateMainLoopTurn(input: { stateSnapshot: unknown; actionId: string }): Promise<Record<string, unknown>>;
}

class DefaultLlmService implements LlmService {
  constructor(private readonly config: LlmServiceConfig) {}

  async extractStructuredMap(input: {
    chapterIndex: number;
    chapterText: string;
    baselineContext?: string;
  }): Promise<Record<string, unknown>> {
    const userPrompt = generateMapExtractionPrompt(
      input.chapterIndex,
      input.baselineContext ?? "",
      input.chapterText
    );

    return this.generateJsonTask("MAP_STRUCTURED_EXTRACT", MAP_STRUCTURED_EXTRACTION_SYSTEM_PROMPT, userPrompt);
  }

  async extractMapEvents(input: { chapterIndex: number; chapterText: string; baselineContext?: string }): Promise<Record<string, unknown>> {
    const userPrompt = [
      `chapter_index: ${input.chapterIndex}`,
      input.baselineContext ? `baseline_context:\n${input.baselineContext}` : "",
      `chapter_text:\n${input.chapterText}`
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.generateJsonTask("MAP_EVENT_EXTRACTION", MAP_EVENT_EXTRACTION_PROMPT, userPrompt);
  }

  async extractImplicitRules(input: { chapterIndex: number; chapterText: string; baselineContext?: string }): Promise<Record<string, unknown>> {
    const userPrompt = [
      `chapter_index: ${input.chapterIndex}`,
      input.baselineContext ? `baseline_context:\n${input.baselineContext}` : "",
      `chapter_text:\n${input.chapterText}`
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.generateJsonTask("MAP_RULE_PROBING", MAP_RULE_PROBING_PROMPT, userPrompt);
  }

  async designRpgStats(input: {
    implicitRules: string[];
    coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
  }): Promise<Record<string, unknown>> {
    const userPrompt = generateRpgStatDesignPrompt({
      implicitRules: input.implicitRules,
      coreCharacters: input.coreCharacters
    });

    return this.generateJsonTask("RPG_STAT_DESIGN", RPG_STAT_DESIGN_SYSTEM_PROMPT, userPrompt);
  }

  async recommendVisualStyles(input: {
    genre: string;
    sourceSummary: string;
    sourceFileName?: string;
  }): Promise<Record<string, unknown>> {
    const userPrompt = generateVisualStyleRecommendPrompt({
      genre: input.genre,
      sourceSummary: input.sourceSummary,
      sourceFileName: input.sourceFileName
    });
    return this.generateJsonTask("VISUAL_STYLE_RECOMMEND", VISUAL_STYLE_RECOMMEND_SYSTEM_PROMPT, userPrompt);
  }

  async summarizeCoreCharacters(input: {
    characters: Array<{
      entity_id: string;
      name: string;
      known_biography?: string;
      known_appearance?: string;
      raw_profile: string;
    }>;
  }): Promise<Record<string, unknown>> {
    const userPrompt = generateCharacterSummaryPrompt({
      characters: input.characters
    });
    return this.generateJsonTask("CORE_CHARACTER_SUMMARY", CORE_CHARACTER_SUMMARY_SYSTEM_PROMPT, userPrompt);
  }

  async generateGameCardMarkdown(input: {
    globalStateTree: unknown;
    implicitRules: string[];
    timelineActs: Array<{ act: string; summary: string; chunk_ids: string[] }>;
    characterCandidates?: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
    directivesMarkdown?: string;
    targetActCount?: number;
    maxPlayableRoles?: number;
    sourceCharCount?: number;
    sourceFileName?: string;
  }): Promise<string> {
    const userPrompt = generateGameCardPrompt({
      globalStateTree: compactGameCardStateTree(input.globalStateTree),
      implicitRules: input.implicitRules.slice(0, 80),
      timelineActs: input.timelineActs.slice(0, 24),
      characterCandidates: (input.characterCandidates ?? []).slice(0, 60),
      directivesMarkdown: truncateText(input.directivesMarkdown ?? "", 24000),
      targetActCount: input.targetActCount,
      maxPlayableRoles: input.maxPlayableRoles,
      sourceCharCount: input.sourceCharCount,
      sourceFileName: input.sourceFileName
    });

    const result = await this.callAdapterWithRetry({
      task: "GAME_CARD",
      systemPrompt: GAME_CARD_SYSTEM_PROMPT,
      userPrompt,
      responseFormat: "text",
      temperature: 0.45,
      timeoutMs: this.getTaskTimeoutMs("GAME_CARD")
    });

    const markdown = result.rawText.trim();
    if (!markdown) {
      throw new Error("Game card generation returned empty markdown.");
    }

    let finalMarkdown = markdown;
    let validation = validateGameCardMarkdownStructure(finalMarkdown, input.targetActCount);
    if (!validation.ok) {
      finalMarkdown = await this.repairGameCardMarkdown({
        markdown: finalMarkdown,
        errors: validation.errors,
        targetActCount: input.targetActCount,
        directivesMarkdown: input.directivesMarkdown
      });
      validation = validateGameCardMarkdownStructure(finalMarkdown, input.targetActCount);
      if (!validation.ok) {
        finalMarkdown = await this.repairGameCardMarkdown({
          markdown: finalMarkdown,
          errors: validation.errors,
          targetActCount: input.targetActCount,
          directivesMarkdown: input.directivesMarkdown
        });
      }
    }

    return finalMarkdown.trim();
  }

  async askGameCardAssistant(input: {
    referenceMarkdown: string;
    editableMarkdown: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    preset?: "STRICT" | "CREATIVE";
  }): Promise<string> {
    const userPrompt = generateGameCardAssistantPrompt({
      referenceMarkdown: truncateText(input.referenceMarkdown, 24000),
      editableMarkdown: truncateText(input.editableMarkdown, 36000),
      question: truncateText(input.question, 1500),
      history: (input.history ?? []).slice(-12).map((item) => ({
        role: item.role,
        content: truncateText(item.content, 1200)
      }))
    });

    const result = await this.callAdapterWithRetry({
      task: "GAME_CARD_ASSISTANT",
      systemPrompt: GAME_CARD_ASSISTANT_SYSTEM_PROMPT,
      userPrompt,
      responseFormat: "text",
      temperature: input.preset === "CREATIVE" ? 0.7 : 0.25,
      timeoutMs: this.getTaskTimeoutMs("GAME_CARD_ASSISTANT")
    });

    const answer = result.rawText.trim();
    if (!answer) {
      throw new Error("Game card assistant returned empty answer.");
    }
    return answer;
  }

  async generatePatchNarrative(group: ConflictGroup): Promise<string | null> {
    return this.generateCraPatchNarrative(group);
  }

  async generateCraPatchNarrative(group: ConflictGroup): Promise<string | null> {
    const systemPrompt = [
      "你是冲突解决代理（CRA）。",
      "任务：在互斥设定间生成可用于游戏状态机的补丁叙事，不要破坏世界观核心法则。",
      "输出要求：只输出补丁叙事文本，不要额外解释。"
    ].join("\n");

    const userPrompt = `conflict_group_json:\n${JSON.stringify(group, null, 2)}`;
    const result = await this.callAdapterWithRetry({
      task: "CRA_PATCH",
      systemPrompt,
      userPrompt,
      responseFormat: "text",
      temperature: 0.4,
      timeoutMs: this.getTaskTimeoutMs("CRA_PATCH")
    });

    const patch = result.rawText.trim();
    return patch.length > 0 ? patch : null;
  }

  async generateMainLoopTurn(input: { stateSnapshot: unknown; actionId: string }): Promise<Record<string, unknown>> {
    const compactState = compactTurnStateSnapshot(input.stateSnapshot);
    const worldState = isRecord(compactState) && isRecord(compactState.world_state) ? compactState.world_state : {};
    const plotMode =
      String((worldState as Record<string, unknown>).plot_mode ?? "FOLLOW_CANON").toUpperCase() === "SANDBOX"
        ? "SANDBOX"
        : "FOLLOW_CANON";
    const narrativeLog =
      isRecord(compactState) && isRecord(compactState.event_engine)
        ? String((compactState.event_engine as Record<string, unknown>).narrative_log ?? "")
        : "";
    const userPrompt = generateTurnPrompt(compactState, narrativeLog, input.actionId, plotMode);
    return this.generateJsonTask("MAIN_LOOP_TURN", TURN_RENDER_PROMPT_CONTRACT, userPrompt);
  }

  private async generateJsonTask(
    task: LlmTask,
    systemPrompt: string,
    userPrompt: string
  ): Promise<Record<string, unknown>> {
    const schema = getStructuredOutputSchema(task);
    const result = await this.callAdapterWithRetry({
      task,
      systemPrompt,
      userPrompt,
      responseFormat: "json_object",
      temperature: this.getTaskTemperature(task),
      responseSchema: schema,
      timeoutMs: this.getTaskTimeoutMs(task)
    });

    if (isRecord(result.json)) {
      return result.json;
    }

    // Some providers may still return JSON-looking text in content.
    try {
      const parsed = JSON.parse(result.rawText);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to error below.
    }

    throw new Error(`LLM task ${task} did not return a valid JSON object.`);
  }

  private async callAdapterWithRetry(request: {
    task: LlmTask;
    systemPrompt: string;
    userPrompt: string;
    responseFormat: "json_object" | "text";
    temperature: number;
    responseSchema?: Record<string, unknown>;
    timeoutMs: number;
  }) {
    const adapter = buildProviderAdapter(this.config);
    const maxAttempts = parsePositiveInt(process.env.LLM_RETRY_MAX, 2);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await adapter.generate(request);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const shouldRetry = attempt < maxAttempts && isTransientTransportError(message);
        if (!shouldRetry) {
          throw error;
        }
        await sleep(350 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private getTaskTimeoutMs(task: LlmTask): number {
    const globalTimeout = parsePositiveInt(process.env.LLM_TIMEOUT_MS, 90000);
    const mainLoopTimeout = parsePositiveInt(process.env.LLM_MAIN_LOOP_TIMEOUT_MS, 150000);
    const mapTimeout = parsePositiveInt(process.env.LLM_MAP_TIMEOUT_MS, 90000);

    if (task === "MAIN_LOOP_TURN") {
      return mainLoopTimeout;
    }
    if (task === "GAME_CARD") {
      return parsePositiveInt(process.env.LLM_GAME_CARD_TIMEOUT_MS, Math.max(mainLoopTimeout, 180000));
    }
    if (task === "GAME_CARD_ASSISTANT") {
      return parsePositiveInt(process.env.LLM_GAME_CARD_ASSISTANT_TIMEOUT_MS, Math.max(globalTimeout, 120000));
    }
    if (
      task === "MAP_STRUCTURED_EXTRACT" ||
      task === "MAP_EVENT_EXTRACTION" ||
      task === "MAP_RULE_PROBING" ||
      task === "CORE_CHARACTER_SUMMARY" ||
      task === "VISUAL_STYLE_RECOMMEND"
    ) {
      return mapTimeout;
    }
    return globalTimeout;
  }

  private getTaskTemperature(task: LlmTask): number {
    if (task === "MAIN_LOOP_TURN") {
      return 0.8;
    }
    if (
      task === "MAP_STRUCTURED_EXTRACT" ||
      task === "MAP_EVENT_EXTRACTION" ||
      task === "MAP_RULE_PROBING" ||
      task === "CORE_CHARACTER_SUMMARY" ||
      task === "VISUAL_STYLE_RECOMMEND"
    ) {
      return task === "VISUAL_STYLE_RECOMMEND" ? 0.35 : 0.2;
    }
    if (task === "RPG_STAT_DESIGN") {
      return 0.3;
    }
    if (task === "GAME_CARD") {
      return 0.45;
    }
    if (task === "GAME_CARD_ASSISTANT") {
      return 0.25;
    }
    return 0.2;
  }

  private async repairGameCardMarkdown(input: {
    markdown: string;
    errors: string[];
    targetActCount?: number;
    directivesMarkdown?: string;
  }): Promise<string> {
    const repairPrompt = buildGameCardRepairPrompt({
      markdown: truncateText(input.markdown, 70000),
      errors: input.errors.slice(0, 12),
      targetActCount: input.targetActCount,
      directivesMarkdown: truncateText(input.directivesMarkdown ?? "", 18000)
    });

    const result = await this.callAdapterWithRetry({
      task: "GAME_CARD",
      systemPrompt: GAME_CARD_SYSTEM_PROMPT,
      userPrompt: repairPrompt,
      responseFormat: "text",
      temperature: 0.2,
      timeoutMs: this.getTaskTimeoutMs("GAME_CARD")
    });

    const repaired = result.rawText.trim();
    return repaired || input.markdown;
  }
}

export function createLlmService(config?: Partial<LlmServiceConfig>): LlmService {
  const resolved = resolveServiceConfig(config);
  return new DefaultLlmService(resolved);
}

function resolveServiceConfig(config?: Partial<LlmServiceConfig>): LlmServiceConfig {
  const envProvider = (process.env.LLM_PROVIDER ?? "OPENAI_COMPAT").toUpperCase();
  const provider = ((config?.provider ?? envProvider) as ProviderName);
  const baseUrl = config?.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = config?.apiKey ?? process.env.LLM_API_KEY ?? "";
  const defaultModel = config?.defaultModel ?? process.env.LLM_MODEL ?? "gpt-4.1-mini";

  return {
    provider,
    baseUrl,
    apiKey,
    defaultModel,
    taskModels: {
      ...safeParseTaskModels(process.env.LLM_TASK_MODELS),
      ...(config?.taskModels ?? {})
    }
  };
}

function safeParseTaskModels(raw?: string): Partial<Record<LlmTask, string>> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<LlmTask, string>>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function truncateText(text: string, maxChars: number): string {
  if (!text) {
    return "";
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...<TRUNCATED>` : text;
}

function validateGameCardMarkdownStructure(markdown: string, targetActCount?: number): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const text = markdown || "";

  if (!/##\s*0\.\s*导演批注/i.test(text)) {
    errors.push("缺少固定标题：## 0. 导演批注");
  }
  if (!/##\s*5\.\s*主线剧情/i.test(text)) {
    errors.push("缺少固定标题：## 5. 主线剧情");
  }

  const actMatches = Array.from(text.matchAll(/^(?:#{1,6}\s*)?(?:Act\s*(\d+)|第\s*(\d+)\s*幕)\b.*$/gim));
  const actNumbers = actMatches.map((m) => Number(m[1] ?? m[2])).filter((n) => Number.isFinite(n) && n > 0);

  if (actNumbers.length === 0) {
    errors.push("未识别到任何 Act 标题。");
  } else {
    if (actNumbers[0] !== 1) {
      errors.push("Act 必须从 1 开始编号。");
    }
    for (let i = 1; i < actNumbers.length; i += 1) {
      if (actNumbers[i] !== actNumbers[i - 1] + 1) {
        errors.push("Act 编号必须连续递增，不能跳号。");
        break;
      }
    }
    const expectedMin = targetActCount ? Math.max(4, targetActCount - 2) : 4;
    if (actNumbers.length < expectedMin) {
      errors.push(`Act 数量偏少，当前 ${actNumbers.length} 幕，建议至少 ${expectedMin} 幕。`);
    }
  }

  const hasLegacyFunctionMacro = /<!\s*[\s\S]*?\s*!>/i.test(text);
  if (hasLegacyFunctionMacro) {
    errors.push("检测到已禁用的函数调用宏语法（<!...!>），请改为纯文本叙事与普通选项。");
  }

  if (actMatches.length > 0) {
    for (let i = 0; i < actMatches.length; i += 1) {
      const start = actMatches[i].index ?? 0;
      const end = actMatches[i + 1]?.index ?? text.length;
      const block = text.slice(start, end);
      const label = `Act ${actNumbers[i] ?? i + 1}`;
      if (!/(关键事件|Key Event)/i.test(block)) {
        errors.push(`${label} 缺少“关键事件”段落。`);
      }
      if (!/\d+\.\s*\[[^\]]+\]/.test(block)) {
        errors.push(`${label} 缺少“编号+事件标题”格式（如 1. [事件标题]）。`);
      }
      if (!/(场景锁定|Scene Override)/i.test(block)) {
        errors.push(`${label} 缺少“场景锁定（Scene Override）”子结构。`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function buildGameCardRepairPrompt(input: {
  markdown: string;
  errors: string[];
  targetActCount?: number;
  directivesMarkdown?: string;
}): string {
  const target = Math.max(4, Math.min(20, Math.floor(input.targetActCount ?? 8)));
  return `
你现在是“Markdown 游戏卡结构修复器”。
你的唯一任务是：在保留原内容设定的前提下，修复结构不合规问题，输出一份完整、可直接落地的 Markdown 游戏卡。

硬约束：
1) 只输出最终 Markdown，不要解释、不要前后缀说明。
2) 必须包含 0-7 共 8 个模块，且保留“## 0. 导演批注”。
3) 主线剧情必须按幕（Act）连续编号，约 ${target} 幕（允许 ±2）。
4) 每一幕必须包含“关键事件”并使用嵌套格式：
   1. [事件标题]
      > 🎬 **场景锁定（Scene Override）**:
      > 场景正文
      >
      > 🧭 **强制选项（Forced Choices）**:
      > - [选项A]
      > - [选项B]
5) 禁止输出函数调用宏语法：\`<!...!>\`。

本次检测到的问题：
${input.errors.map((e, i) => `${i + 1}. ${e}`).join("\n") || "（无）"}

导演批注说明书（优先遵循）：
${input.directivesMarkdown || "（未提供）"}

待修复原始 Markdown：
${input.markdown}
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactTurnStateSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  const base = snapshot as Record<string, unknown>;
  const worldState = isRecord(base.world_state) ? ({ ...base.world_state } as Record<string, unknown>) : undefined;

  if (worldState && isRecord(worldState.global_state_tree)) {
    worldState.global_state_tree = compactGlobalStateTree(worldState.global_state_tree as Record<string, unknown>);
  }

  return {
    ...base,
    world_state: worldState ?? base.world_state,
    event_engine: compactEventEngine(base.event_engine),
    dynamic_npc_network: limitArray(base.dynamic_npc_network, 80),
    _llm_prompt_hint: "state_snapshot_has_been_compacted_for_latency"
  };
}

function compactGameCardStateTree(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  const tree = snapshot as Record<string, unknown>;
  const entities = isRecord(tree.entities)
    ? Object.fromEntries(
        Object.entries(tree.entities)
          .slice(0, 160)
          .map(([id, value]) => [id, compactEntity(value)])
      )
    : {};

  const assertions = Array.isArray(tree.assertions)
    ? tree.assertions.slice(-220).map((item) => compactAssertion(item))
    : [];

  return {
    ...tree,
    entities,
    assertions,
    core_characters: limitArray(tree.core_characters, 40),
    global_attributes: limitArray(tree.global_attributes, 16),
    character_stats: isRecord(tree.character_stats)
      ? Object.fromEntries(Object.entries(tree.character_stats).slice(0, 60))
      : {}
  };
}

function compactGlobalStateTree(tree: Record<string, unknown>): Record<string, unknown> {
  const assertions = Array.isArray(tree.assertions)
    ? tree.assertions.slice(-160).map((item) => compactAssertion(item))
    : [];

  const entities = isRecord(tree.entities)
    ? Object.fromEntries(
        Object.entries(tree.entities)
          .slice(0, 120)
          .map(([entityId, value]) => [entityId, compactEntity(value)])
      )
    : {};

  const relationIndex = isRecord(tree.relation_index)
    ? Object.fromEntries(
        Object.entries(tree.relation_index)
          .slice(0, 120)
          .map(([key, value]) => [key, limitArray(value, 10)])
      )
    : {};

  const characterStats = isRecord(tree.character_stats)
    ? Object.fromEntries(Object.entries(tree.character_stats).slice(0, 50))
    : {};

  return {
    metadata: isRecord(tree.metadata) ? tree.metadata : {},
    global_attributes: limitArray(tree.global_attributes, 12),
    core_characters: limitArray(tree.core_characters, 30),
    custom_character_recommendation: isRecord(tree.custom_character_recommendation)
      ? tree.custom_character_recommendation
      : {},
    character_stats: characterStats,
    relation_index: relationIndex,
    entities,
    assertions
  };
}

function compactEntity(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const entity = value as Record<string, unknown>;
  return {
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    display_name: entity.display_name,
    components: compactComponents(entity.components)
  };
}

function compactComponents(value: unknown): unknown {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).slice(0, 16));
}

function compactAssertion(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const item = value as Record<string, unknown>;
  return {
    assertion_id: item.assertion_id,
    entity_id: item.entity_id,
    attribute_key: item.attribute_key,
    value: item.value,
    chapter_index: item.chapter_index,
    confidence_score: item.confidence_score,
    category: item.category
  };
}

function compactEventEngine(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const eventEngine = value as Record<string, unknown>;
  return {
    narrative_log: eventEngine.narrative_log,
    observation_data: eventEngine.observation_data,
    available_actions: limitArray(eventEngine.available_actions, 30)
  };
}

function limitArray(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, max);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function isTransientTransportError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("transport error") ||
    text.includes("fetch failed") ||
    text.includes("aborted") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("socket") ||
    text.includes("econnreset") ||
    text.includes("etimedout")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
