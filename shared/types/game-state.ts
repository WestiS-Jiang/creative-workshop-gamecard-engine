export type GamePhase = "INIT" | "INTRO_CINEMATIC" | "MAIN_LOOP" | "ENDING_CINEMATIC";

export type TimeStepSource = "LLM_RECOMMENDED" | "USER_OVERRIDE";

export interface TimeStepConfig {
  unit: "hour" | "day" | "week" | "month";
  value: number;
  source: TimeStepSource;
  recommendation_reason?: string;
}

export interface MediaAsset {
  asset_id: string;
  kind: "BGM" | "VIDEO" | "IMAGE" | "SPRITE";
  url: string;
  title?: string;
  loop?: boolean;
}

export interface GenreMetadata {
  genre: string;
  theme_style?: string;
  [k: string]: unknown;
}

export interface WorldState {
  current_turn: number;
  time_cycle: {
    season: string;
    weather: string;
    time_of_day: string;
    [k: string]: unknown;
  };
  global_factions: Array<{
    faction_id: string;
    name: string;
    power_level: number;
    attitude_to_player: number;
    [k: string]: unknown;
  }>;
  world_events: string[];
  [k: string]: unknown;
}

export interface AttributeValue {
  value: number;
  min: number;
  max: number;
  description: string;
}

export interface PlayerEntity {
  biography: {
    name: string;
    age: number;
    gender: string;
    origin_background: string;
    [k: string]: unknown;
  };
  core_attributes: Record<string, AttributeValue>;
  status_effects: Array<{
    effect_name: string;
    duration: number;
    impact_formula: string;
    [k: string]: unknown;
  }>;
  inventory_system: Array<{
    item_id: string;
    name: string;
    category: string;
    quantity: number;
    [k: string]: unknown;
  }>;
  equipped_gear: Record<string, string>;
  [k: string]: unknown;
}

export interface DynamicNpc {
  npc_id: string;
  name: string;
  social_role: string;
  affinity_matrix: Record<string, number>;
  relationship_tag: string;
  memory_flags: string[];
  [k: string]: unknown;
}

export interface EventEngine {
  narrative_log: string;
  observation_data: string;
  available_actions: Array<{
    action_id: string;
    prompt_text: string;
    required_stats: Record<string, number>;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface GameState {
  game_instance_id: string;
  genre_metadata: GenreMetadata;
  current_phase: GamePhase;
  time_step_config: TimeStepConfig;
  media_assets: {
    bgm_tracks: MediaAsset[];
    intro_cinematic: MediaAsset | null;
    ending_cinematic: MediaAsset | null;
    character_portraits: Record<string, MediaAsset>;
    [k: string]: unknown;
  };
  world_state: WorldState;
  player_entity: PlayerEntity;
  dynamic_npc_network: DynamicNpc[];
  event_engine: EventEngine;
  [k: string]: unknown;
}

