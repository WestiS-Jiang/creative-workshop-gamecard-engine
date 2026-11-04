# Creative Workshop Architecture V2

## Locked Decisions

1. Conflict strategy priority is fixed:
   - Level 1: Chronological override with decay
   - Level 2: Evidence density voting
   - Level 3: CRA patch narrative
   - Level 4: Bifurcation
2. Density threshold ratio: `5:1`
3. JSON Schema `additionalProperties`: enabled for extensibility
4. Time step policy:
   - Default is LLM recommendation by genre
   - Creator can override with manual config

## Lifecycle State Machine

Global state contains `current_phase` and uses explicit lifecycle transitions:

- `INIT`
- `INTRO_CINEMATIC`
- `MAIN_LOOP`
- `ENDING_CINEMATIC`

Both backend and frontend treat phase as first-class state, preventing hard-coupling to text-only gameplay.

## Media Decoupling Contract

Root-level `media_assets` manifest stores future media resources:

- `bgm_tracks`
- `intro_cinematic`
- `ending_cinematic`
- `character_portraits`

This keeps audiovisual assets independent from narrative logic state and allows graceful future expansion.

## Play-and-Debug Frontend Pattern

Frontend root uses a phase strategy map:

- `INTRO_CINEMATIC` -> cinematic player component
- `MAIN_LOOP` -> split panel (left: narrative/actions, right: JSON debugger)

This architecture avoids if-else sprawl and keeps phase routing composable.

## Backend Turn Contract

Each turn must return:

1. Full state snapshot
2. `event_engine.narrative_log`
3. `event_engine.available_actions`
4. No auto-selection of action by model (agency isolation)

## API Manager Pattern (LLM Gateway)

All external LLM API calls are centralized in:

- `backend/src/services/llmService.ts`

Business modules do not call `fetch`/`axios` directly for model requests.
The gateway delegates to provider adapters:

- `OPENAI_COMPAT`: `services/llm/adapters/openaiCompatibleAdapter.ts`
- `GEMINI`: `services/llm/adapters/geminiAdapter.ts`

Model provider switch is done via config/env only:

- `LLM_PROVIDER`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TASK_MODELS` (task-level model override JSON)

## Next Integration Tasks

1. Add schema validation middleware (`Ajv`) for all turn responses
2. Implement chapter chunking and dual-stream Map extraction workers
3. Add GraphRAG-backed density scorer and conflict grouping
4. Connect frontend action dispatch to backend `/turn/execute`
5. Add snapshot rollback endpoint and undo stack persistence
