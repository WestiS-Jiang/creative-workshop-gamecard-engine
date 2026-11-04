import type {
  ConflictGroup,
  ConflictResolutionAgent,
  ConflictResolutionConfig,
  KnowledgeCandidate,
  ResolvedConflict
} from "./types";

const DEFAULT_CONFIG: ConflictResolutionConfig = {
  lambda: 0.05,
  chrono_decisive_margin: 0.15,
  density_threshold_ratio: 5
};

function chronologicalScore(candidate: KnowledgeCandidate, lambda: number): number {
  return candidate.confidence_score * Math.exp(lambda * candidate.chapter_index);
}

function sortByChronologicalOverride(candidates: KnowledgeCandidate[], lambda: number): KnowledgeCandidate[] {
  return [...candidates].sort((a, b) => chronologicalScore(b, lambda) - chronologicalScore(a, lambda));
}

function densityWinner(candidates: KnowledgeCandidate[], ratioThreshold: number): KnowledgeCandidate | null {
  const ranked = [...candidates].sort((a, b) => b.evidence_count - a.evidence_count);
  if (ranked.length < 2) {
    return ranked[0] ?? null;
  }

  const top = ranked[0];
  const second = ranked[1];
  const ratio = second.evidence_count === 0 ? Number.POSITIVE_INFINITY : top.evidence_count / second.evidence_count;
  return ratio >= ratioThreshold ? top : null;
}

function splitBranches(candidates: KnowledgeCandidate[]): [KnowledgeCandidate[], KnowledgeCandidate[]] {
  const sorted = [...candidates].sort((a, b) => a.chapter_index - b.chapter_index);
  const pivot = Math.ceil(sorted.length / 2);
  return [sorted.slice(0, pivot), sorted.slice(pivot)];
}

export async function resolveConflict(
  group: ConflictGroup,
  agent: ConflictResolutionAgent,
  config: Partial<ConflictResolutionConfig> = {}
): Promise<ResolvedConflict> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  if (group.candidates.length === 0) {
    return {
      resolution_type: "BIFURCATED",
      branch_a: [],
      branch_b: [],
      reason: "No candidates found for conflict group."
    };
  }

  // Level 1: evidence density voting
  const densityPick = densityWinner(group.candidates, mergedConfig.density_threshold_ratio);
  if (densityPick) {
    return {
      resolution_type: "DIRECT",
      canonical_value: densityPick.value,
      selected_candidate: densityPick,
      reason: "EVIDENCE_DENSITY"
    };
  }

  // Level 2: chronological override with decay
  const chronoSorted = sortByChronologicalOverride(group.candidates, mergedConfig.lambda);
  const top = chronoSorted[0];
  const second = chronoSorted[1];
  if (!top) {
    throw new Error("Unexpected empty conflict group after density stage.");
  }

  if (!second || chronologicalScore(top, mergedConfig.lambda) - chronologicalScore(second, mergedConfig.lambda) >= mergedConfig.chrono_decisive_margin) {
    return {
      resolution_type: "DIRECT",
      canonical_value: top.value,
      selected_candidate: top,
      reason: "CHRONOLOGICAL_OVERRIDE"
    };
  }

  // Level 3: conflict resolution agent (CRA)
  const patch = await agent.generatePatchNarrative(group);
  if (patch) {
    return {
      resolution_type: "PATCHED",
      canonical_value: top.value,
      patch_narrative: patch,
      merged_candidates: group.candidates
    };
  }

  // Level 4: MCTS-like bifurcation fallback
  const [branchA, branchB] = splitBranches(group.candidates);
  return {
    resolution_type: "BIFURCATED",
    branch_a: branchA,
    branch_b: branchB,
    reason: "Irreconcilable semantic conflict; world tree bifurcation activated."
  };
}
