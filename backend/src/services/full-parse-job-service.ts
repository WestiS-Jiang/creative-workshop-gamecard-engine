import { randomUUID } from "node:crypto";
import {
  FullParsePipelinePausedError,
  type FullParsePipelineCheckpoint,
  FullParsePipelineService,
  type FullParsePipelineProgress,
  type FullParsePipelineRequest,
  type FullParsePipelineResult
} from "./full-parse-pipeline-service";

type FullParseJobStatus = "PENDING" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED";

export interface FullParseJobSnapshot {
  job_id: string;
  status: FullParseJobStatus;
  progress: {
    stage: "MAP" | "REDUCE" | "PAUSED" | "DONE" | "FAILED";
    total_chunks: number;
    mapped_chunks: number;
    failed_chunks: number;
    current_chunk_index: number | null;
    current_chapter_index: number | null;
    percentage: number;
    message?: string;
  };
  created_at: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  result?: FullParsePipelineResult;
}

interface InternalJob {
  snapshot: FullParseJobSnapshot;
  request: FullParsePipelineRequest;
  checkpoint: FullParsePipelineCheckpoint | null;
  pause_requested: boolean;
  running: boolean;
}

const FINISHED_JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_JOB_CACHE_SIZE = 80;

export class FullParseJobService {
  private readonly jobs = new Map<string, InternalJob>();

  constructor(private readonly pipelineService = new FullParsePipelineService()) {}

  createJob(request: FullParsePipelineRequest): FullParseJobSnapshot {
    this.pruneIfNeeded();

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const snapshot: FullParseJobSnapshot = {
      job_id: jobId,
      status: "PENDING",
      progress: {
        stage: "MAP",
        total_chunks: request.chunks.length,
        mapped_chunks: 0,
        failed_chunks: 0,
        current_chunk_index: null,
        current_chapter_index: null,
        percentage: 0,
        message: "任务已创建，等待执行"
      },
      created_at: now
    };

    this.jobs.set(jobId, {
      snapshot,
      request,
      checkpoint: null,
      pause_requested: false,
      running: false
    });

    void this.runJob(jobId);
    return { ...snapshot };
  }

  getJob(jobId: string): FullParseJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return { ...job.snapshot };
  }

  pauseJob(jobId: string): FullParseJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    if (job.snapshot.status === "SUCCEEDED" || job.snapshot.status === "FAILED") {
      return { ...job.snapshot };
    }

    job.pause_requested = true;
    if (job.snapshot.status === "PENDING") {
      job.snapshot.status = "PAUSED";
      job.snapshot.progress = {
        ...job.snapshot.progress,
        stage: "PAUSED",
        message: "任务已暂停（尚未开始执行）"
      };
    } else {
      job.snapshot.progress = {
        ...job.snapshot.progress,
        message: "已收到暂停请求，当前切片完成后将暂停"
      };
    }

    return { ...job.snapshot };
  }

  resumeJob(jobId: string): FullParseJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    if (job.snapshot.status !== "PAUSED") {
      return { ...job.snapshot };
    }

    job.pause_requested = false;
    void this.runJob(jobId);
    return { ...job.snapshot };
  }

  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.running) {
      return;
    }
    job.running = true;

    job.snapshot.status = "RUNNING";
    if (!job.snapshot.started_at) {
      job.snapshot.started_at = new Date().toISOString();
    }
    job.snapshot.progress.message = job.checkpoint ? "恢复执行 Map 阶段" : "开始执行 Map 阶段";

    try {
      const result = await this.pipelineService.execute(job.request, {
        continue_on_chunk_error: false,
        checkpoint: job.checkpoint ?? undefined,
        shouldPause: () => job.pause_requested,
        onProgress: (progress) => {
          this.updateProgress(job, progress);
        }
      });

      job.snapshot.status = "SUCCEEDED";
      job.snapshot.finished_at = new Date().toISOString();
      job.snapshot.result = result;
      job.checkpoint = null;
      job.pause_requested = false;
      job.snapshot.progress = {
        ...job.snapshot.progress,
        stage: "DONE",
        mapped_chunks: result.pipeline_report.mapped_chunks,
        failed_chunks: result.pipeline_report.failed_chunks,
        percentage: 100,
        message: "全局解析完成"
      };
    } catch (error) {
      if (error instanceof FullParsePipelinePausedError) {
        job.checkpoint = error.checkpoint;
        job.snapshot.status = "PAUSED";
        job.snapshot.progress = {
          ...job.snapshot.progress,
          stage: "PAUSED",
          mapped_chunks: error.checkpoint.local_graphs.length,
          failed_chunks: error.checkpoint.failed_chunks,
          current_chunk_index: error.checkpoint.next_chunk_index,
          current_chapter_index: (job.request.start_chapter_index ?? 1) + error.checkpoint.next_chunk_index,
          percentage: clampPercentage(
            progressToPercentage(error.checkpoint.local_graphs.length, job.snapshot.progress.total_chunks)
          ),
          message: `已暂停，可从切片 ${error.checkpoint.next_chunk_index + 1} 继续`
        };
        return;
      }

      job.snapshot.status = "FAILED";
      job.snapshot.finished_at = new Date().toISOString();
      job.snapshot.error = error instanceof Error ? error.message : String(error);
      job.snapshot.progress = {
        ...job.snapshot.progress,
        stage: "FAILED",
        message: job.snapshot.error,
        percentage: clampPercentage(
          Math.max(job.snapshot.progress.percentage, progressToPercentage(job.snapshot.progress.mapped_chunks, job.snapshot.progress.total_chunks))
        )
      };
    } finally {
      job.running = false;
    }
  }

  private updateProgress(job: InternalJob, progress: FullParsePipelineProgress): void {
    const percentage =
      progress.stage === "REDUCE"
        ? 95
        : progress.stage === "DONE"
          ? 100
          : progressToPercentage(progress.mapped_chunks, progress.total_chunks);

    job.snapshot.progress = {
      stage: progress.stage,
      total_chunks: progress.total_chunks,
      mapped_chunks: progress.mapped_chunks,
      failed_chunks: progress.failed_chunks,
      current_chunk_index: progress.current_chunk_index,
      current_chapter_index: progress.current_chapter_index,
      percentage: clampPercentage(percentage),
      message: progress.message
    };
  }

  private pruneIfNeeded(): void {
    const now = Date.now();

    for (const [id, job] of this.jobs.entries()) {
      const finishedAt = job.snapshot.finished_at ? Date.parse(job.snapshot.finished_at) : null;
      if (!finishedAt) {
        continue;
      }
      if (now - finishedAt > FINISHED_JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }

    if (this.jobs.size <= MAX_JOB_CACHE_SIZE) {
      return;
    }

    const finishedJobs = [...this.jobs.entries()]
      .filter(([, job]) => !!job.snapshot.finished_at)
      .sort((a, b) => Date.parse(a[1].snapshot.finished_at as string) - Date.parse(b[1].snapshot.finished_at as string));

    while (this.jobs.size > MAX_JOB_CACHE_SIZE && finishedJobs.length > 0) {
      const oldest = finishedJobs.shift();
      if (!oldest) {
        break;
      }
      this.jobs.delete(oldest[0]);
    }
  }
}

function progressToPercentage(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round((done / total) * 100);
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
