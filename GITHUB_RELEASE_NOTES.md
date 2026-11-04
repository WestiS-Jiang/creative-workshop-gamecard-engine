# GitHub Release Notes

## Suggested repository name

`creative-workshop-gamecard-engine`

## Included

- Long-form text chunking and Map extraction into local ECS graphs
- Rolling baseline context for cross-chunk consistency
- Reduce conflict arbitration and bifurcation markers
- RPG/game-state schema validation and Game Card generation routes
- LLM provider adapter and task-model configuration layer
- Frontend creator workflow with debugging visibility

## Demonstration scope

The recommended interview demo is the text-to-Game-Card pipeline. The turn-execution loop is retained as a development harness and is not required for the primary narrative. The unstable `spritesheet` registration path is not part of this release package.

## Intentionally excluded

- `node_modules/`, generated `dist/`, local `output/`, IDE metadata, and TypeScript build caches
- Real `backend/.env` and all provider credentials
