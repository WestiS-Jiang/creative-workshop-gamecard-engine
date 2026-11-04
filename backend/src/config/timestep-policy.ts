import type { TimeStepConfig, TimeStepSource } from "../contracts/game-state";

export interface GenreSignal {
  genre: string;
  tags?: string[];
}

interface RecommendationResult {
  config: TimeStepConfig;
  source: TimeStepSource;
}

const GENRE_BASELINE: Record<string, Omit<TimeStepConfig, "source">> = {
  "病娇模拟": {
    unit: "week",
    value: 1,
    recommendation_reason: "病娇题材通常以周为节奏制造关系压力和资源紧张感。"
  },
  "都市恋爱": {
    unit: "day",
    value: 1,
    recommendation_reason: "日常互动和关系推进更适合日粒度。"
  },
  "东方玄幻": {
    unit: "day",
    value: 1,
    recommendation_reason: "修炼、探索、宗门事件通常以日粒度推进。"
  },
  "悬疑推理": {
    unit: "day",
    value: 1,
    recommendation_reason: "线索揭示节奏适配日粒度，便于回合追踪。"
  }
};

export function recommendTimeStep(signal: GenreSignal): RecommendationResult {
  const matched = GENRE_BASELINE[signal.genre];
  if (matched) {
    return {
      config: { ...matched, source: "LLM_RECOMMENDED" },
      source: "LLM_RECOMMENDED"
    };
  }

  return {
    config: {
      unit: "day",
      value: 1,
      source: "LLM_RECOMMENDED",
      recommendation_reason: "未命中题材模板，回退到日粒度默认节奏。"
    },
    source: "LLM_RECOMMENDED"
  };
}

export function resolveTimeStep(signal: GenreSignal, userOverride?: Partial<TimeStepConfig>): TimeStepConfig {
  const recommendation = recommendTimeStep(signal).config;
  if (!userOverride) {
    return recommendation;
  }

  return {
    unit: userOverride.unit ?? recommendation.unit,
    value: userOverride.value ?? recommendation.value,
    source: "USER_OVERRIDE",
    recommendation_reason: recommendation.recommendation_reason
  };
}
