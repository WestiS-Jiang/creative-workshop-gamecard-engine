import type { LlmTask } from "./types";

// =========================
// Prompt 中央配置
// =========================

// 用途：Map 阶段的事件提取提示词（章节事件、实体、势力信号）。
export const MAP_EVENT_EXTRACTION_PROMPT = `
你是事件图谱提取器。目标是从章节文本提取结构化事件，不要创作剧情。

输出 JSON，必须包含：
{
  "chapter_index": number,
  "entities": [{ "id": string, "name": string, "type": string }],
  "events": [{
    "event_id": string,
    "summary": string,
    "participants": string[],
    "world_impact": string
  }],
  "factions": [{ "faction_id": string, "name": string, "power_signal": string }]
}
`;

// 用途：Map 阶段的隐性规则探针提示词（阶级、代价、因果铁律）。
export const MAP_RULE_PROBING_PROMPT = `
你是深层法则分析师。任务不是总结剧情，而是从文本中推断世界底层法则与社会潜规则。

必须检查：
1. 权力与阶级投射：服从、恐惧、傲慢行为对应的阶级差异。
2. 超凡能力资源依赖：能力发动前提、消耗、环境限制。
3. 因果铁律抽象：识别“若发生A，必然导致B”规则。

输出 JSON，根节点必须为 Implicit_Rules：
{
  "Implicit_Rules": {
    "social_topology": [{
      "rule": string,
      "confidence": number,
      "evidence_excerpt": string
    }],
    "resource_constraints": [{
      "rule": string,
      "confidence": number,
      "evidence_excerpt": string
    }],
    "causal_invariants": [{
      "trigger": string,
      "effect": string,
      "confidence": number,
      "evidence_excerpt": string
    }]
  }
}
`;

// 用途：Turn 阶段的统一输出契约（必须 JSON）。
export const TURN_RENDER_PROMPT_CONTRACT = `
你必须只输出 JSON，不得输出 markdown 或解释文本。
`;

// 用途：Turn 阶段主循环提示词（根据模式切换 FOLLOW_CANON / SANDBOX）。
export function generateTurnPrompt(
  globalState: unknown,
  narrativeLog: string,
  playerAction: string,
  mode: "FOLLOW_CANON" | "SANDBOX"
): string {
  if (mode === "SANDBOX") {
    return `
你是一个极其冷酷、遵循绝对逻辑的 TRPG 地下城主（DM）和物理推演引擎。
你目前正在运行一个平行宇宙。请基于以下信息推演游戏发展：

【当前世界底层状态与法则】：
${JSON.stringify(globalState)}

【本局游戏历史剧情】：
${narrativeLog}

【玩家做出的最新行动】：
"${playerAction}"

【最高 DM 铁律 - 绝对防轨道化约束】
1. 原著已死，玩家至上：当前宇宙时间线已分叉，绝不允许强行贴回原著主线。
2. 绝对因果推演：行动逻辑成立就必须推演真实后果，禁止用巧合或打断回避后果。
3. 基于状态树响应：判定标准只依赖当前状态与法则，不依赖原著“应然剧情”。

【输出要求】
请输出纯 JSON，包含以下字段：
{
  "plot_text": "<150-300字剧情描述>",
  "state_changes": ["<状态变更表达式文本>"],
  "next_options": ["<3-4个后续选项，至少1个高风险高自由度>"]
}
`;
  }

  return `
你是一个严格遵循原著主线的叙事导演（Canon Director）。
你的任务是让玩家始终在剧情正轨上前进，同时保持合理的互动反馈。

【当前世界底层状态与法则】：
${JSON.stringify(globalState)}

【本局游戏历史剧情】：
${narrativeLog}

【玩家做出的最新行动】：
"${playerAction}"

【正轨约束】
1. 你必须优先维护原著关键事件顺序与角色核心命运，不允许主线崩塌。
2. 如果玩家行动偏离主线，你要给出“可解释的软纠偏结果”，而不是硬拒绝。
3. 仍需遵守世界法则与状态机约束，不能无因果重写事实。

【输出要求】
请输出纯 JSON，包含以下字段：
{
  "plot_text": "<150-300字剧情描述，体现回归主线>",
  "state_changes": ["<状态变更表达式文本>"],
  "next_options": ["<3-4个后续选项，至少2个能继续主线推进>"]
}
`;
}

// 用途：Map 结构化抽取的系统提示词（证据优先、抑制幻觉）。
export const MAP_STRUCTURED_EXTRACTION_SYSTEM_PROMPT = `
你是一个极其严谨的“网文世界观逆向解析引擎（NLP Entity & Rule Extractor）”。
你必须以证据为唯一依据，严格避免幻觉和套路推演。
`;

// 用途：Reduce 后 RPG 数值体系自动生成提示词。
export const RPG_STAT_DESIGN_SYSTEM_PROMPT = `
你是一个专业的 RPG 游戏数值策划。
请根据该小说的世界观法则和核心人物特征，设计一套最符合该世界的 3-5 个基础属性，
并为提供的所有核心角色进行初始数值（0-100）的评估。必须保持所有角色的属性项全局统一。
你必须只输出 JSON，不允许输出 markdown。
`;

// 用途：核心角色传记与外貌总结提示词。
export const CORE_CHARACTER_SUMMARY_SYSTEM_PROMPT = `
你是一个严谨的角色设定整合器。
你将根据角色的零散属性，生成结构化的人设摘要。
输出必须是 JSON，不允许输出 markdown 或任何解释。
`;

// 用途：根据小说内容动态推荐 4 套视觉风格预设。
export const VISUAL_STYLE_RECOMMEND_SYSTEM_PROMPT = `
你是“视觉总监 + 概念美术策划”。
请基于小说类型、文件名和剧情摘要，输出 4 套差异明显的视觉风格预设。
硬约束：
1) 必须输出 4 套，不能少不能多。
2) 每套必须包含 name/themeStyle/tone/palette/promptHint/originReason。
3) promptHint 必须是可直接用于文生图的中文提示词，不写空话。
4) 只输出 JSON，不要 markdown，不要解释。
`;

// 用途：游戏卡（GDD）生成提示词。
export const GAME_CARD_SYSTEM_PROMPT = `
你是一位世界顶级的 RPG 游戏主策划。
你要基于底层世界观状态树，输出可直接交付创作者编辑的商业级《游戏设定白皮书》。
你必须只输出 Markdown 文本，不输出额外解释。
`;

// 用途：秘塔AI 受限问答系统提示词（仅处理 Markdown 范围内问题）。
export const GAME_CARD_ASSISTANT_SYSTEM_PROMPT = `
你是“秘塔AI”，服务于创作者工坊中的游戏卡文档协作。
你必须遵守以下硬约束：
1) 只允许回答与输入 Markdown 文档内容、结构、格式、剧情编排相关的问题。
2) 严禁回答与文档无关的问题（代码、系统、密钥、平台内部实现、外部隐私信息）。
3) 一旦问题越界，直接输出："【越界拒答】该问题不在当前游戏卡文档范围内。"。
4) 不要寒暄，不要客套，不要自我介绍，直接给可执行结论。
5) 回答优先使用条列，聚焦可修改建议和具体文案。
`;

// 用途：RPG 数值策划调用的用户提示词。
export function generateRpgStatDesignPrompt(input: {
  implicitRules: string[];
  coreCharacters: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
}): string {
  return `
请基于以下输入生成 RPG 数值体系。

【世界观法则（implicit_rules）】
${JSON.stringify(input.implicitRules, null, 2)}

【核心角色列表】
${JSON.stringify(input.coreCharacters, null, 2)}

请输出严格 JSON：
{
  "global_attributes": [
    { "key": "spiritual_power", "name": "灵力" },
    { "key": "physique", "name": "根骨" }
  ],
  "character_stats": {
    "char_zhang_qiling": { "spiritual_power": 90, "physique": 95 },
    "char_wu_xie": { "spiritual_power": 20, "physique": 40 }
  }
}
`;
}

// 用途：核心人物 biography/appearance 结构化总结提示词。
export function generateCharacterSummaryPrompt(input: {
  characters: Array<{
    entity_id: string;
    name: string;
    known_biography?: string;
    known_appearance?: string;
    raw_profile: string;
  }>;
}): string {
  const requiredEntityIds = input.characters.map((item) => item.entity_id);
  return `
请根据每个角色提供的零散信息，生成两段核心设定：

1) biography（人设与经历）：50字以内，突出其性格、背景与战斗特长。
2) appearance（外貌特征）：50字以内，描述其五官、体型、服装特色或标志性武器外观。
3) 你必须覆盖输入中的每一个 entity_id，不允许遗漏。
4) character_summaries 不允许为空对象。

请严格输出 JSON：
{
  "character_summaries": {
    "char_xxx": {
      "biography": "......",
      "appearance": "......"
    }
  }
}

必须包含的 entity_id 列表：
${JSON.stringify(requiredEntityIds, null, 2)}

输入角色数据：
${JSON.stringify(input.characters, null, 2)}
`;
}

// 用途：生成动态视觉风格预设的用户提示词。
export function generateVisualStyleRecommendPrompt(input: {
  genre: string;
  sourceFileName?: string;
  sourceSummary: string;
}): string {
  return `
请根据以下输入，输出 4 套风格预设（严格 JSON）：

- genre: ${input.genre}
- source_file_name: ${input.sourceFileName ?? "unknown"}
- source_summary:
${input.sourceSummary}

输出结构：
{
  "presets": [
    {
      "name": "风格名称",
      "themeStyle": "english_style_id",
      "tone": "风格基调",
      "palette": "主色板",
      "promptHint": "可直接用于文生图的中文提示词（40-120字）",
      "originReason": "该风格为何适配此小说（1句话）"
    }
  ]
}
`;
}

// 用途：游戏卡 Markdown 生成用户提示词（含动态幕数、角色上限、连贯性约束）。
export function generateGameCardPrompt(input: {
  globalStateTree: unknown;
  implicitRules: string[];
  timelineActs: Array<{ act: string; summary: string; chunk_ids: string[] }>;
  characterCandidates?: Array<{ entity_id: string; name: string; biography?: string; appearance?: string }>;
  directivesMarkdown?: string;
  targetActCount?: number;
  maxPlayableRoles?: number;
  sourceCharCount?: number;
  sourceFileName?: string;
}): string {
  const targetActCount = Math.max(4, Math.min(20, Math.floor(input.targetActCount ?? 8)));
  const maxPlayableRoles = Math.max(4, Math.min(20, Math.floor(input.maxPlayableRoles ?? 15)));
  return `
你是一位世界顶级的 RPG 游戏主策划。请根据我提供的【底层世界观状态树 JSON】（包含隐性法则、核心角色、地点、时间线切片等），
为这款即将开发的游戏撰写一份极具商业级质感的《游戏设定白皮书 (Game Design Document)》。

请必须严格使用 Markdown 格式输出，并强制包含以下“0-7”模块（共 8 个）。

# 核心结构要求：

## 连贯性硬约束（必须严格遵守）
1. Act 编号必须从 1 开始连续递增，不允许跳号（例如不能出现 Act 1 后直接 Act 3）。
2. 每一幕都必须显式写出“承接上幕结果”和“推进下幕冲突”两条短句，保证剧情可追踪。
3. 不允许重置角色关系或世界法则，必须延续前幕状态并体现蝴蝶效应。

## 0. 导演批注（Director Notes）
- 使用 HTML 注释批注语法：\`<!--@指令 参数 -->\` 或 \`<!--@指令: 值 -->\`。
- 这一节用于写导演级默认控制（voice/tts/persona/art/dialogue/bgm/panels/image-model 等）。
- 这一节必须出现在文档最前部，标题固定：\`## 0. 导演批注\`。
- 禁止输出函数调用宏语法：\`<!...!>\`。

## 1. 核心规则与界面
- 核心规则：提取 \`implicit_rules\`，包装为 4-5 条玩家易懂机制。
- 游戏界面 (ASCII 艺术)：请使用代码块绘制极客风界面（顶部状态栏/中间场景/底部数字选项）。
- 行动类型表：\`| 行动类型 | 消耗 | 收益 | 风险 |\`
- 禁止事项：列出 3 条底层禁令。

## 2. 角色选择
- 表头：\`| 角色 | 身份 | 特点 | 难度 | 主线方向 |\`
- 必须包含【自定义角色】选项，并给出详细说明。
- 请优先从候选角色池中挑选“可玩角色”，上限 ${maxPlayableRoles} 个，不要求凑满。

## 3. 主要 NPC 与阵营
- 按正派/反派/中立分类，表头：\`| NPC | 身份 | 武功/能力 | 性格 | 登场幕 |\`

## 4. 地理分布与地点
- 地图 (ASCII 艺术)：使用线条符号绘制地点关系图。
- 地点详情表：\`| 地点 | 所属区域 | 剧情意义 | 可探索内容 |\`

## 5. 主线剧情 (按幕 Act 划分)
请按约 ${targetActCount} 幕组织主线（允许在 ±2 幕内动态调整，必须覆盖完整时间线）。
每一幕包含：
- 背景 (10%)
- 承接上幕结果 (简短句)
- 关键事件与玩家抉择 (50%, 3-5条编号。这是核心互动区，详见下方嵌套格式要求)
- 各角色线差异 (15%)
- 推进下幕冲突 (简短句)

🚨 **【关键事件与玩家抉择】必须严格采用以下嵌套格式（不要简化）：**
请为每一幕梳理 3-5 个关键事件。其中，**至少有 2 个最核心的事件**下方，必须同时挂载「场景锁定」与「玩家抉择点」模块！

1. [事件标题]
   > 🎬 **场景锁定 (Scene Override)**:
   > 该事件对应的关键场景正文（1-3句，必须极具画面感和戏剧张力）。
   > 
   > 🔘 **玩家抉择点 (Forced Choices)**:
   > - [选项A文本] (收益：... / 风险：...)
   > - [选项B文本] (收益：... / 风险：...)
   > - [选项C文本] (收益：... / 风险：...)

## 6. 结局分支推演
- 推演 4-5 个结局，每个含【触发条件】+【结局描述】。

## 7. 附录 (数据字典)
- 武功/技能/战技表（名称、类型、品阶、获取方式）
- 道具/装备/消耗品表（名称、类型、稀有度、效果）
- 势力/组织表（势力名、首领、立场、特色）

请保持语言风格冷峻、专业，充满硬核 RPG 与跑团 DM 气质。

补充输入（供你精准推演）：
- source_file_name: ${input.sourceFileName ?? "unknown"}
- source_char_count: ${Math.max(0, Math.floor(input.sourceCharCount ?? 0))}
- implicit_rules: ${JSON.stringify(input.implicitRules, null, 2)}
- timeline_acts: ${JSON.stringify(input.timelineActs, null, 2)}
- character_candidates: ${JSON.stringify(input.characterCandidates ?? [], null, 2)}
- director_directives_markdown: ${input.directivesMarkdown || "（未提供，按默认导演批注语法）"}
- global_state_tree: ${JSON.stringify(input.globalStateTree, null, 2)}
`;
}

// 用途：秘塔AI 用户提示词（参考稿 + 编辑稿 + 历史对话 + 当前问题）。
export function generateGameCardAssistantPrompt(input: {
  referenceMarkdown: string;
  editableMarkdown: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const historyText = (input.history ?? [])
    .slice(-10)
    .map((item, index) => `[${index + 1}] ${item.role}: ${item.content}`)
    .join("\n");

  return `
你将收到两份 Markdown：
1) 参考模板（只用于风格和结构参考）
2) 当前编辑稿（真实内容依据）

请仅在“文档范围内”回答用户问题，并输出精简、可执行建议。

【参考模板 Markdown】
${input.referenceMarkdown}

【当前编辑稿 Markdown】
${input.editableMarkdown}

【历史对话（最近）】
${historyText || "（无）"}

【当前提问】
${input.question}
`;
}

// 用途：Map 结构化提取用户提示词（chunk + baseline）。
export function generateMapExtractionPrompt(chunkId: number, baselineContext: string, chunkText: string): string {
  return `
你是一个极其严谨的“网文世界观逆向解析引擎（NLP Entity & Rule Extractor）”。
你的任务是阅读小说的【当前文本切片】，并在已知【全局世界观基线】的参考下，提取出结构化的实体状态变化、人物关系和隐性法则。

=========================================
【已知信息输入】
◆ 全局世界观基线（前置剧情摘要）：
${baselineContext || "（当前为第一章，暂无前置基线）"}

◆ 当前需要解析的文本切片（Chunk ID: ${chunkId}）：
${chunkText}
=========================================

【核心纪律 - 绝对防幻觉与克制推演】
1. 证据至上：所有提取的属性、关系和法则，必须在【当前文本切片】中有确凿的原文支撑，并在 \`source_quote\` 字段中引用原句。
2. 允许交白卷：如果当前切片仅仅是日常过渡、打斗动作或环境描写，没有涉及宏观的世界法则、权力阶级或超凡代价，你的 \`implicit_rules\` 数组必须严格返回 \`[]\`！绝不允许根据网文套路自行脑补。
3. 置信度评估：请客观评估你提取的信息的准确率，\`confidence\` 必须在 0.0 到 1.0 之间。低于 0.6 的模糊暗示请直接舍弃。
4. 增量更新：只提取“当前切片内发生改变或首次揭露”的信息，不要重复基线中已有的常识。

【输出格式要求】
你必须返回一个严格符合以下 TypeScript 接口的 JSON 对象，不要输出任何 Markdown 标记或额外解释文字：

{
  "chunk_metadata": {
    "chunk_id": ${chunkId},
    "timeline_weight": ${chunkId},
    "brief_summary": "<用一句话总结本切片推动的核心剧情>"
  },
  "entity_updates": [
    {
      "entity_id": "<英文ID, 如 char_wuxie>",
      "entity_type": "<character|item|faction>",
      "action_type": "<create|update>",
      "extracted_attributes": { "<键>": "<值，如 combat_power: 极高>" },
      "confidence": <0.0-1.0>,
      "source_quote": "<证明此属性的原话>"
    }
  ],
  "relational_edges": [
    {
      "source_entity": "<英文ID>",
      "target_entity": "<英文ID>",
      "relation_type": "<结盟|背叛|克制|暗恋等>",
      "confidence": <0.0-1.0>,
      "source_quote": "<原话支撑>"
    }
  ],
  "implicit_rules": [
    {
      "rule_category": "<combat_mechanics|social_hierarchy|magic_system>",
      "rule_description": "<如：麒麟血可以无视物理防御压制阴邪怪物>",
      "trigger_condition": "<如：encounter(undead)>",
      "confidence": <0.0-1.0>
    }
  ]
}
`;
}

// =========================
// JSON Schema 中央配置
// =========================

const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;

// 用途：Map 结构化抽取的强约束 JSON Schema。
export const MAP_STRUCTURED_EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    chunk_metadata: {
      type: "object",
      properties: {
        chunk_id: { type: "integer" },
        timeline_weight: { type: "integer" },
        brief_summary: stringSchema
      },
      required: ["chunk_id", "timeline_weight", "brief_summary"],
      additionalProperties: true
    },
    entity_updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity_id: stringSchema,
          entity_type: {
            type: "string",
            enum: ["character", "item", "faction", "location", "world", "other"]
          },
          action_type: {
            type: "string",
            enum: ["create", "update"]
          },
          extracted_attributes: {
            type: "object",
            additionalProperties: true
          },
          confidence: numberSchema,
          source_quote: stringSchema
        },
        required: ["entity_id", "entity_type", "action_type", "extracted_attributes", "confidence", "source_quote"],
        additionalProperties: true
      }
    },
    relational_edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_entity: stringSchema,
          target_entity: stringSchema,
          relation_type: stringSchema,
          confidence: numberSchema,
          source_quote: stringSchema
        },
        required: ["source_entity", "target_entity", "relation_type", "confidence", "source_quote"],
        additionalProperties: true
      }
    },
    implicit_rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule_category: {
            type: "string",
            enum: ["combat_mechanics", "social_hierarchy", "magic_system", "resource_constraints", "causal_law", "other"]
          },
          rule_description: stringSchema,
          trigger_condition: stringSchema,
          confidence: numberSchema
        },
        required: ["rule_category", "rule_description", "trigger_condition", "confidence"],
        additionalProperties: true
      }
    }
  },
  required: ["chunk_metadata", "entity_updates", "relational_edges", "implicit_rules"],
  additionalProperties: true
};

// 用途：Map 事件提取任务 Schema。
export const MAP_EVENT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    chapter_index: { type: "integer" },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: stringSchema,
          name: stringSchema,
          type: stringSchema
        },
        required: ["id", "name", "type"],
        additionalProperties: true
      }
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: stringSchema,
          summary: stringSchema,
          participants: { type: "array", items: stringSchema },
          world_impact: stringSchema
        },
        required: ["event_id", "summary", "participants", "world_impact"],
        additionalProperties: true
      }
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          faction_id: stringSchema,
          name: stringSchema,
          power_signal: stringSchema
        },
        required: ["faction_id", "name", "power_signal"],
        additionalProperties: true
      }
    }
  },
  required: ["chapter_index", "entities", "events", "factions"],
  additionalProperties: true
};

// 用途：隐性规则探针任务 Schema。
export const MAP_RULE_PROBING_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    Implicit_Rules: {
      type: "object",
      properties: {
        social_topology: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rule: stringSchema,
              confidence: numberSchema,
              evidence_excerpt: stringSchema
            },
            required: ["rule", "confidence", "evidence_excerpt"],
            additionalProperties: true
          }
        },
        resource_constraints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rule: stringSchema,
              confidence: numberSchema,
              evidence_excerpt: stringSchema
            },
            required: ["rule", "confidence", "evidence_excerpt"],
            additionalProperties: true
          }
        },
        causal_invariants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              trigger: stringSchema,
              effect: stringSchema,
              confidence: numberSchema,
              evidence_excerpt: stringSchema
            },
            required: ["trigger", "effect", "confidence", "evidence_excerpt"],
            additionalProperties: true
          }
        }
      },
      required: ["social_topology", "resource_constraints", "causal_invariants"],
      additionalProperties: true
    }
  },
  required: ["Implicit_Rules"],
  additionalProperties: true
};

// 用途：RPG 数值设计任务 Schema。
export const RPG_STAT_DESIGN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    global_attributes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: stringSchema,
          name: stringSchema
        },
        required: ["key", "name"],
        additionalProperties: true
      }
    },
    character_stats: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: numberSchema
      }
    }
  },
  required: ["global_attributes", "character_stats"],
  additionalProperties: true
};

// 用途：核心角色传记与外貌总结任务 Schema。
export const CORE_CHARACTER_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    character_summaries: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          biography: stringSchema,
          appearance: stringSchema
        },
        required: ["biography", "appearance"],
        additionalProperties: true
      }
    }
  },
  required: ["character_summaries"],
  additionalProperties: true
};

// 用途：动态风格预设任务 Schema。
export const VISUAL_STYLE_RECOMMEND_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    presets: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: stringSchema,
          themeStyle: stringSchema,
          tone: stringSchema,
          palette: stringSchema,
          promptHint: stringSchema,
          originReason: stringSchema
        },
        required: ["name", "themeStyle", "tone", "palette", "promptHint", "originReason"],
        additionalProperties: true
      }
    }
  },
  required: ["presets"],
  additionalProperties: true
};

// 用途：Turn 回合任务 Schema。
export const MAIN_LOOP_TURN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    plot_text: stringSchema,
    state_changes: {
      type: "array",
      items: stringSchema
    },
    next_options: {
      type: "array",
      items: stringSchema,
      minItems: 1
    }
  },
  required: ["plot_text", "state_changes", "next_options"],
  additionalProperties: true
};

// 用途：根据任务类型返回对应的结构化输出 Schema。
export function getStructuredOutputSchema(task: LlmTask): Record<string, unknown> | undefined {
  switch (task) {
    case "MAP_STRUCTURED_EXTRACT":
      return MAP_STRUCTURED_EXTRACT_SCHEMA;
    case "MAP_EVENT_EXTRACTION":
      return MAP_EVENT_EXTRACTION_SCHEMA;
    case "MAP_RULE_PROBING":
      return MAP_RULE_PROBING_SCHEMA;
    case "CORE_CHARACTER_SUMMARY":
      return CORE_CHARACTER_SUMMARY_SCHEMA;
    case "RPG_STAT_DESIGN":
      return RPG_STAT_DESIGN_SCHEMA;
    case "VISUAL_STYLE_RECOMMEND":
      return VISUAL_STYLE_RECOMMEND_SCHEMA;
    case "MAIN_LOOP_TURN":
      return MAIN_LOOP_TURN_SCHEMA;
    default:
      return undefined;
  }
}
