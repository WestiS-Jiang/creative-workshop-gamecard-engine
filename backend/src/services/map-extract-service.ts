import { createHash, randomUUID } from "node:crypto";
import type { EcsAssertion, EcsEntity, EcsLocalGraph } from "../contracts/ecs";
import { MapDualStreamExtractor } from "../engine/map-reduce/extractor";
import { createLlmService, type LlmService } from "./llmService";

export interface MapExtractRequest {
  chunk_id?: string;
  chapter_index: number;
  chunk_text: string;
  baseline_context?: string;
}

const MAP_CONFIDENCE_THRESHOLD = 0.6;
const DEFAULT_MAP_CACHE_MAX_ENTRIES = 2000;
const MAP_CACHE = new Map<string, EcsLocalGraph>();

export class MapExtractService {
  private readonly legacyExtractor: MapDualStreamExtractor;

  constructor(private readonly llmService: LlmService = createLlmService()) {
    this.legacyExtractor = new MapDualStreamExtractor(this.llmService);
  }

  async extract(request: MapExtractRequest): Promise<EcsLocalGraph> {
    const chunkHash = hashChunkText(request.chunk_text);
    const cachedGraph = getCachedGraph(chunkHash);
    if (cachedGraph) {
      return materializeCachedGraph(cachedGraph, request, chunkHash);
    }

    let structuredError: Error | null = null;
    try {
      const structured = await this.llmService.extractStructuredMap({
        chapterIndex: request.chapter_index,
        chapterText: request.chunk_text,
        baselineContext: request.baseline_context
      });

      if (!isRecord(structured)) {
        throw new Error("Structured map response is not an object.");
      }

      const parsed = normalizeStructuredLocalGraph(request, structured);
      putCachedGraph(chunkHash, parsed);
      return attachCacheMetadata(parsed, chunkHash, false);
    } catch (error) {
      structuredError = toError(error);
    }

    try {
      // Backward-compatible fallback keeps service available if model does not respect the strict JSON contract.
      const fallbackGraph = await this.extractByLegacyDualStream(request);
      putCachedGraph(chunkHash, fallbackGraph);
      return attachCacheMetadata(fallbackGraph, chunkHash, false);
    } catch (legacyError) {
      return createMinimalFallbackGraph(request, {
        structured_error: structuredError?.message,
        legacy_error: toError(legacyError).message
      });
    }
  }

  private async extractByLegacyDualStream(request: MapExtractRequest): Promise<EcsLocalGraph> {
    const dualStream = await this.legacyExtractor.extract({
      chapterIndex: request.chapter_index,
      chapterText: request.chunk_text,
      baselineContext: request.baseline_context
    });

    const entities = normalizeEntities(dualStream.event_stream);
    const assertions = normalizeAssertions({
      chapterIndex: request.chapter_index,
      entities,
      eventStream: dualStream.event_stream,
      ruleStream: dualStream.rule_stream
    });

    const implicit_rules = {
      social_power_relations: extractRuleList(dualStream.rule_stream, ["Implicit_Rules", "social_topology"]),
      ability_costs: extractRuleList(dualStream.rule_stream, ["Implicit_Rules", "resource_constraints"]),
      causal_invariants: extractRuleList(dualStream.rule_stream, ["Implicit_Rules", "causal_invariants"])
    };

    return {
      chunk_id: request.chunk_id ?? randomUUID(),
      chapter_index: request.chapter_index,
      entities,
      assertions,
      implicit_rules,
      metadata: {
        extraction_mode: "RULE_PROBING_ENFORCED",
        fallback_mode: "LEGACY_DUAL_STREAM"
      }
    };
  }
}

function createMinimalFallbackGraph(
  request: MapExtractRequest,
  errors: { structured_error?: string; legacy_error?: string }
): EcsLocalGraph {
  const summary = deriveSummaryFromChunk(request.chunk_text) || "本切片解析失败，已进入最小兜底模式。";
  return {
    chunk_id: request.chunk_id ?? `chunk_${request.chapter_index}`,
    chapter_index: request.chapter_index,
    entities: [
      {
        entity_id: "world",
        entity_type: "world",
        display_name: "世界",
        components: {}
      }
    ],
    assertions: [
      {
        assertion_id: randomUUID(),
        entity_id: "world",
        attribute_key: "chunk_brief_summary",
        value: summary,
        chapter_index: request.chapter_index,
        confidence_score: 0.45,
        evidence_count: 1,
        category: "FACT",
        scope: "LOCAL",
        excerpt: summary
      }
    ],
    implicit_rules: {
      social_power_relations: [],
      ability_costs: [],
      causal_invariants: []
    },
    metadata: {
      extraction_mode: "MINIMAL_FALLBACK",
      parser_version: "map_structured_v1",
      brief_summary: summary,
      structured_error: errors.structured_error,
      legacy_error: errors.legacy_error
    }
  };
}

function normalizeStructuredLocalGraph(request: MapExtractRequest, structured: Record<string, unknown>): EcsLocalGraph {
  const chunkMeta = asRecord(structured.chunk_metadata);
  const summary = asString(chunkMeta?.brief_summary) ?? deriveSummaryFromChunk(request.chunk_text);
  const timelineWeight = asNumber(chunkMeta?.timeline_weight) ?? request.chapter_index;

  const entitiesById = new Map<string, EcsEntity>();
  const assertions: EcsAssertion[] = [];

  const implicit_rules = {
    social_power_relations: [] as string[],
    ability_costs: [] as string[],
    causal_invariants: [] as string[]
  };

  let droppedLowConfidenceCount = 0;

  const entityUpdates = asArray(structured.entity_updates);
  entityUpdates.forEach((item, index) => {
    const update = asRecord(item);
    if (!update) {
      return;
    }

    const confidence = asNumber(update.confidence) ?? 0;
    if (confidence < MAP_CONFIDENCE_THRESHOLD) {
      droppedLowConfidenceCount += 1;
      return;
    }

    const entityId = normalizeEntityId(asString(update.entity_id) ?? `entity_${request.chapter_index}_${index + 1}`);
    const entityType = toEntityType(asString(update.entity_type) ?? "other");
    const actionType = asString(update.action_type) ?? "update";
    const attrs = asRecord(update.extracted_attributes) ?? {};
    const sourceQuote = asString(update.source_quote);

    const displayName =
      asString(attrs.display_name) ?? asString(attrs.name) ?? asString(attrs.title) ?? humanizeEntityId(entityId);

    upsertEntity(entitiesById, {
      entity_id: entityId,
      entity_type: entityType,
      display_name: displayName,
      components: {
        ...attrs,
        action_type: actionType,
        confidence
      }
    });

    Object.entries(attrs).forEach(([key, rawValue]) => {
      const value = stringifyValue(rawValue);
      if (!value) {
        return;
      }

      const category = inferAssertionCategoryByAttribute(key, value);
      assertions.push({
        assertion_id: randomUUID(),
        entity_id: entityId,
        attribute_key: key,
        value,
        chapter_index: request.chapter_index,
        confidence_score: confidence,
        evidence_count: 1,
        category,
        scope: category === "FACT" ? "LOCAL" : "GLOBAL",
        excerpt: sourceQuote ?? undefined,
        core_entity: actionType === "create" ? true : undefined
      });
    });
  });

  const relationalEdges = asArray(structured.relational_edges);
  relationalEdges.forEach((item, index) => {
    const edge = asRecord(item);
    if (!edge) {
      return;
    }

    const confidence = asNumber(edge.confidence) ?? 0;
    if (confidence < MAP_CONFIDENCE_THRESHOLD) {
      droppedLowConfidenceCount += 1;
      return;
    }

    const source = normalizeEntityId(asString(edge.source_entity) ?? `source_${request.chapter_index}_${index + 1}`);
    const target = normalizeEntityId(asString(edge.target_entity) ?? `target_${request.chapter_index}_${index + 1}`);
    const relationType = asString(edge.relation_type) ?? "关联";
    const sourceQuote = asString(edge.source_quote);

    upsertEntity(entitiesById, {
      entity_id: source,
      entity_type: "other",
      display_name: humanizeEntityId(source),
      components: {}
    });
    upsertEntity(entitiesById, {
      entity_id: target,
      entity_type: "other",
      display_name: humanizeEntityId(target),
      components: {}
    });

    const category = inferRelationCategory(relationType);
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: source,
      attribute_key: `relation_to_${target}`,
      value: relationType,
      chapter_index: request.chapter_index,
      confidence_score: confidence,
      evidence_count: 1,
      category,
      scope: "GLOBAL",
      excerpt: sourceQuote ?? undefined
    });
  });

  const implicitRules = asArray(structured.implicit_rules);
  implicitRules.forEach((item, index) => {
    const rule = asRecord(item);
    if (!rule) {
      return;
    }

    const confidence = asNumber(rule.confidence) ?? 0;
    if (confidence < MAP_CONFIDENCE_THRESHOLD) {
      droppedLowConfidenceCount += 1;
      return;
    }

    const ruleCategory = (asString(rule.rule_category) ?? "").toLowerCase();
    const ruleDescription = asString(rule.rule_description);
    if (!ruleDescription) {
      return;
    }
    const triggerCondition = asString(rule.trigger_condition) ?? "";
    const renderedRule = triggerCondition ? `${triggerCondition} => ${ruleDescription}` : ruleDescription;

    const mapped = mapRuleCategory(ruleCategory, ruleDescription);
    if (mapped === "SOCIAL_POWER") {
      implicit_rules.social_power_relations.push(renderedRule);
    } else if (mapped === "ABILITY_COST") {
      implicit_rules.ability_costs.push(renderedRule);
    } else {
      implicit_rules.causal_invariants.push(renderedRule);
    }

    assertions.push({
      assertion_id: randomUUID(),
      entity_id: "world",
      attribute_key: `implicit_rule_${index + 1}`,
      value: renderedRule,
      chapter_index: request.chapter_index,
      confidence_score: confidence,
      evidence_count: 1,
      category: mapped,
      scope: "GLOBAL"
    });
  });

  if (summary) {
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: "world",
      attribute_key: "chunk_brief_summary",
      value: summary,
      chapter_index: request.chapter_index,
      confidence_score: 0.8,
      evidence_count: 1,
      category: "FACT",
      scope: "LOCAL"
    });
  }

  if (!entitiesById.has("world")) {
    entitiesById.set("world", {
      entity_id: "world",
      entity_type: "world",
      display_name: "世界",
      components: {}
    });
  }

  return {
    chunk_id: request.chunk_id ?? `chunk_${request.chapter_index}`,
    chapter_index: request.chapter_index,
    entities: [...entitiesById.values()],
    assertions,
    implicit_rules: {
      social_power_relations: uniqueStrings(implicit_rules.social_power_relations),
      ability_costs: uniqueStrings(implicit_rules.ability_costs),
      causal_invariants: uniqueStrings(implicit_rules.causal_invariants)
    },
    metadata: {
      extraction_mode: "RULE_PROBING_ENFORCED",
      parser_version: "map_structured_v1",
      timeline_weight: timelineWeight,
      brief_summary: summary,
      dropped_low_confidence_count: droppedLowConfidenceCount
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

function inferAssertionCategoryByAttribute(key: string, value: string): EcsAssertion["category"] {
  const token = `${key} ${value}`.toLowerCase();
  if (/(阶层|地位|门阀|统治|贵族|压迫|social|rank|class|hierarchy)/.test(token)) {
    return "SOCIAL_POWER";
  }
  if (/(消耗|代价|寿命|损耗|冷却|能量|法力|cost|mana|stamina|cooldown)/.test(token)) {
    return "ABILITY_COST";
  }
  return "FACT";
}

function inferRelationCategory(relationType: string): EcsAssertion["category"] {
  const token = relationType.toLowerCase();
  if (/(结盟|背叛|统属|压制|臣服|敌对|克制|恋慕|alliance|betray|rival|domin)/.test(token)) {
    return "SOCIAL_POWER";
  }
  return "FACT";
}

function mapRuleCategory(ruleCategory: string, ruleDescription: string): EcsAssertion["category"] {
  const combined = `${ruleCategory} ${ruleDescription}`.toLowerCase();

  if (ruleCategory.includes("social") || /(阶级|权力|门阀|压迫|统治|hierarchy)/.test(combined)) {
    return "SOCIAL_POWER";
  }
  if (/(cost|消耗|代价|寿命|冷却|mana|stamina|resource|magic_system)/.test(combined)) {
    return "ABILITY_COST";
  }
  return "CAUSAL_RULE";
}

function normalizeEntityId(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `entity_${randomUUID().slice(0, 8)}`;
}

function humanizeEntityId(entityId: string): string {
  return entityId
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown Entity";
}

function upsertEntity(map: Map<string, EcsEntity>, next: EcsEntity): void {
  const existing = map.get(next.entity_id);
  if (!existing) {
    map.set(next.entity_id, next);
    return;
  }

  map.set(next.entity_id, {
    ...existing,
    ...next,
    display_name: existing.display_name || next.display_name,
    components: {
      ...existing.components,
      ...next.components
    }
  });
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) || isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeEntities(eventStream: Record<string, unknown>): EcsEntity[] {
  const entitiesRaw = Array.isArray(eventStream.entities) ? eventStream.entities : [];
  return entitiesRaw
    .map((it) => {
      if (!isRecord(it)) {
        return null;
      }

      const id = asString(it.id) ?? asString(it.entity_id) ?? randomUUID();
      const name = asString(it.name) ?? "未命名实体";
      const type = asString(it.type) ?? "other";

      return {
        entity_id: id,
        entity_type: toEntityType(type),
        display_name: name,
        components: {}
      } satisfies EcsEntity;
    })
    .filter((v): v is EcsEntity => !!v);
}

function normalizeAssertions(input: {
  chapterIndex: number;
  entities: EcsEntity[];
  eventStream: Record<string, unknown>;
  ruleStream: Record<string, unknown>;
}): EcsAssertion[] {
  const assertions: EcsAssertion[] = [];
  const knownEntityId = input.entities[0]?.entity_id ?? "world";

  const socialRules = extractRuleItems(input.ruleStream, ["Implicit_Rules", "social_topology"]);
  socialRules.forEach((rule, idx) => {
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: knownEntityId,
      attribute_key: `social_power_rule_${idx + 1}`,
      value: rule,
      chapter_index: input.chapterIndex,
      confidence_score: 0.7,
      evidence_count: 1,
      category: "SOCIAL_POWER",
      scope: "GLOBAL"
    });
  });

  const costRules = extractRuleItems(input.ruleStream, ["Implicit_Rules", "resource_constraints"]);
  costRules.forEach((rule, idx) => {
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: knownEntityId,
      attribute_key: `ability_cost_rule_${idx + 1}`,
      value: rule,
      chapter_index: input.chapterIndex,
      confidence_score: 0.7,
      evidence_count: 1,
      category: "ABILITY_COST",
      scope: "GLOBAL"
    });
  });

  const causalRules = extractRuleItems(input.ruleStream, ["Implicit_Rules", "causal_invariants"]);
  causalRules.forEach((rule, idx) => {
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: "world",
      attribute_key: `causal_rule_${idx + 1}`,
      value: rule,
      chapter_index: input.chapterIndex,
      confidence_score: 0.75,
      evidence_count: 1,
      category: "CAUSAL_RULE",
      scope: "GLOBAL",
      severity: "HIGH"
    });
  });

  const eventsRaw = Array.isArray(input.eventStream.events) ? input.eventStream.events : [];
  eventsRaw.forEach((evt, idx) => {
    if (!isRecord(evt)) {
      return;
    }
    const summary = asString(evt.summary) ?? asString(evt.event_summary) ?? "";
    if (!summary) {
      return;
    }
    assertions.push({
      assertion_id: randomUUID(),
      entity_id: knownEntityId,
      attribute_key: `event_fact_${idx + 1}`,
      value: summary,
      chapter_index: input.chapterIndex,
      confidence_score: 0.65,
      evidence_count: 1,
      category: "FACT",
      scope: "LOCAL"
    });
  });

  return assertions;
}

function extractRuleList(root: Record<string, unknown>, path: [string, string]): string[] {
  const items = extractRuleItems(root, path);
  return items;
}

function extractRuleItems(root: Record<string, unknown>, path: [string, string]): string[] {
  const first = root[path[0]];
  if (!isRecord(first)) {
    return [];
  }
  const target = first[path[1]];
  if (!Array.isArray(target)) {
    return [];
  }

  return target
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (isRecord(item)) {
        return asString(item.rule) ?? asString(item.trigger) ?? JSON.stringify(item);
      }
      return null;
    })
    .filter((v): v is string => !!v);
}

function toEntityType(raw: string): EcsEntity["entity_type"] {
  const normalized = raw.toLowerCase();
  if (normalized.includes("character") || normalized.includes("npc") || normalized.includes("char")) {
    return "character";
  }
  if (normalized.includes("faction") || normalized.includes("sect") || normalized.includes("guild")) {
    return "faction";
  }
  if (normalized.includes("item") || normalized.includes("artifact") || normalized.includes("weapon")) {
    return "item";
  }
  if (normalized.includes("location") || normalized.includes("place")) {
    return "location";
  }
  if (normalized.includes("world")) {
    return "world";
  }
  return "other";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unknown map extraction error");
}

function hashChunkText(chunkText: string): string {
  const normalized = chunkText.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function getMapCacheMaxEntries(): number {
  const fromEnv = Number(process.env.MAP_CACHE_MAX_ENTRIES ?? DEFAULT_MAP_CACHE_MAX_ENTRIES);
  if (!Number.isFinite(fromEnv) || fromEnv < 1) {
    return DEFAULT_MAP_CACHE_MAX_ENTRIES;
  }
  return Math.floor(fromEnv);
}

function cacheEnabled(): boolean {
  return process.env.MAP_CACHE_ENABLED !== "false";
}

function getCachedGraph(chunkHash: string): EcsLocalGraph | null {
  if (!cacheEnabled()) {
    return null;
  }
  const cached = MAP_CACHE.get(chunkHash);
  if (!cached) {
    return null;
  }
  // Refresh insertion order for LRU behavior.
  MAP_CACHE.delete(chunkHash);
  MAP_CACHE.set(chunkHash, cached);
  return cloneGraph(cached);
}

function putCachedGraph(chunkHash: string, graph: EcsLocalGraph): void {
  if (!cacheEnabled()) {
    return;
  }
  // Do not cache minimal fallback graphs caused by transient provider failure.
  if (graph.metadata?.extraction_mode === "MINIMAL_FALLBACK") {
    return;
  }

  if (MAP_CACHE.has(chunkHash)) {
    MAP_CACHE.delete(chunkHash);
  }
  MAP_CACHE.set(chunkHash, cloneGraph(graph));

  const maxEntries = getMapCacheMaxEntries();
  while (MAP_CACHE.size > maxEntries) {
    const oldestKey = MAP_CACHE.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    MAP_CACHE.delete(oldestKey);
  }
}

function materializeCachedGraph(template: EcsLocalGraph, request: MapExtractRequest, chunkHash: string): EcsLocalGraph {
  const graph = cloneGraph(template);
  graph.chunk_id = request.chunk_id ?? `chunk_${request.chapter_index}`;
  graph.chapter_index = request.chapter_index;
  graph.assertions = graph.assertions.map((item) => ({
    ...item,
    chapter_index: request.chapter_index
  }));
  graph.metadata = {
    ...(graph.metadata ?? {}),
    timeline_weight: request.chapter_index
  };
  return attachCacheMetadata(graph, chunkHash, true);
}

function attachCacheMetadata(graph: EcsLocalGraph, chunkHash: string, cacheHit: boolean): EcsLocalGraph {
  return {
    ...graph,
    metadata: {
      ...(graph.metadata ?? {}),
      cache_hit: cacheHit,
      cache_key: chunkHash
    }
  };
}

function cloneGraph(graph: EcsLocalGraph): EcsLocalGraph {
  return JSON.parse(JSON.stringify(graph)) as EcsLocalGraph;
}
