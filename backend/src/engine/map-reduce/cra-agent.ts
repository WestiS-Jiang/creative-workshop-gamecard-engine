import type { ConflictResolutionAgent, ConflictGroup } from "./types";
import { createLlmService, type LlmService } from "../../services/llmService";

export class LlmCraAgent implements ConflictResolutionAgent {
  constructor(private readonly llmService: LlmService) {}

  async generatePatchNarrative(group: ConflictGroup): Promise<string | null> {
    return this.llmService.generatePatchNarrative(group);
  }
}

export function createCraAgent(llmService: LlmService = createLlmService()): ConflictResolutionAgent {
  return new LlmCraAgent(llmService);
}
