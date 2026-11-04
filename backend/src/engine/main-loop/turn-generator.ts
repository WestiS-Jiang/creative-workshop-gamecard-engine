import { createLlmService, type LlmService } from "../../services/llmService";

export interface TurnGenerateInput {
  stateSnapshot: unknown;
  actionId: string;
}

export class MainLoopTurnGenerator {
  constructor(private readonly llmService: LlmService = createLlmService()) {}

  async generate(input: TurnGenerateInput): Promise<Record<string, unknown>> {
    return this.llmService.generateMainLoopTurn({
      stateSnapshot: input.stateSnapshot,
      actionId: input.actionId
    });
  }
}

