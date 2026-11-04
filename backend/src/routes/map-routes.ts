import { Router } from "express";
import { FullParseJobService } from "../services/full-parse-job-service";
import { FullParsePipelineService } from "../services/full-parse-pipeline-service";
import { MapExtractService } from "../services/map-extract-service";

const router = Router();
const service = new MapExtractService();
const pipelineService = new FullParsePipelineService();
const fullParseJobService = new FullParseJobService(pipelineService);
const DEFAULT_MAX_FULL_PARSE_CHUNKS = 1200;

router.post("/extract", async (req, res, next) => {
  try {
    const validation = validateMapExtractBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const ecsLocalGraph = await service.extract(validation.value);
    res.json({
      ok: true,
      ecs_local_graph: ecsLocalGraph
    });
  } catch (error) {
    next(error);
  }
});

router.post("/full-parse", async (req, res, next) => {
  try {
    const validation = validateFullParseBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const parsed = await pipelineService.execute(validation.value, {
      continue_on_chunk_error: true
    });

    res.json({
      ok: true,
      ...parsed
    });
  } catch (error) {
    next(error);
  }
});

router.post("/full-parse/jobs", async (req, res, next) => {
  try {
    const validation = validateFullParseBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const job = fullParseJobService.createJob(validation.value);
    res.status(202).json({
      ok: true,
      job
    });
  } catch (error) {
    next(error);
  }
});

router.get("/full-parse/jobs/:jobId", (req, res) => {
  const job = fullParseJobService.getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: "Full parse job not found."
    });
    return;
  }

  res.json({
    ok: true,
    job
  });
});

router.post("/full-parse/jobs/:jobId/pause", (req, res) => {
  const job = fullParseJobService.pauseJob(req.params.jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: "Full parse job not found."
    });
    return;
  }

  res.json({
    ok: true,
    job
  });
});

router.post("/full-parse/jobs/:jobId/resume", (req, res) => {
  const job = fullParseJobService.resumeJob(req.params.jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: "Full parse job not found."
    });
    return;
  }

  res.json({
    ok: true,
    job
  });
});

function validateMapExtractBody(body: unknown):
  | { ok: true; value: { chunk_id?: string; chapter_index: number; chunk_text: string; baseline_context?: string } }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }

  const chapterIndex = body.chapter_index;
  const chunkText = body.chunk_text;
  if (typeof chapterIndex !== "number" || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
    return { ok: false, error: "chapter_index must be a non-negative integer." };
  }
  if (typeof chunkText !== "string" || chunkText.trim().length === 0) {
    return { ok: false, error: "chunk_text must be a non-empty string." };
  }

  return {
    ok: true,
    value: {
      chunk_id: typeof body.chunk_id === "string" ? body.chunk_id : undefined,
      chapter_index: chapterIndex,
      chunk_text: chunkText,
      baseline_context: typeof body.baseline_context === "string" ? body.baseline_context : undefined
    }
  };
}

function validateFullParseBody(body: unknown):
  | {
      ok: true;
      value: {
        chunks: string[];
        baseline_context?: string;
        chunk_id_prefix?: string;
        start_chapter_index?: number;
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }
  if (!Array.isArray(body.chunks) || body.chunks.length === 0) {
    return { ok: false, error: "chunks must be a non-empty string array." };
  }

  if (body.chunks.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    return { ok: false, error: "Each chunk must be a non-empty string." };
  }

  const maxChunks = getMaxFullParseChunks();
  if (body.chunks.length > maxChunks) {
    return { ok: false, error: `chunks length is too large (max ${maxChunks}).` };
  }

  const startChapterIndex =
    typeof body.start_chapter_index === "number" && Number.isInteger(body.start_chapter_index) && body.start_chapter_index > 0
      ? body.start_chapter_index
      : undefined;

  return {
    ok: true,
    value: {
      chunks: body.chunks as string[],
      baseline_context: typeof body.baseline_context === "string" ? body.baseline_context : undefined,
      chunk_id_prefix: typeof body.chunk_id_prefix === "string" ? body.chunk_id_prefix : undefined,
      start_chapter_index: startChapterIndex
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getMaxFullParseChunks(): number {
  const raw = Number(process.env.MAX_FULL_PARSE_CHUNKS ?? DEFAULT_MAX_FULL_PARSE_CHUNKS);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_MAX_FULL_PARSE_CHUNKS;
  }
  return Math.floor(raw);
}

export default router;
