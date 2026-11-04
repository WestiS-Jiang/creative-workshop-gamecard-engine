import { Router } from "express";
import type { EcsLocalGraph } from "../contracts/ecs";
import { FullParsePipelineService } from "../services/full-parse-pipeline-service";
import { ReduceConflictService } from "../services/reduce-conflict-service";

const router = Router();
const service = new ReduceConflictService();
const fullParsePipelineService = new FullParsePipelineService();

router.post("/conflict", async (req, res, next) => {
  try {
    const validation = validateReduceBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const reduced = await service.reduce({
      local_graphs: validation.value.local_graphs
    });
    const enrichedTree = await fullParsePipelineService.enrichGlobalStateWithRpg(
      reduced.global_state_tree,
      validation.value.local_graphs
    );

    res.json({
      ok: true,
      ...reduced,
      global_state_tree: enrichedTree
    });
  } catch (error) {
    next(error);
  }
});

function validateReduceBody(body: unknown): { ok: true; value: { local_graphs: EcsLocalGraph[] } } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }
  if (!Array.isArray(body.local_graphs) || body.local_graphs.length === 0) {
    return { ok: false, error: "local_graphs must be a non-empty array." };
  }

  const localGraphs = body.local_graphs as EcsLocalGraph[];
  const invalidGraph = localGraphs.find((g) => !g || typeof g !== "object" || !Array.isArray(g.assertions));
  if (invalidGraph) {
    return { ok: false, error: "Each local graph must include assertions array." };
  }

  return {
    ok: true,
    value: {
      local_graphs: localGraphs
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export default router;
