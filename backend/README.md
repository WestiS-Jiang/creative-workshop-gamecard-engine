# Backend API (Creative Workshop)

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Default server: `http://localhost:8787`

## Endpoints

### 1) `POST /api/map/extract`

Probe-based chunk extraction with baseline context injection.

Request:

```json
{
  "chunk_id": "optional-chunk-id",
  "chapter_index": 12,
  "chunk_text": "章节文本切片...",
  "baseline_context": "前置章节世界观圣经摘要"
}
```

Response (ECS local graph):

```json
{
  "ok": true,
  "ecs_local_graph": {
    "chunk_id": "uuid",
    "chapter_index": 12,
    "entities": [],
    "assertions": [],
    "implicit_rules": {
      "social_power_relations": [],
      "ability_costs": [],
      "causal_invariants": []
    }
  }
}
```

### 2) `POST /api/reduce/conflict`

Global merge + strict 4-level conflict arbitration.

Request:

```json
{
  "local_graphs": [
    {
      "chunk_id": "c1",
      "chapter_index": 1,
      "entities": [],
      "assertions": [],
      "implicit_rules": {
        "social_power_relations": [],
        "ability_costs": [],
        "causal_invariants": []
      }
    }
  ]
}
```

Arbitration order:

1. Density filtering (`>= 5:1`)
2. Temporal override (later chapter wins)
3. CRA patch (`llmService.generatePatchNarrative`)
4. Bifurcation marker (`requires_bifurcation`)

### 3) `POST /api/turn/execute`

Core turn loop for Play-and-Debug.

Request:

```json
{
  "game_instance_id": "g-001",
  "player_entity": {},
  "world_state": {
    "current_turn": 10,
    "current_phase": "MAIN_LOOP"
  },
  "action_id": "a_001"
}
```

Behavior:

- Validates mismatch against persisted state
- Accepts developer overrides from frontend ("God Mode")
- Calls LLM for turn narrative/actions
- Returns full updated game-state snapshot (schema-compliant)

## LLM Gateway Rule

All model calls must go through `src/services/llmService.ts`.
Provider IO lives only in `src/services/llm/adapters/*`.

