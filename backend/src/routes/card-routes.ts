import { Router } from "express";
import type { EcsLocalGraph } from "../contracts/ecs";
import { createLlmService } from "../services/llmService";

const router = Router();
const llmService = createLlmService();
const MAX_PLAYABLE_ROLE_COUNT = 15;

router.post("/generate", async (req, res, next) => {
  try {
    const validation = validateGenerateCardBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const targetActCount = recommendActCount(validation.value.source_char_count, validation.value.local_graphs.length);
    const markdown = await llmService.generateGameCardMarkdown({
      globalStateTree: validation.value.global_state_tree,
      implicitRules: extractImplicitRules(validation.value.global_state_tree, validation.value.local_graphs),
      timelineActs: buildTimelineActs(validation.value.local_graphs, targetActCount),
      characterCandidates: extractCharacterCandidates(validation.value.global_state_tree),
      directivesMarkdown: validation.value.directives_markdown,
      targetActCount,
      maxPlayableRoles: MAX_PLAYABLE_ROLE_COUNT,
      sourceCharCount: validation.value.source_char_count,
      sourceFileName: validation.value.source_file_name
    });

    res.json({
      ok: true,
      markdown,
      metadata: {
        target_act_count: targetActCount,
        max_playable_roles: MAX_PLAYABLE_ROLE_COUNT
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/assistant", async (req, res, next) => {
  try {
    const validation = validateAssistantBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const answer = await llmService.askGameCardAssistant({
      referenceMarkdown: validation.value.reference_markdown,
      editableMarkdown: validation.value.editable_markdown,
      question: validation.value.question,
      history: validation.value.history,
      preset: validation.value.preset
    });

    res.json({
      ok: true,
      answer
    });
  } catch (error) {
    next(error);
  }
});

function validateGenerateCardBody(body: unknown):
  | {
      ok: true;
      value: {
        global_state_tree: Record<string, unknown>;
        local_graphs: EcsLocalGraph[];
        source_file_name?: string;
        source_char_count?: number;
        directives_markdown?: string;
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }

  if (!isRecord(body.global_state_tree)) {
    return { ok: false, error: "global_state_tree must be an object." };
  }

  const localGraphs = Array.isArray(body.local_graphs) ? (body.local_graphs as EcsLocalGraph[]) : [];
  const invalidGraph = localGraphs.find((item) => !item || typeof item !== "object" || typeof item.chapter_index !== "number");
  if (invalidGraph) {
    return { ok: false, error: "local_graphs contains invalid item." };
  }

  const sourceCharCount = Number(body.source_char_count);
  const normalizedSourceCharCount = Number.isFinite(sourceCharCount) && sourceCharCount > 0 ? Math.floor(sourceCharCount) : undefined;

  return {
    ok: true,
    value: {
      global_state_tree: body.global_state_tree as Record<string, unknown>,
      local_graphs: localGraphs,
      source_file_name: typeof body.source_file_name === "string" ? body.source_file_name : undefined,
      source_char_count: normalizedSourceCharCount,
      directives_markdown: typeof body.directives_markdown === "string" ? body.directives_markdown : undefined
    }
  };
}

function validateAssistantBody(body: unknown):
  | {
      ok: true;
      value: {
        reference_markdown: string;
        editable_markdown: string;
        question: string;
        history: Array<{ role: "user" | "assistant"; content: string }>;
        preset: "STRICT" | "CREATIVE";
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }

  const referenceMarkdown = typeof body.reference_markdown === "string" ? body.reference_markdown : "";
  const editableMarkdown = typeof body.editable_markdown === "string" ? body.editable_markdown : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const preset = String(body.preset ?? "STRICT").toUpperCase() === "CREATIVE" ? "CREATIVE" : "STRICT";

  if (!referenceMarkdown.trim() && !editableMarkdown.trim()) {
    return { ok: false, error: "At least one markdown input is required." };
  }
  if (!question) {
    return { ok: false, error: "question is required." };
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      role: (String(item.role ?? "").toLowerCase() === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(item.content ?? "").trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-20);

  return {
    ok: true,
    value: {
      reference_markdown: referenceMarkdown,
      editable_markdown: editableMarkdown,
      question,
      history,
      preset
    }
  };
}

function extractImplicitRules(globalStateTree: Record<string, unknown>, localGraphs: EcsLocalGraph[]): string[] {
  const fromLocal = localGraphs.flatMap((graph) => [
    ...graph.implicit_rules.social_power_relations,
    ...graph.implicit_rules.ability_costs,
    ...graph.implicit_rules.causal_invariants
  ]);

  const fromAssertions =
    Array.isArray(globalStateTree.assertions)
      ? globalStateTree.assertions
          .map((item) => (isRecord(item) ? item : null))
          .filter((item): item is Record<string, unknown> => !!item)
          .filter((item) => {
            const category = String(item.category ?? "");
            return category === "SOCIAL_POWER" || category === "ABILITY_COST" || category === "CAUSAL_RULE";
          })
          .map((item) => String(item.value ?? "").trim())
      : [];

  return Array.from(new Set([...fromLocal, ...fromAssertions].map((item) => item.trim()).filter(Boolean))).slice(0, 120);
}

function extractCharacterCandidates(globalStateTree: Record<string, unknown>): Array<{
  entity_id: string;
  name: string;
  biography?: string;
  appearance?: string;
}> {
  const candidates = new Map<string, { entity_id: string; name: string; biography?: string; appearance?: string }>();

  const pushCandidate = (candidate: { entity_id: string; name: string; biography?: string; appearance?: string }) => {
    if (!candidate.entity_id || !candidate.name) {
      return;
    }
    if (!candidates.has(candidate.entity_id)) {
      candidates.set(candidate.entity_id, candidate);
      return;
    }
    const prev = candidates.get(candidate.entity_id);
    if (!prev) {
      candidates.set(candidate.entity_id, candidate);
      return;
    }
    candidates.set(candidate.entity_id, {
      entity_id: prev.entity_id,
      name: prev.name || candidate.name,
      biography: prev.biography || candidate.biography,
      appearance: prev.appearance || candidate.appearance
    });
  };

  if (Array.isArray(globalStateTree.core_characters)) {
    globalStateTree.core_characters
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .forEach((item) => {
        pushCandidate({
          entity_id: String(item.entity_id ?? "").trim(),
          name: String(item.name ?? item.entity_id ?? "").trim(),
          biography: String(item.biography ?? "").trim() || undefined,
          appearance: String(item.appearance ?? "").trim() || undefined
        });
      });
  }

  if (isRecord(globalStateTree.entities)) {
    Object.entries(globalStateTree.entities).forEach(([entityId, value]) => {
      if (!isRecord(value)) {
        return;
      }
      const entityType = String(value.entity_type ?? "").toLowerCase();
      if (entityType !== "character") {
        return;
      }
      const components = isRecord(value.components) ? value.components : {};
      pushCandidate({
        entity_id: String(value.entity_id ?? entityId).trim(),
        name: String(value.display_name ?? value.name ?? entityId).trim(),
        biography:
          String(components.biography ?? components.origin_background ?? components.background ?? "").trim() || undefined,
        appearance: String(components.appearance ?? components.looks ?? "").trim() || undefined
      });
    });
  }

  return Array.from(candidates.values()).slice(0, 40);
}

function recommendActCount(sourceCharCount: number | undefined, chunkCount: number): number {
  const estimatedChars = sourceCharCount && sourceCharCount > 0 ? sourceCharCount : Math.max(1, chunkCount) * 2200;
  if (estimatedChars <= 120_000) {
    return 6;
  }
  if (estimatedChars <= 240_000) {
    return 8;
  }
  if (estimatedChars <= 360_000) {
    return 10;
  }
  if (estimatedChars <= 640_000) {
    return 12;
  }
  if (estimatedChars <= 900_000) {
    return 14;
  }
  return 16;
}

function buildTimelineActs(localGraphs: EcsLocalGraph[], targetActCount: number): Array<{ act: string; summary: string; chunk_ids: string[] }> {
  if (localGraphs.length === 0) {
    return [];
  }

  const ordered = [...localGraphs].sort((a, b) => a.chapter_index - b.chapter_index);
  const safeTarget = Math.max(1, Math.min(targetActCount, ordered.length));
  const groupSize = Math.max(1, Math.ceil(ordered.length / safeTarget));
  const acts: Array<{ act: string; summary: string; chunk_ids: string[] }> = [];

  for (let i = 0; i < ordered.length; i += groupSize) {
    const slice = ordered.slice(i, i + groupSize);
    const actNo = acts.length + 1;
    const summaries = slice
      .map((graph) => String(graph.metadata?.brief_summary ?? "").trim())
      .filter((text) => text.length > 0)
      .slice(0, 4);
    acts.push({
      act: `Act ${actNo}`,
      summary: summaries.join("；") || `从切片 ${slice[0].chapter_index} 到 ${slice[slice.length - 1].chapter_index} 的剧情推进`,
      chunk_ids: slice.map((graph) => graph.chunk_id)
    });
  }

  return acts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export default router;
