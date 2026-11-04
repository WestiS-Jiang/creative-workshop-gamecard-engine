# Universal Text-RPG Engine - Creative Workshop

This repository contains a full-stack starter architecture for the "Universal Text-RPG Engine - Creative Workshop".

## Project Structure

- `shared/`: canonical game state contract (`JSON Schema` + TypeScript types)
- `backend/`: Map-Reduce extraction and Reduce conflict-arbitration engine skeleton
- `frontend/`: phase-driven React UI shell with Play-and-Debug split layout
- `docs/`: architecture and lifecycle decisions
- `backend/src/services/llmService.ts`: centralized LLM API manager gateway (single entry for provider calls)
- `backend/.env.example`: provider/model switching config template

## Interview-focused scope

The primary demonstrable flow is long-form text processing and Game Card generation:

```text
long-form text -> chunking -> Map local ECS extraction -> rolling baseline
-> Reduce conflict arbitration -> RPG design -> Game Card Markdown/JSON
```

The turn-execution loop is retained as a developer test harness, but is not required to understand or demonstrate the main pipeline. Local output files, provider credentials, and generated build artifacts are intentionally excluded from this release package.

## Key Guarantees Implemented

- Discrete-Time State Machine with `current_phase` lifecycle states
- Root-level `media_assets` manifest for future BGM/CG/video/portrait extension
- Creator-facing Play-and-Debug dual panel baseline
- Reduce conflict matrix pipeline (Chronological -> Density -> CRA -> Bifurcation)
- No direct LLM HTTP calls in UI/business modules; provider IO is isolated in `services/llm/adapters/*`
