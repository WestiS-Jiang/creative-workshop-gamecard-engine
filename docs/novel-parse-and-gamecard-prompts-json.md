# 小说解析与游戏卡生成：系统提示词 + JSON 结构总表

> 目标：集中整理“用于解析小说（Map/Reduce）与生成游戏卡（Game Card）”的关键系统提示词、提示词模板、JSON 数据结构与接口契约。
> 适用代码基线：`.`

## 1. 相关源码位置

- 提示词与结构化 Schema：`./backend/src/services/llm/llm-spec-center.ts`
- LLM 调度入口：`./backend/src/services/llmService.ts`
- Map 解析归一化：`./backend/src/services/map-extract-service.ts`
- Pipeline（Map->Reduce->RPG）：`./backend/src/services/full-parse-pipeline-service.ts`
- Reduce 冲突仲裁：`./backend/src/services/reduce-conflict-service.ts`
- Game Card API：`./backend/src/routes/card-routes.ts`
- 前端 API 类型契约：`./frontend/src/services/apiManager.ts`

---

## 2. 系统提示词（System Prompts）

### 2.1 小说解析相关

#### `MAP_STRUCTURED_EXTRACTION_SYSTEM_PROMPT`
用途：主 Map 提取任务（证据优先、抑制幻觉）。

```text
你是一个极其严谨的“网文世界观逆向解析引擎（NLP Entity & Rule Extractor）”。
你必须以证据为唯一依据，严格避免幻觉和套路推演。
```

#### `MAP_EVENT_EXTRACTION_PROMPT`（legacy 兜底链路）
用途：章节事件、实体、势力信号提取。

#### `MAP_RULE_PROBING_PROMPT`（legacy 兜底链路）
用途：隐性规则探针（阶级/资源代价/因果铁律）。

#### `CORE_CHARACTER_SUMMARY_SYSTEM_PROMPT`
用途：核心角色 biography + appearance 结构化总结。

```text
你是一个严谨的角色设定整合器。
你将根据角色的零散属性，生成结构化的人设摘要。
输出必须是 JSON，不允许输出 markdown 或任何解释。
```

#### `RPG_STAT_DESIGN_SYSTEM_PROMPT`
用途：根据世界规则和角色，生成统一 RPG 基础属性与初始数值。

```text
你是一个专业的 RPG 游戏数值策划。
请根据该小说的世界观法则和核心人物特征，设计一套最符合该世界的 3-5 个基础属性，
并为提供的所有核心角色进行初始数值（0-100）的评估。必须保持所有角色的属性项全局统一。
你必须只输出 JSON，不允许输出 markdown。
```

### 2.2 游戏卡相关

#### `GAME_CARD_SYSTEM_PROMPT`
用途：生成商业级 Game Card（Markdown）。

```text
你是一位世界顶级的 RPG 游戏主策划。
你要基于底层世界观状态树，输出可直接交付创作者编辑的商业级《游戏设定白皮书》。
你必须只输出 Markdown 文本，不输出额外解释。
```

#### `GAME_CARD_ASSISTANT_SYSTEM_PROMPT`
用途：秘塔 AI，限制只回答 markdown 文档范围问题。

---

## 3. 关键用户提示词模板（Prompt Templates）

### 3.1 `generateMapExtractionPrompt(chunkId, baselineContext, chunkText)`
用途：Map 主任务用户提示词模板。

核心约束：
- 证据至上（要求 `source_quote`）
- 允许空规则（`implicit_rules` 可返回 `[]`）
- 置信度低于 0.6 舍弃
- 仅增量抽取，不重复基线常识

输出目标 JSON：
- `chunk_metadata`
- `entity_updates[]`
- `relational_edges[]`
- `implicit_rules[]`

### 3.2 `generateCharacterSummaryPrompt(...)`
用途：核心人物传记与外貌总结。

输出目标 JSON：
- `character_summaries.{entity_id}.biography`
- `character_summaries.{entity_id}.appearance`

### 3.3 `generateRpgStatDesignPrompt(...)`
用途：RPG 属性体系与角色初值生成。

输出目标 JSON：
- `global_attributes[]`
- `character_stats{}`

### 3.4 `generateGameCardPrompt(...)`
用途：Game Card 主文档生成（Markdown）。

关键约束：
- 必须包含 `## 0. 导演批注` 到 `## 7. 附录`
- Act 连号
- 按目标幕数组织（动态）
- 强制嵌套结构（关键事件下挂场景锁定 + 强制选项）
- 要出现 Faction Call 控制串（`{{$BGM...}}/{{$SFX...}}/{{$SET...}}`）

### 3.5 `buildGameCardRepairPrompt(...)`（llmService 内部）
用途：Game Card 结构校验失败后自动修复。

---

## 4. 结构化输出 Schema（LLM 侧）

> 这些 Schema 通过 `getStructuredOutputSchema(task)` 交给 LLM 适配器（Gemini 时为 `responseSchema`）。

### 4.1 `MAP_STRUCTURED_EXTRACT_SCHEMA`

```json
{
  "type": "object",
  "required": ["chunk_metadata", "entity_updates", "relational_edges", "implicit_rules"],
  "properties": {
    "chunk_metadata": {
      "type": "object",
      "required": ["chunk_id", "timeline_weight", "brief_summary"]
    },
    "entity_updates": {
      "type": "array"
    },
    "relational_edges": {
      "type": "array"
    },
    "implicit_rules": {
      "type": "array"
    }
  },
  "additionalProperties": true
}
```

### 4.2 `CORE_CHARACTER_SUMMARY_SCHEMA`

```json
{
  "type": "object",
  "required": ["character_summaries"],
  "properties": {
    "character_summaries": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["biography", "appearance"]
      }
    }
  }
}
```

### 4.3 `RPG_STAT_DESIGN_SCHEMA`

```json
{
  "type": "object",
  "required": ["global_attributes", "character_stats"],
  "properties": {
    "global_attributes": {
      "type": "array"
    },
    "character_stats": {
      "type": "object"
    }
  }
}
```

### 4.4 `MAIN_LOOP_TURN_SCHEMA`（补充）

```json
{
  "type": "object",
  "required": ["plot_text", "state_changes", "next_options"],
  "properties": {
    "plot_text": { "type": "string" },
    "state_changes": { "type": "array", "items": { "type": "string" } },
    "next_options": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
  }
}
```

---

## 5. 小说解析链路 JSON（API 契约）

### 5.1 `/api/map/extract`

请求：
```json
{
  "chunk_id": "novel-chunk-12",
  "chapter_index": 12,
  "chunk_text": "...",
  "baseline_context": "..."
}
```

响应：
```json
{
  "ok": true,
  "ecs_local_graph": {
    "chunk_id": "novel-chunk-12",
    "chapter_index": 12,
    "entities": [],
    "assertions": [],
    "implicit_rules": {
      "social_power_relations": [],
      "ability_costs": [],
      "causal_invariants": []
    },
    "metadata": {
      "extraction_mode": "RULE_PROBING_ENFORCED",
      "brief_summary": "...",
      "cache_hit": false
    }
  }
}
```

### 5.2 `/api/map/full-parse/jobs`

请求：
```json
{
  "chunks": ["...", "..."],
  "baseline_context": "可选",
  "chunk_id_prefix": "source-file",
  "start_chapter_index": 1
}
```

响应（202 Accepted）：
```json
{
  "ok": true,
  "job": {
    "job_id": "uuid",
    "status": "PENDING",
    "progress": {
      "stage": "MAP",
      "total_chunks": 199,
      "mapped_chunks": 0,
      "failed_chunks": 0,
      "current_chunk_index": null,
      "current_chapter_index": null,
      "percentage": 0
    }
  }
}
```

### 5.3 `/api/reduce/conflict`

请求：
```json
{
  "local_graphs": [
    {
      "chunk_id": "...",
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

响应：
```json
{
  "ok": true,
  "global_state_tree": {
    "entities": {},
    "assertions": [],
    "relation_index": {},
    "global_attributes": [],
    "character_stats": {},
    "core_characters": [],
    "custom_character_recommendation": {},
    "metadata": {
      "merged_graph_count": 199,
      "latest_chapter": 199
    }
  },
  "resolution_report": [],
  "requires_bifurcation": false,
  "bifurcation_reasons": [],
  "resolution_logs": []
}
```

---

## 6. 游戏卡生成链路 JSON（API 契约）

### 6.1 `/api/card/generate`

请求：
```json
{
  "global_state_tree": {
    "entities": {},
    "assertions": [],
    "relation_index": {},
    "metadata": { "merged_graph_count": 199, "latest_chapter": 199 }
  },
  "local_graphs": [],
  "source_file_name": "novel.txt",
  "source_char_count": 520000,
  "directives_markdown": "# 游戏卡导演批注语法 ..."
}
```

响应：
```json
{
  "ok": true,
  "markdown": "# 游戏设定白皮书...",
  "metadata": {
    "target_act_count": 12,
    "max_playable_roles": 15
  }
}
```

### 6.2 `/api/card/assistant`（补充）

请求：
```json
{
  "reference_markdown": "...",
  "editable_markdown": "...",
  "question": "...",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "preset": "STRICT"
}
```

响应：
```json
{
  "ok": true,
  "answer": "..."
}
```

---

## 7. ECS 数据结构（解析结果核心）

### 7.1 `EcsLocalGraph`

```json
{
  "chunk_id": "string",
  "chapter_index": 1,
  "entities": [
    {
      "entity_id": "string",
      "entity_type": "character|faction|item|location|world|other",
      "display_name": "string",
      "components": {}
    }
  ],
  "assertions": [
    {
      "assertion_id": "string",
      "entity_id": "string",
      "attribute_key": "string",
      "value": "string",
      "chapter_index": 1,
      "confidence_score": 0.8,
      "evidence_count": 1,
      "category": "FACT|SOCIAL_POWER|ABILITY_COST|CAUSAL_RULE",
      "scope": "LOCAL|GLOBAL",
      "excerpt": "可选"
    }
  ],
  "implicit_rules": {
    "social_power_relations": [],
    "ability_costs": [],
    "causal_invariants": []
  },
  "metadata": {}
}
```

### 7.2 `EcsGlobalStateTree`

```json
{
  "entities": {},
  "assertions": [],
  "relation_index": {},
  "global_attributes": [
    { "key": "string", "name": "string" }
  ],
  "character_stats": {
    "char_xxx": { "attr_key": 80 }
  },
  "core_characters": [
    { "entity_id": "char_xxx", "name": "角色名", "biography": "...", "appearance": "..." }
  ],
  "custom_character_recommendation": {
    "attr_key": 55
  },
  "metadata": {
    "merged_graph_count": 199,
    "latest_chapter": 199
  }
}
```

---

## 8. 运行参数（和提示词/结构化输出相关）

常见环境变量：
- `LLM_PROVIDER`：`GEMINI` 或 `OPENAI_COMPAT`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TASK_MODELS`（按任务覆写模型）
- `LLM_TIMEOUT_MS`
- `LLM_MAIN_LOOP_TIMEOUT_MS`
- `LLM_MAP_TIMEOUT_MS`
- `LLM_RETRY_MAX`
- `MAP_CACHE_ENABLED`
- `MAP_CACHE_MAX_ENTRIES`

---

## 9. 快速检索索引（你要改提示词时）

- 改系统提示词：`llm-spec-center.ts` 中各 `*_SYSTEM_PROMPT`
- 改用户模板：`llm-spec-center.ts` 中 `generate*Prompt`
- 改结构化 JSON Schema：`llm-spec-center.ts` 中 `*_SCHEMA`
- 改任务温度和超时：`llmService.ts` 的 `getTaskTemperature` / `getTaskTimeoutMs`
- 改 Game Card 结构修复规则：`llmService.ts` 的 `validateGameCardMarkdownStructure` + `buildGameCardRepairPrompt`

