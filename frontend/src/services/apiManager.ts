import type { FrontendGameState } from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const API_RETRY_MAX = Number(import.meta.env.VITE_API_RETRY_MAX ?? 2);

function buildUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetchWithRetry(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let json: ({ ok?: boolean; error?: string } & T) | null = null;

  if (raw) {
    try {
      json = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
    } catch {
      throw new Error(`API 返回了非 JSON 响应（HTTP ${response.status}）。`);
    }
  }

  if (!response.ok) {
    throw new Error((json?.error ?? raw) || `Request failed: ${response.status}`);
  }
  if (!json) {
    throw new Error(`API 响应为空（HTTP ${response.status}）。`);
  }
  if (json.ok === false) {
    throw new Error(json.error ?? `Request failed: ${response.status}`);
  }

  return json;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetchWithRetry(buildUrl(path), {
    method: "GET"
  });

  const raw = await response.text();
  let json: ({ ok?: boolean; error?: string } & T) | null = null;

  if (raw) {
    try {
      json = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
    } catch {
      throw new Error(`API 返回了非 JSON 响应（HTTP ${response.status}）。`);
    }
  }

  if (!response.ok) {
    throw new Error((json?.error ?? raw) || `Request failed: ${response.status}`);
  }
  if (!json) {
    throw new Error(`API 响应为空（HTTP ${response.status}）。`);
  }
  if (json.ok === false) {
    throw new Error(json.error ?? `Request failed: ${response.status}`);
  }

  return json;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const maxAttempts = Number.isFinite(API_RETRY_MAX) && API_RETRY_MAX > 0 ? Math.floor(API_RETRY_MAX) : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 && attempt < maxAttempts) {
        await delay(250 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientFetchError(error)) {
        throw error;
      }
      await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown network error");
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("aborted") ||
    message.includes("timeout")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type EcsEntityType = "character" | "faction" | "item" | "location" | "world" | "other";
export type EcsAssertionCategory = "FACT" | "SOCIAL_POWER" | "ABILITY_COST" | "CAUSAL_RULE";
export type EcsAssertionScope = "LOCAL" | "GLOBAL";

export interface EcsEntity {
  entity_id: string;
  entity_type: EcsEntityType;
  display_name: string;
  components: Record<string, unknown>;
}

export interface EcsAssertion {
  assertion_id: string;
  entity_id: string;
  attribute_key: string;
  value: string;
  chapter_index: number;
  confidence_score: number;
  evidence_count: number;
  category: EcsAssertionCategory;
  scope: EcsAssertionScope;
  core_entity?: boolean;
  severity?: string;
  excerpt?: string;
  [k: string]: unknown;
}

export interface EcsLocalGraph {
  chunk_id: string;
  chapter_index: number;
  entities: EcsEntity[];
  assertions: EcsAssertion[];
  implicit_rules: {
    social_power_relations: string[];
    ability_costs: string[];
    causal_invariants: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface MapExtractResponse {
  ok: true;
  ecs_local_graph: EcsLocalGraph;
}

export interface ReduceConflictResponse {
  ok: true;
  global_state_tree: {
    entities: Record<string, EcsEntity>;
    assertions: EcsAssertion[];
    relation_index: Record<string, string[]>;
    global_attributes?: Array<{ key: string; name: string }>;
    character_stats?: Record<string, Record<string, number>>;
    core_characters?: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
    custom_character_recommendation?: Record<string, number>;
    metadata: {
      merged_graph_count: number;
      latest_chapter: number;
      [k: string]: unknown;
    };
  };
  resolution_report: Array<{
    entity_id: string;
    attribute_key: string;
    status: "NO_CONFLICT" | "DENSITY_FILTERED" | "TEMPORAL_OVERRIDE" | "CRA_PATCHED" | "BIFURCATED";
    selected_value?: string;
    discarded_values?: string[];
    patch_narrative?: string;
    reason?: string;
  }>;
  requires_bifurcation: boolean;
  bifurcation_reasons: string[];
  resolution_logs?: Array<Record<string, unknown>>;
}

export interface TurnExecuteResponse {
  ok: true;
  game_state: FrontendGameState;
  integrity_report: {
    has_mismatch: boolean;
    diffs: string[];
    dev_override_accepted: true;
  };
}

export interface FullParsePipelineResponse {
  ok: true;
  local_graphs: EcsLocalGraph[];
  global_state_tree: ReduceConflictResponse["global_state_tree"];
  resolution_report: ReduceConflictResponse["resolution_report"];
  requires_bifurcation: boolean;
  bifurcation_reasons: string[];
  pipeline_report: {
    mapped_chunks: number;
    failed_chunks?: number;
    start_chapter_index: number;
    end_chapter_index: number;
    baseline_strategy: "ROLLING_SUMMARY";
  };
}

export interface FullParseJobProgress {
  stage: "MAP" | "REDUCE" | "PAUSED" | "DONE" | "FAILED";
  total_chunks: number;
  mapped_chunks: number;
  failed_chunks: number;
  current_chunk_index: number | null;
  current_chapter_index: number | null;
  percentage: number;
  message?: string;
}

export interface FullParseJob {
  job_id: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED";
  progress: FullParseJobProgress;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  result?: Omit<FullParsePipelineResponse, "ok">;
}

export interface FullParseJobCreateResponse {
  ok: true;
  job: FullParseJob;
}

export interface FullParseJobGetResponse {
  ok: true;
  job: FullParseJob;
}

export interface GameCardGenerateResponse {
  ok: true;
  markdown: string;
  metadata?: {
    target_act_count?: number;
    max_playable_roles?: number;
  };
}

export interface GameCardAssistantResponse {
  ok: true;
  answer: string;
}

export interface ApiManager {
  mapExtract(payload: {
    chunk_id?: string;
    chapter_index: number;
    chunk_text: string;
    baseline_context?: string;
  }): Promise<MapExtractResponse>;
  reduceConflict(payload: {
    local_graphs: EcsLocalGraph[];
  }): Promise<ReduceConflictResponse>;
  executeTurn(payload: {
    game_instance_id: string;
    player_entity: NonNullable<FrontendGameState["player_entity"]>;
    world_state: FrontendGameState["world_state"];
    action_id: string;
    genre?: string;
  }): Promise<TurnExecuteResponse>;
  fullParsePipeline(payload: {
    chunks: string[];
    baseline_context?: string;
    chunk_id_prefix?: string;
    start_chapter_index?: number;
  }): Promise<FullParsePipelineResponse>;
  createFullParseJob(payload: {
    chunks: string[];
    baseline_context?: string;
    chunk_id_prefix?: string;
    start_chapter_index?: number;
  }): Promise<FullParseJobCreateResponse>;
  getFullParseJob(jobId: string): Promise<FullParseJobGetResponse>;
  pauseFullParseJob(jobId: string): Promise<FullParseJobGetResponse>;
  resumeFullParseJob(jobId: string): Promise<FullParseJobGetResponse>;
  generateGameCard(payload: {
    global_state_tree: ReduceConflictResponse["global_state_tree"];
    local_graphs?: EcsLocalGraph[];
    source_file_name?: string;
    source_char_count?: number;
    directives_markdown?: string;
  }): Promise<GameCardGenerateResponse>;
  askGameCardAssistant(payload: {
    reference_markdown: string;
    editable_markdown: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    preset?: "STRICT" | "CREATIVE";
  }): Promise<GameCardAssistantResponse>;
}

export const apiManager: ApiManager = {
  mapExtract(payload) {
    return postJson<MapExtractResponse>("/api/map/extract", payload);
  },
  reduceConflict(payload) {
    return postJson<ReduceConflictResponse>("/api/reduce/conflict", payload);
  },
  executeTurn(payload) {
    return postJson<TurnExecuteResponse>("/api/turn/execute", payload);
  },
  fullParsePipeline(payload) {
    return postJson<FullParsePipelineResponse>("/api/map/full-parse", payload);
  },
  createFullParseJob(payload) {
    return postJson<FullParseJobCreateResponse>("/api/map/full-parse/jobs", payload);
  },
  getFullParseJob(jobId) {
    return getJson<FullParseJobGetResponse>(`/api/map/full-parse/jobs/${encodeURIComponent(jobId)}`);
  },
  pauseFullParseJob(jobId) {
    return postJson<FullParseJobGetResponse>(`/api/map/full-parse/jobs/${encodeURIComponent(jobId)}/pause`, {});
  },
  resumeFullParseJob(jobId) {
    return postJson<FullParseJobGetResponse>(`/api/map/full-parse/jobs/${encodeURIComponent(jobId)}/resume`, {});
  },
  generateGameCard(payload) {
    return postJson<GameCardGenerateResponse>("/api/card/generate", payload);
  },
  askGameCardAssistant(payload) {
    return postJson<GameCardAssistantResponse>("/api/card/assistant", payload);
  }
};
