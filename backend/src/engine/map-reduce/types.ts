export interface KnowledgeCandidate {
  entity_id: string;
  attribute_key: string;
  value: string;
  chapter_index: number;
  confidence_score: number;
  evidence_count: number;
  excerpt?: string;
}

export interface ConflictGroup {
  entity_id: string;
  attribute_key: string;
  candidates: KnowledgeCandidate[];
}

export interface PatchedConflictResult {
  resolution_type: "PATCHED";
  canonical_value: string;
  patch_narrative: string;
  merged_candidates: KnowledgeCandidate[];
}

export interface BifurcationResult {
  resolution_type: "BIFURCATED";
  branch_a: KnowledgeCandidate[];
  branch_b: KnowledgeCandidate[];
  reason: string;
}

export type ResolvedConflict = PatchedConflictResult | BifurcationResult | {
  resolution_type: "DIRECT";
  canonical_value: string;
  selected_candidate: KnowledgeCandidate;
  reason: "CHRONOLOGICAL_OVERRIDE" | "EVIDENCE_DENSITY";
};

export interface ConflictResolutionConfig {
  lambda: number;
  chrono_decisive_margin: number;
  density_threshold_ratio: number;
}

export interface ConflictResolutionAgent {
  generatePatchNarrative(group: ConflictGroup): Promise<string | null>;
}

