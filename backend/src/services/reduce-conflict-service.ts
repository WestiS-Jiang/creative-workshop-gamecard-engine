import { randomUUID } from "node:crypto";
import type {
  ConflictResolutionReportItem,
  EcsAssertion,
  EcsEntity,
  EcsGlobalStateTree,
  EcsLocalGraph
} from "../contracts/ecs";
import type { ConflictGroup } from "../engine/map-reduce/types";
import { createLlmService, type LlmService } from "./llmService";

export interface ReduceConflictRequest {
  local_graphs: EcsLocalGraph[];
}

export interface ReduceConflictResult {
  global_state_tree: EcsGlobalStateTree;
  resolution_report: ConflictResolutionReportItem[];
  requires_bifurcation: boolean;
  bifurcation_reasons: string[];
  resolution_logs: Array<{
    entity_id: string;
    attribute_key: string;
    status: ConflictResolutionReportItem["status"];
    selected_value?: string;
    discarded_values?: string[];
    patch_narrative?: string;
    reason?: string;
    candidates: Array<{
      value: string;
      chapter_index: number;
      chunk_id: string;
      confidence_score: number;
      evidence_count: number;
    }>;
  }>;
}

const DENSITY_THRESHOLD_RATIO = 5;

export class ReduceConflictService {
  constructor(private readonly llmService: LlmService = createLlmService()) {}

  async reduce(input: ReduceConflictRequest): Promise<ReduceConflictResult> {
    const grouped = groupAssertions(input.local_graphs);
    const chapterChunkIndex = buildChapterChunkIndex(input.local_graphs);
    const entities = mergeEntities(input.local_graphs);
    const relation_index: Record<string, string[]> = {};
    const mergedAssertions: EcsAssertion[] = [];
    const report: ConflictResolutionReportItem[] = [];
    const resolutionLogs: ReduceConflictResult["resolution_logs"] = [];
    const bifurcationReasons: string[] = [];

    for (const group of grouped.values()) {
      const uniqueValues = [...new Set(group.candidates.map((c) => c.value))];
      if (uniqueValues.length <= 1) {
        const single = group.candidates[0];
        if (single) {
          mergedAssertions.push(single);
          report.push({
            entity_id: group.entity_id,
            attribute_key: group.attribute_key,
            status: "NO_CONFLICT",
            selected_value: single.value
          });
          pushRelation(relation_index, group.entity_id, group.attribute_key);
        }
        continue;
      }

      const candidatesForLog = group.candidates
        .map((candidate) => ({
          value: candidate.value,
          chapter_index: candidate.chapter_index,
          chunk_id: chapterChunkIndex.get(candidate.chapter_index) ?? `chunk_${candidate.chapter_index}`,
          confidence_score: candidate.confidence_score,
          evidence_count: candidate.evidence_count
        }))
        .sort((a, b) => a.chapter_index - b.chapter_index);

      // Level 1: temporal precedence (latest chapter has highest priority).
      const latestCandidates = pickLatestChapterCandidates(group.candidates);
      let selected = pickByTemporal(latestCandidates);
      let status: ConflictResolutionReportItem["status"] = "TEMPORAL_OVERRIDE";
      let patchNarrative: string | undefined;

      // Level 2: density filtering (5:1 hard threshold) among same-timeline contenders.
      const densityPick = pickByDensity(latestCandidates, DENSITY_THRESHOLD_RATIO);
      if (densityPick) {
        selected = densityPick.selected;
        status = "DENSITY_FILTERED";
      }

      // Level 3: CRA for core-entity hard conflicts
      const hardCoreConflict = isCoreHardConflict(latestCandidates);
      if (hardCoreConflict) {
        const patch = await this.llmService.generatePatchNarrative(toConflictGroup(latestCandidates));
        if (patch) {
          selected = {
            ...selected,
            assertion_id: randomUUID(),
            value: patch,
            category: "FACT",
            scope: "LOCAL"
          };
          status = "CRA_PATCHED";
          patchNarrative = patch;
        }
      }

      // Level 4: branch marker for severe macro collapse
      if (isSevereMacroCollapse(group.candidates)) {
        bifurcationReasons.push(`entity=${group.entity_id}, key=${group.attribute_key}`);
        const discarded = group.candidates.filter((c) => c.assertion_id !== selected.assertion_id).map((c) => c.value);
        report.push({
          entity_id: group.entity_id,
          attribute_key: group.attribute_key,
          status: "BIFURCATED",
          selected_value: selected.value,
          discarded_values: discarded,
          patch_narrative: patchNarrative,
          reason: "Detected severe global-rule contradiction."
        });
        resolutionLogs.push({
          entity_id: group.entity_id,
          attribute_key: group.attribute_key,
          status: "BIFURCATED",
          selected_value: selected.value,
          discarded_values: discarded,
          patch_narrative: patchNarrative,
          reason: "Detected severe global-rule contradiction.",
          candidates: candidatesForLog
        });
      } else {
        const discarded = group.candidates.filter((c) => c.assertion_id !== selected.assertion_id).map((c) => c.value);
        const reason =
          status === "TEMPORAL_OVERRIDE"
            ? "latest chapter precedence"
            : status === "DENSITY_FILTERED"
              ? `evidence ratio >= ${DENSITY_THRESHOLD_RATIO}:1 within latest chapter`
              : undefined;
        report.push({
          entity_id: group.entity_id,
          attribute_key: group.attribute_key,
          status,
          selected_value: selected.value,
          discarded_values: discarded,
          patch_narrative: patchNarrative,
          reason
        });
        resolutionLogs.push({
          entity_id: group.entity_id,
          attribute_key: group.attribute_key,
          status,
          selected_value: selected.value,
          discarded_values: discarded,
          patch_narrative: patchNarrative,
          reason,
          candidates: candidatesForLog
        });
      }

      mergedAssertions.push(selected);
      pushRelation(relation_index, group.entity_id, group.attribute_key);
    }

    return {
      global_state_tree: {
        entities,
        assertions: mergedAssertions,
        relation_index,
        metadata: {
          merged_graph_count: input.local_graphs.length,
          latest_chapter: maxChapter(input.local_graphs)
        }
      },
      resolution_report: report,
      requires_bifurcation: bifurcationReasons.length > 0,
      bifurcation_reasons: bifurcationReasons,
      resolution_logs: resolutionLogs
    };
  }
}

function buildChapterChunkIndex(localGraphs: EcsLocalGraph[]): Map<number, string> {
  const index = new Map<number, string>();
  localGraphs.forEach((graph) => {
    index.set(graph.chapter_index, graph.chunk_id || `chunk_${graph.chapter_index}`);
  });
  return index;
}

interface AssertionGroup {
  entity_id: string;
  attribute_key: string;
  candidates: EcsAssertion[];
}

function groupAssertions(localGraphs: EcsLocalGraph[]): Map<string, AssertionGroup> {
  const grouped = new Map<string, AssertionGroup>();

  for (const graph of localGraphs) {
    for (const assertion of graph.assertions) {
      const key = `${assertion.entity_id}::${assertion.attribute_key}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.candidates.push(assertion);
        continue;
      }
      grouped.set(key, {
        entity_id: assertion.entity_id,
        attribute_key: assertion.attribute_key,
        candidates: [assertion]
      });
    }
  }
  return grouped;
}

function mergeEntities(localGraphs: EcsLocalGraph[]): Record<string, EcsEntity> {
  const out: Record<string, EcsEntity> = {};
  for (const graph of localGraphs) {
    for (const entity of graph.entities) {
      out[entity.entity_id] = entity;
    }
  }
  if (!out.world) {
    out.world = {
      entity_id: "world",
      entity_type: "world",
      display_name: "世界",
      components: {}
    };
  }
  return out;
}

function pickByDensity(candidates: EcsAssertion[], thresholdRatio: number): {
  selected: EcsAssertion;
  discarded: EcsAssertion[];
} | null {
  const bucket = new Map<string, EcsAssertion[]>();
  for (const candidate of candidates) {
    const list = bucket.get(candidate.value) ?? [];
    list.push(candidate);
    bucket.set(candidate.value, list);
  }

  const ranked = [...bucket.entries()].map(([value, list]) => {
    const evidence = list.reduce((sum, item) => sum + item.evidence_count, 0);
    return { value, list, evidence };
  });
  ranked.sort((a, b) => b.evidence - a.evidence);
  if (ranked.length < 2) {
    return null;
  }

  const top = ranked[0];
  const second = ranked[1];
  const ratio = second.evidence === 0 ? Number.POSITIVE_INFINITY : top.evidence / second.evidence;
  if (ratio < thresholdRatio) {
    return null;
  }

  const selected = top.list.sort((a, b) => b.confidence_score - a.confidence_score)[0];
  const discarded = candidates.filter((c) => c.assertion_id !== selected.assertion_id);
  return { selected, discarded };
}

function pickLatestChapterCandidates(candidates: EcsAssertion[]): EcsAssertion[] {
  const latestChapter = Math.max(...candidates.map((item) => item.chapter_index));
  return candidates.filter((item) => item.chapter_index === latestChapter);
}

function pickByTemporal(candidates: EcsAssertion[]): EcsAssertion {
  return [...candidates].sort((a, b) => {
    if (b.chapter_index !== a.chapter_index) {
      return b.chapter_index - a.chapter_index;
    }
    if (b.confidence_score !== a.confidence_score) {
      return b.confidence_score - a.confidence_score;
    }
    return b.evidence_count - a.evidence_count;
  })[0];
}

function isCoreHardConflict(candidates: EcsAssertion[]): boolean {
  const hasCore = candidates.some((c) => c.core_entity);
  if (!hasCore) {
    return false;
  }

  const uniqueValues = new Set(candidates.map((c) => c.value));
  if (uniqueValues.size < 2) {
    return false;
  }

  const maxChapter = Math.max(...candidates.map((c) => c.chapter_index));
  const minChapter = Math.min(...candidates.map((c) => c.chapter_index));
  return maxChapter - minChapter <= 10;
}

function isSevereMacroCollapse(candidates: EcsAssertion[]): boolean {
  const hasGlobalRuleConflict = candidates.some(
    (c) => c.scope === "GLOBAL" && (c.category === "CAUSAL_RULE" || c.severity === "CRITICAL")
  );
  const uniqueValues = new Set(candidates.map((c) => c.value));
  return hasGlobalRuleConflict && uniqueValues.size >= 2;
}

function toConflictGroup(candidates: EcsAssertion[]): ConflictGroup {
  const first = candidates[0];
  return {
    entity_id: first?.entity_id ?? "unknown",
    attribute_key: first?.attribute_key ?? "unknown",
    candidates: candidates.map((c) => ({
      entity_id: c.entity_id,
      attribute_key: c.attribute_key,
      value: c.value,
      chapter_index: c.chapter_index,
      confidence_score: c.confidence_score,
      evidence_count: c.evidence_count,
      excerpt: c.excerpt
    }))
  };
}

function pushRelation(index: Record<string, string[]>, entityId: string, attributeKey: string): void {
  const current = index[entityId] ?? [];
  if (!current.includes(attributeKey)) {
    current.push(attributeKey);
  }
  index[entityId] = current;
}

function maxChapter(localGraphs: EcsLocalGraph[]): number {
  return localGraphs.reduce((max, g) => Math.max(max, g.chapter_index), 0);
}
