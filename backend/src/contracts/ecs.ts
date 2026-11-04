export type AssertionCategory = "FACT" | "SOCIAL_POWER" | "ABILITY_COST" | "CAUSAL_RULE";
export type AssertionScope = "LOCAL" | "GLOBAL";
export type ConflictSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface EcsEntity {
  entity_id: string;
  entity_type: "character" | "faction" | "item" | "location" | "world" | "other";
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
  category: AssertionCategory;
  scope: AssertionScope;
  core_entity?: boolean;
  severity?: ConflictSeverity;
  excerpt?: string;
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

export interface ConflictResolutionReportItem {
  entity_id: string;
  attribute_key: string;
  status:
    | "NO_CONFLICT"
    | "DENSITY_FILTERED"
    | "TEMPORAL_OVERRIDE"
    | "CRA_PATCHED"
    | "BIFURCATED";
  selected_value?: string;
  discarded_values?: string[];
  patch_narrative?: string;
  reason?: string;
}

export interface EcsGlobalStateTree {
  entities: Record<string, EcsEntity>;
  assertions: EcsAssertion[];
  relation_index: Record<string, string[]>;
  global_attributes?: Array<{
    key: string;
    name: string;
  }>;
  character_stats?: Record<string, Record<string, number>>;
  core_characters?: Array<{
    entity_id: string;
    name: string;
    biography?: string;
    appearance?: string;
  }>;
  custom_character_recommendation?: Record<string, number>;
  metadata: {
    merged_graph_count: number;
    latest_chapter: number;
    [k: string]: unknown;
  };
}
