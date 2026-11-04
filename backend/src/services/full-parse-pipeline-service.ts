import { randomUUID } from "node:crypto";
import type { EcsAssertion, EcsEntity, EcsGlobalStateTree, EcsLocalGraph } from "../contracts/ecs";
import { createLlmService, type LlmService } from "./llmService";
import { MapExtractService } from "./map-extract-service";
import { ReduceConflictService, type ReduceConflictResult } from "./reduce-conflict-service";

export interface FullParsePipelineRequest {
  chunks: string[];
  baseline_context?: string;
  chunk_id_prefix?: string;
  start_chapter_index?: number;
}

export interface FullParsePipelineProgress {
  stage: "MAP" | "REDUCE" | "DONE";
  total_chunks: number;
  mapped_chunks: number;
  failed_chunks: number;
  current_chunk_index: number | null;
  current_chapter_index: number | null;
  message?: string;
}

export interface FullParsePipelineResult extends ReduceConflictResult {
  local_graphs: EcsLocalGraph[];
  pipeline_report: {
    mapped_chunks: number;
    failed_chunks: number;
    start_chapter_index: number;
    end_chapter_index: number;
    baseline_strategy: "ROLLING_SUMMARY";
  };
}

export interface FullParsePipelineExecuteOptions {
  continue_on_chunk_error?: boolean;
  onProgress?: (progress: FullParsePipelineProgress) => void;
  shouldPause?: () => boolean;
  checkpoint?: FullParsePipelineCheckpoint;
}

export interface FullParsePipelineCheckpoint {
  local_graphs: EcsLocalGraph[];
  rolling_baseline: string;
  failed_chunks: number;
  next_chunk_index: number;
}

export class FullParsePipelinePausedError extends Error {
  constructor(public readonly checkpoint: FullParsePipelineCheckpoint) {
    super("FULL_PARSE_PAUSED");
    this.name = "FullParsePipelinePausedError";
  }
}

interface RpgAttribute {
  key: string;
  name: string;
}

interface RpgDesignResult {
  global_attributes: RpgAttribute[];
  character_stats: Record<string, Record<string, number>>;
  core_characters: Array<{
    entity_id: string;
    name: string;
    biography?: string;
    appearance?: string;
  }>;
  custom_character_recommendation: Record<string, number>;
}

export class FullParsePipelineService {
  constructor(
    private readonly mapService = new MapExtractService(),
    private readonly reduceService = new ReduceConflictService(),
    private readonly llmService: LlmService = createLlmService()
  ) {}

  async execute(
    request: FullParsePipelineRequest,
    options: FullParsePipelineExecuteOptions = {}
  ): Promise<FullParsePipelineResult> {
    const startChapter = request.start_chapter_index ?? 1;
    const checkpoint = options.checkpoint;
    const localGraphs: EcsLocalGraph[] = [...(checkpoint?.local_graphs ?? [])];
    const continueOnChunkError = options.continue_on_chunk_error ?? true;

    let rollingBaseline = checkpoint?.rolling_baseline ?? (request.baseline_context ?? "").trim();
    let failedChunks = checkpoint?.failed_chunks ?? 0;
    const startChunkIndex = checkpoint?.next_chunk_index ?? 0;

    emitProgress(options, {
      stage: "MAP",
      total_chunks: request.chunks.length,
      mapped_chunks: localGraphs.length,
      failed_chunks: failedChunks,
      current_chunk_index: startChunkIndex > 0 ? startChunkIndex : null,
      current_chapter_index: startChunkIndex > 0 ? startChapter + startChunkIndex - 1 : null,
      message: startChunkIndex > 0 ? `从切片 ${startChunkIndex + 1} 恢复 Map 提取` : "准备开始 Map 提取"
    });

    for (let i = startChunkIndex; i < request.chunks.length; i += 1) {
      if (options.shouldPause?.()) {
        throw new FullParsePipelinePausedError({
          local_graphs: localGraphs,
          rolling_baseline: rollingBaseline,
          failed_chunks: failedChunks,
          next_chunk_index: i
        });
      }
      const chapterIndex = startChapter + i;
      let graph: EcsLocalGraph;

      try {
        graph = await this.mapService.extract({
          chunk_id: request.chunk_id_prefix ? `${request.chunk_id_prefix}-chunk-${chapterIndex}` : undefined,
          chapter_index: chapterIndex,
          chunk_text: request.chunks[i],
          baseline_context: rollingBaseline
        });
      } catch (error) {
        if (!continueOnChunkError) {
          throw error;
        }

        failedChunks += 1;
        graph = createPipelineFallbackGraph({
          chapter_index: chapterIndex,
          chunk_id: request.chunk_id_prefix ? `${request.chunk_id_prefix}-chunk-${chapterIndex}` : undefined,
          chunk_text: request.chunks[i],
          error_message: error instanceof Error ? error.message : String(error)
        });
      }

      localGraphs.push(graph);
      rollingBaseline = buildRollingBaseline(rollingBaseline, graph);

      emitProgress(options, {
        stage: "MAP",
        total_chunks: request.chunks.length,
        mapped_chunks: localGraphs.length,
        failed_chunks: failedChunks,
        current_chunk_index: i + 1,
        current_chapter_index: chapterIndex,
        message: `Map 进度 ${i + 1}/${request.chunks.length}`
      });
    }

    emitProgress(options, {
      stage: "REDUCE",
      total_chunks: request.chunks.length,
      mapped_chunks: localGraphs.length,
      failed_chunks: failedChunks,
      current_chunk_index: null,
      current_chapter_index: null,
      message: "正在执行全局冲突仲裁"
    });

    const reduced = await this.reduceService.reduce({
      local_graphs: localGraphs
    });

    const withRpg = await this.enrichGlobalStateWithRpg(reduced.global_state_tree, localGraphs);

    const result: FullParsePipelineResult = {
      ...reduced,
      global_state_tree: withRpg,
      local_graphs: localGraphs,
      pipeline_report: {
        mapped_chunks: localGraphs.length,
        failed_chunks: failedChunks,
        start_chapter_index: startChapter,
        end_chapter_index: startChapter + localGraphs.length - 1,
        baseline_strategy: "ROLLING_SUMMARY"
      }
    };

    emitProgress(options, {
      stage: "DONE",
      total_chunks: request.chunks.length,
      mapped_chunks: localGraphs.length,
      failed_chunks: failedChunks,
      current_chunk_index: null,
      current_chapter_index: null,
      message: "全局解析完成"
    });

    return result;
  }

  async enrichGlobalStateWithRpg(globalStateTree: EcsGlobalStateTree, localGraphs: EcsLocalGraph[]): Promise<EcsGlobalStateTree> {
    const withCharacterSummary = await this.enrichCoreCharacterSummaries(globalStateTree);
    const implicitRules = gatherImplicitRules(localGraphs);
    const coreCharacters = extractCoreCharacters(withCharacterSummary.entities);

    const fallback = buildFallbackRpgDesign(coreCharacters, implicitRules);
    if (coreCharacters.length === 0) {
      return mergeRpgDesign(withCharacterSummary, fallback, "NO_CORE_CHARACTER");
    }

    try {
      const llmResult = await this.llmService.designRpgStats({
        implicitRules,
        coreCharacters
      });
      const normalized = normalizeRpgDesign(llmResult, coreCharacters, fallback);
      return mergeRpgDesign(withCharacterSummary, normalized, "LLM");
    } catch (error) {
      const mode = `FALLBACK:${error instanceof Error ? error.message : "unknown"}`;
      return mergeRpgDesign(withCharacterSummary, fallback, mode);
    }
  }

  private async enrichCoreCharacterSummaries(globalStateTree: EcsGlobalStateTree): Promise<EcsGlobalStateTree> {
    const coreCharacters = extractCoreCharacters(globalStateTree.entities);
    if (coreCharacters.length === 0) {
      return globalStateTree;
    }

    const summaryInput = buildCharacterSummaryInput(globalStateTree, coreCharacters);
    let summaryMap: Record<string, { biography?: string; appearance?: string }> = {};

    try {
      const llmResult = await this.llmService.summarizeCoreCharacters({
        characters: summaryInput
      });
      summaryMap = normalizeCharacterSummaries(llmResult, coreCharacters);
    } catch {
      summaryMap = {};
    }

    return applyCharacterSummaries(globalStateTree, coreCharacters, summaryMap);
  }
}

function emitProgress(options: FullParsePipelineExecuteOptions, progress: FullParsePipelineProgress): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // Ignore callback errors to keep backend pipeline stable.
  }
}

function createPipelineFallbackGraph(input: {
  chapter_index: number;
  chunk_id?: string;
  chunk_text: string;
  error_message: string;
}): EcsLocalGraph {
  const summary = deriveSummaryFromChunk(input.chunk_text) || "该切片因模型输出异常进入兜底摘要模式。";
  const assertion: EcsAssertion = {
    assertion_id: randomUUID(),
    entity_id: "world",
    attribute_key: "chunk_brief_summary",
    value: summary,
    chapter_index: input.chapter_index,
    confidence_score: 0.4,
    evidence_count: 1,
    category: "FACT",
    scope: "LOCAL"
  };

  return {
    chunk_id: input.chunk_id ?? `chunk_${input.chapter_index}`,
    chapter_index: input.chapter_index,
    entities: [
      {
        entity_id: "world",
        entity_type: "world",
        display_name: "世界",
        components: {}
      }
    ],
    assertions: [assertion],
    implicit_rules: {
      social_power_relations: [],
      ability_costs: [],
      causal_invariants: []
    },
    metadata: {
      extraction_mode: "PIPELINE_FALLBACK",
      brief_summary: summary,
      error_message: input.error_message
    }
  };
}

function deriveSummaryFromChunk(chunkText: string): string {
  const normalized = chunkText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
}

function buildRollingBaseline(previous: string, graph: EcsLocalGraph): string {
  const metaSummary = typeof graph.metadata?.brief_summary === "string" ? graph.metadata.brief_summary : "";

  const social = graph.implicit_rules.social_power_relations.slice(0, 2);
  const ability = graph.implicit_rules.ability_costs.slice(0, 2);
  const causal = graph.implicit_rules.causal_invariants.slice(0, 2);

  const assertionFacts = graph.assertions
    .filter((item) => item.category === "FACT")
    .slice(0, 2)
    .map((item) => item.value);

  const nextPieces = [previous, metaSummary, ...social, ...ability, ...causal, ...assertionFacts]
    .map((item) => item.trim())
    .filter(Boolean);

  const merged = Array.from(new Set(nextPieces)).join("；");
  return merged.slice(-2200);
}

function gatherImplicitRules(localGraphs: EcsLocalGraph[]): string[] {
  const all = localGraphs.flatMap((graph) => [
    ...graph.implicit_rules.social_power_relations,
    ...graph.implicit_rules.ability_costs,
    ...graph.implicit_rules.causal_invariants
  ]);
  return Array.from(new Set(all.map((item) => item.trim()).filter(Boolean))).slice(0, 80);
}

function extractCoreCharacters(entities: Record<string, EcsEntity>): Array<{
  entity_id: string;
  name: string;
  biography?: string;
  appearance?: string;
}> {
  return Object.values(entities)
    .filter((entity) => isLikelyCharacter(entity))
    .map((entity) => {
      const bio = pickBiography(entity.components);
      const appearance = pickAppearance(entity.components);
      return {
        entity_id: entity.entity_id,
        name: entity.display_name || entity.entity_id,
        biography: bio || undefined,
        appearance: appearance || undefined
      };
    })
    .slice(0, 30);
}

function isLikelyCharacter(entity: EcsEntity): boolean {
  if (entity.entity_type === "character") {
    return true;
  }
  const entityId = entity.entity_id.toLowerCase();
  return entityId.startsWith("char_") || entityId.includes("npc");
}

function pickBiography(components: Record<string, unknown>): string {
  const candidates = [
    components.origin_background,
    components.biography,
    components.background,
    components.description,
    components.title
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickAppearance(components: Record<string, unknown>): string {
  const candidates = [
    components.appearance,
    components.looks,
    components.outfit,
    components.body_shape,
    components.face,
    components.weapon_appearance
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function buildCharacterSummaryInput(
  globalStateTree: EcsGlobalStateTree,
  coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>
): Array<{
  entity_id: string;
  name: string;
  known_biography?: string;
  known_appearance?: string;
  raw_profile: string;
}> {
  const assertionByEntity = new Map<string, EcsAssertion[]>();
  globalStateTree.assertions.forEach((assertion) => {
    const list = assertionByEntity.get(assertion.entity_id) ?? [];
    list.push(assertion);
    assertionByEntity.set(assertion.entity_id, list);
  });

  return coreCharacters.map((character) => {
    const entity = globalStateTree.entities[character.entity_id];
    const entityComponents = entity?.components ?? {};
    const assertionFacts = (assertionByEntity.get(character.entity_id) ?? [])
      .sort((a, b) => b.chapter_index - a.chapter_index)
      .slice(0, 10)
      .map((item) => `${item.attribute_key}: ${item.value}`);

    const rawProfileParts = [
      `name=${character.name}`,
      `entity_id=${character.entity_id}`,
      ...Object.entries(entityComponents).slice(0, 16).map(([key, value]) => `${key}: ${stringifyComponentValue(value)}`),
      ...assertionFacts
    ];

    return {
      entity_id: character.entity_id,
      name: character.name,
      known_biography: character.biography,
      known_appearance: character.appearance,
      raw_profile: rawProfileParts.join(" | ").slice(0, 2200)
    };
  });
}

function normalizeCharacterSummaries(
  raw: Record<string, unknown>,
  coreCharacters: Array<{ entity_id: string }>
): Record<string, { biography?: string; appearance?: string }> {
  const summaries = isRecord(raw.character_summaries) ? (raw.character_summaries as Record<string, unknown>) : {};
  const out: Record<string, { biography?: string; appearance?: string }> = {};
  coreCharacters.forEach((character) => {
    const item = isRecord(summaries[character.entity_id]) ? (summaries[character.entity_id] as Record<string, unknown>) : null;
    if (!item) {
      return;
    }
    const biography = asString(item.biography);
    const appearance = asString(item.appearance);
    if (!biography && !appearance) {
      return;
    }
    out[character.entity_id] = {
      biography: biography ? clampTextLength(biography, 50) : undefined,
      appearance: appearance ? clampTextLength(appearance, 50) : undefined
    };
  });
  return out;
}

function applyCharacterSummaries(
  globalStateTree: EcsGlobalStateTree,
  coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>,
  summaries: Record<string, { biography?: string; appearance?: string }>
): EcsGlobalStateTree {
  const nextEntities: Record<string, EcsEntity> = { ...globalStateTree.entities };
  const nextCoreCharacters = coreCharacters.map((character) => {
    const summary = summaries[character.entity_id] ?? {};
    const biography = summary.biography ?? character.biography;
    const appearance = summary.appearance ?? character.appearance;
    const existingEntity = nextEntities[character.entity_id];
    if (existingEntity) {
      nextEntities[character.entity_id] = {
        ...existingEntity,
        components: {
          ...existingEntity.components,
          ...(biography ? { biography } : {}),
          ...(appearance ? { appearance } : {}),
          ...(biography ? { origin_background: biography } : {})
        }
      };
    }

    return {
      ...character,
      ...(biography ? { biography } : {}),
      ...(appearance ? { appearance } : {})
    };
  });

  return {
    ...globalStateTree,
    entities: nextEntities,
    core_characters: nextCoreCharacters,
    metadata: {
      ...globalStateTree.metadata,
      core_character_summary_generated: true
    }
  };
}

function buildFallbackRpgDesign(
  coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>,
  implicitRules: string[]
): RpgDesignResult {
  const lowerRules = implicitRules.join(" ").toLowerCase();
  const attributes = /(灵力|修为|真气|法力|丹田|仙|玄幻|魔法|mana|spirit)/.test(lowerRules)
    ? [
        { key: "spiritual_power", name: "灵力" },
        { key: "physique", name: "根骨" },
        { key: "willpower", name: "意志" }
      ]
    : /(理智|推理|线索|悬疑|调查|sanity|clue|observe)/.test(lowerRules)
      ? [
          { key: "sanity", name: "理智" },
          { key: "observation", name: "观察" },
          { key: "insight", name: "洞察" }
        ]
      : [
          { key: "strength", name: "力量" },
          { key: "intelligence", name: "智谋" },
          { key: "resilience", name: "韧性" }
        ];

  const characterStats: Record<string, Record<string, number>> = {};
  coreCharacters.forEach((character, idx) => {
    characterStats[character.entity_id] = {
      [attributes[0].key]: clampStat(55 + idx % 15),
      [attributes[1].key]: clampStat(50 + (idx * 7) % 20),
      [attributes[2].key]: clampStat(52 + (idx * 5) % 18)
    };
  });

  return {
    global_attributes: attributes,
    character_stats: characterStats,
    core_characters: coreCharacters,
    custom_character_recommendation: buildCustomRecommendation(characterStats, attributes)
  };
}

function normalizeRpgDesign(
  raw: Record<string, unknown>,
  coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>,
  fallback: RpgDesignResult
): RpgDesignResult {
  const rawAttributes = Array.isArray(raw.global_attributes) ? raw.global_attributes : [];
  const normalizedAttributes = rawAttributes
    .map((item) => (isRecord(item) ? item : null))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item, idx) => ({
      key: normalizeAttributeKey(asString(item.key) ?? asString(item.id) ?? `attr_${idx + 1}`),
      name: asString(item.name) ?? asString(item.title) ?? `属性${idx + 1}`
    }))
    .filter((item) => item.key.length > 0)
    .slice(0, 5);

  const attributes = normalizedAttributes.length >= 3 ? normalizedAttributes : fallback.global_attributes;

  const rawStats = isRecord(raw.character_stats) ? raw.character_stats : {};
  const characterStats: Record<string, Record<string, number>> = {};

  coreCharacters.forEach((character) => {
    const statObj = isRecord(rawStats[character.entity_id]) ? (rawStats[character.entity_id] as Record<string, unknown>) : {};
    const attrStats: Record<string, number> = {};
    attributes.forEach((attribute) => {
      const fallbackValue = fallback.character_stats[character.entity_id]?.[attribute.key] ?? 50;
      attrStats[attribute.key] = clampStat(asNumber(statObj[attribute.key]) ?? fallbackValue);
    });
    characterStats[character.entity_id] = attrStats;
  });

  return {
    global_attributes: attributes,
    character_stats: characterStats,
    core_characters: coreCharacters,
    custom_character_recommendation: buildCustomRecommendation(characterStats, attributes)
  };
}

function mergeRpgDesign(
  globalStateTree: EcsGlobalStateTree,
  design: RpgDesignResult,
  source: string
): EcsGlobalStateTree {
  return {
    ...globalStateTree,
    global_attributes: design.global_attributes,
    character_stats: design.character_stats,
    core_characters: design.core_characters,
    custom_character_recommendation: design.custom_character_recommendation,
    metadata: {
      ...globalStateTree.metadata,
      rpg_generated: true,
      rpg_source: source,
      rpg_attribute_count: design.global_attributes.length,
      rpg_character_count: Object.keys(design.character_stats).length
    }
  };
}

function buildCustomRecommendation(
  characterStats: Record<string, Record<string, number>>,
  attributes: RpgAttribute[]
): Record<string, number> {
  const entries = Object.values(characterStats);
  const result: Record<string, number> = {};
  attributes.forEach((attribute) => {
    if (entries.length === 0) {
      result[attribute.key] = 50;
      return;
    }
    const sum = entries.reduce((acc, item) => acc + (item[attribute.key] ?? 50), 0);
    result[attribute.key] = clampStat(Math.round(sum / entries.length));
  });
  return result;
}

function normalizeAttributeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function clampStat(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampTextLength(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function stringifyComponentValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyComponentValue(item)).join(", ");
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return "";
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
