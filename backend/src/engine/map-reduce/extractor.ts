import { createLlmService, type LlmService } from "../../services/llmService";

export interface MapExtractionInput {
  chapterIndex: number;
  chapterText: string;
  baselineContext?: string;
}

export interface MapExtractionOutput {
  event_stream: Record<string, unknown>;
  rule_stream: Record<string, unknown>;
}

export class MapDualStreamExtractor {
  constructor(private readonly llmService: LlmService = createLlmService()) {}

  async extract(input: MapExtractionInput): Promise<MapExtractionOutput> {
    const [eventStream, ruleStream] = await Promise.all([
      this.llmService.extractMapEvents({
        chapterIndex: input.chapterIndex,
        chapterText: input.chapterText,
        baselineContext: input.baselineContext
      }),
      this.llmService.extractImplicitRules({
        chapterIndex: input.chapterIndex,
        chapterText: input.chapterText,
        baselineContext: input.baselineContext
      })
    ]);

    return {
      event_stream: eventStream,
      rule_stream: ruleStream
    };
  }
}

