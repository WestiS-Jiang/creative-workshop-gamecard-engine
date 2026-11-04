import React from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  Download,
  FileUp,
  GitMerge,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  Music2,
  PanelLeft,
  Play,
  RefreshCcw,
  RotateCcw,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  X,
  Video,
  Wand2
} from "lucide-react";
import {
  apiManager,
  type EcsLocalGraph,
  type FullParseJob,
  type FullParsePipelineResponse,
  type ReduceConflictResponse,
  type TurnExecuteResponse
} from "./services/apiManager";
import {
  runVoiceClonePreview,
  type VoiceCloneGatewayConfig
} from "./services/voiceCloneService";
import { visualGenService } from "./services/visualGenService";
import type { FrontendGameState, MediaAsset } from "./types";
import { parseNovelFile, splitTextToChunks } from "./utils/novelParser";

interface TimeStepConfig {
  unit: "hour" | "day" | "week" | "month";
  value: number;
  source: "LLM_RECOMMENDED" | "USER_OVERRIDE";
  recommendation_reason?: string;
  [k: string]: unknown;
}

interface DraftWizardAnswers {
  world_rule: string;
  power_cost: string;
  faction_tension: string;
}

interface CharacterOption {
  entity_id: string;
  name: string;
  biography?: string;
  appearance?: string;
}

interface GameCardEventNode {
  id: string;
  title: string;
  keyScenes: string[];
  choices: Array<{
    id: string;
    label: string;
    rawText: string;
    conditions: string[];
  }>;
  directives: FactionCallEffect[];
}

interface GameCardActNode {
  id: string;
  title: string;
  events: GameCardEventNode[];
  keyScenes: string[];
  index: number;
}

interface MitaMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
}

interface MaterialAssetItem {
  id: string;
  name: string;
  kind: "BGM" | "SFX" | "VOICE" | "IMAGE" | "VIDEO" | "CG";
  mime: string;
  size: number;
  url: string;
  uploadedAt: number;
}

interface ProcessedNovelHistoryItem {
  id: string;
  fileName: string;
  chunkCount: number;
  charCount: number;
  processedAt: number;
}

interface FactionCallEffect {
  kind: "BGM" | "SFX" | "SET";
  value: string;
}

interface FactionCallRule {
  effects: FactionCallEffect[];
  conditions: string[];
}

interface VisualStylePreset {
  id: string;
  name: string;
  themeStyle: string;
  tone: string;
  palette: string;
  promptHint: string;
  source?: "STATIC" | "NOVEL_ANALYZED";
  originReason?: string;
}

interface VisualPreviewItemState {
  status: "idle" | "loading" | "ready" | "error";
  imageUrl?: string;
  prompt?: string;
  error?: string;
}

interface CharacterVoiceDraft {
  mode: "UPLOAD_CLONE" | "AI_RANDOM";
  material_id: string;
  prompt: string;
}

type WorkflowStep = 1 | 2 | 3 | 4;

interface WorkflowGateState {
  step1Ready: boolean;
  step2Ready: boolean;
  step3Ready: boolean;
  step4Ready: boolean;
  canFreeNavigate: boolean;
}

const CUSTOM_CHARACTER_OPTION = "__custom_new_character__";
const PROCESSED_NOVEL_HISTORY_STORAGE_KEY = "utre_processed_novel_history_v1";
const DEFAULT_VOICE_PROMPT = "冷静低沉，节奏稳，句尾略有压迫感。";
const GAME_CARD_LOADING_TIPS = [
  "正在编织剧情主线，请稍候...",
  "正在校准角色关系与世界法则...",
  "正在收束关键事件与场景锚点...",
  "正在润色游戏卡文本质感..."
];

const INITIAL_TIME_STEP: TimeStepConfig = {
  unit: "day",
  value: 1,
  source: "LLM_RECOMMENDED",
  recommendation_reason: "默认日步长适合叙事推进"
};

const INITIAL_STATE: FrontendGameState = {
  game_instance_id: "demo-instance",
  current_phase: "MAIN_LOOP",
  genre_metadata: {
    genre: "东方玄幻",
    theme_style: "dark_workshop"
  },
  time_step_config: INITIAL_TIME_STEP,
  media_assets: {
    bgm_tracks: [],
    intro_cinematic: null,
    ending_cinematic: null,
    character_portraits: {}
  },
  world_state: {
    current_turn: 0,
    current_phase: "MAIN_LOOP",
    mcts_branch_id: "main",
    time_label: "夜晚",
    time_cycle: {
      season: "spring",
      weather: "clear",
      time_of_day: "night"
    },
    world_events: ["系统已进入创作工坊模式。"],
    global_factions: []
  },
  player_entity: {
    biography: {
      name: "玩家",
      age: 18,
      gender: "未知",
      origin_background: "待从小说中提取",
      appearance: ""
    },
    core_attributes: {
      stamina: { value: 60, min: 0, max: 100, description: "体力" },
      combat: { value: 50, min: 0, max: 100, description: "格斗" },
      intelligence: { value: 55, min: 0, max: 100, description: "智谋" }
    },
    status_effects: [],
    inventory_system: [],
    equipped_gear: {}
  },
  dynamic_npc_network: [],
  event_engine: {
    narrative_log: "欢迎进入万能文游引擎。上传你的小说后，系统会自动提取设定并可直接推演剧情。",
    observation_data: "",
    narrative_feed: [
      {
        id: "boot-1",
        turn: 0,
        role: "system",
        content: "系统：请先上传 TXT/EPUB 小说，然后点击“智能解析”。"
      }
    ],
    available_actions: [
      {
        action_id: "wait",
        prompt_text: "继续观察",
        required_stats: {}
      }
    ]
  }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function inferGenreKey(rawGenre: string, fileName: string): "xianxia" | "mystery" | "sci_fi" | "modern" {
  const text = `${rawGenre} ${fileName}`.toLowerCase();
  if (/(修仙|仙侠|玄幻|xian|fantasy|immortal)/i.test(text)) {
    return "xianxia";
  }
  if (/(悬疑|推理|惊悚|mystery|detective|noir)/i.test(text)) {
    return "mystery";
  }
  if (/(科幻|赛博|机甲|sci|cyber|future)/i.test(text)) {
    return "sci_fi";
  }
  return "modern";
}

function extractNovelStyleSignals(contextText: string): string[] {
  const rules: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(古墓|遗迹|陵寝|秘境|洞窟|墓门)/i, label: "遗迹探险" },
    { pattern: /(宗门|门派|家族|朝堂|皇权|宫廷)/i, label: "权力博弈" },
    { pattern: /(雨夜|追凶|命案|证据|审讯|嫌疑)/i, label: "暗线追凶" },
    { pattern: /(机甲|星舰|太空|实验体|义体|终端)/i, label: "科技异变" },
    { pattern: /(废土|荒城|崩坏|灾厄|末日|辐射)/i, label: "末世残响" },
    { pattern: /(校园|社团|同学|日常|城市|街角)/i, label: "都市日常" },
    { pattern: /(复仇|背叛|阴谋|失忆|假死|真相)/i, label: "命运反转" },
    { pattern: /(妖|鬼|灵|诡|禁术|祭祀|邪祟)/i, label: "诡异秘术" },
    { pattern: /(江湖|刀|剑|武|掌|内力|轻功)/i, label: "武侠争锋" },
    { pattern: /(海|港|舰|航线|孤岛|深渊)/i, label: "海域迷航" }
  ];
  const hits = rules.filter((rule) => rule.pattern.test(contextText)).map((rule) => rule.label);
  return unique(hits).slice(0, 4);
}

function buildVisualStylePresets(rawGenre: string, fileName: string, contextText = ""): VisualStylePreset[] {
  const genreKey = inferGenreKey(rawGenre, fileName);
  const base: Record<string, Array<Omit<VisualStylePreset, "id">>> = {
    xianxia: [
      { name: "墨金仙侠", themeStyle: "ink_gilded_xianxia", tone: "冷峻史诗", palette: "墨黑 / 鎏金 / 雾青", promptHint: "云海、古殿、兵器寒光、低饱和电影质感" },
      { name: "山海奇谭", themeStyle: "mythic_shanhai", tone: "奇诡瑰丽", palette: "黛青 / 朱砂 / 月白", promptHint: "异兽、古阵、地脉发光、卷轴光效" },
      { name: "宗门写实", themeStyle: "sect_realism", tone: "克制写实", palette: "灰蓝 / 岩褐 / 铁银", promptHint: "石阶、雨雾、伤痕、实拍镜头语言" },
      { name: "夜行秘境", themeStyle: "night_relic", tone: "黑暗冒险", palette: "深青 / 紫黑 / 冷白", promptHint: "洞窟、遗迹、火把、高反差阴影" }
    ],
    mystery: [
      { name: "冷光推理", themeStyle: "cold_detective", tone: "理性压迫", palette: "枪灰 / 冷蓝 / 苍白", promptHint: "雨夜街景、逆光人影、法证细节特写" },
      { name: "胶片悬疑", themeStyle: "film_noir", tone: "复古阴郁", palette: "煤黑 / 暗红 / 旧银", promptHint: "胶片颗粒、霓虹反射、高对比剪影" },
      { name: "病院惊悚", themeStyle: "asylum_thriller", tone: "心理惊悚", palette: "灰绿 / 冷白 / 锈红", promptHint: "走廊透视、监控视角、不稳定光源" },
      { name: "法庭攻防", themeStyle: "courtroom_tension", tone: "高压博弈", palette: "深棕 / 木炭 / 米白", promptHint: "法庭空间、证据板、人物表情近景" }
    ],
    sci_fi: [
      { name: "硬核机能", themeStyle: "hard_scifi", tone: "工业冷硬", palette: "钢蓝 / 霓白 / 碳黑", promptHint: "机械纹理、HUD、硬边光影、真实材质" },
      { name: "霓虹边界", themeStyle: "neon_frontier", tone: "高速危险", palette: "电蓝 / 荧红 / 暗夜", promptHint: "高楼雨幕、飞行器尾迹、反射地面" },
      { name: "太空沉浸", themeStyle: "orbital_drama", tone: "宏大孤寂", palette: "深空蓝 / 星白 / 金属灰", promptHint: "舷窗、星海、失重、极简舱室" },
      { name: "废土求生", themeStyle: "post_ruin", tone: "粗粝残酷", palette: "沙褐 / 铁锈 / 暗青", promptHint: "破败城市、防尘装备、低能见度" }
    ],
    modern: [
      { name: "都市电影感", themeStyle: "urban_cinematic", tone: "现实戏剧", palette: "石墨 / 天青 / 暖黄", promptHint: "城市街景、玻璃反射、真实人物光比" },
      { name: "青春轻小说", themeStyle: "light_novel", tone: "明快叙事", palette: "浅蓝 / 奶白 / 珊瑚", promptHint: "校园/街角、柔光、轻节奏镜头" },
      { name: "现实黑色", themeStyle: "urban_noir", tone: "压抑锋利", palette: "黑灰 / 暗红 / 冷白", promptHint: "狭窄空间、背光剪影、雨夜纹理" },
      { name: "温暖治愈", themeStyle: "warm_slice", tone: "细腻生活", palette: "米色 / 木棕 / 橄榄绿", promptHint: "日常场景、自然光、低对比" }
    ]
  };

  const seeded = `${rawGenre} ${fileName} ${contextText}`.trim();
  const novelSignals = extractNovelStyleSignals(seeded);
  const reason =
    novelSignals.length > 0
      ? `从上传文本提取到风格信号：${novelSignals.join(" / ")}`
      : `未识别到稳定信号，按题材「${rawGenre || "通用"}」回退推荐。`;

  return (base[genreKey] ?? base.modern).map((item, index) => {
    const signal = novelSignals[index % Math.max(1, novelSignals.length)];
    const dynamicName = signal ? `${signal} · ${item.name}` : item.name;
    const dynamicPromptHint = signal ? `${signal}、${item.promptHint}` : item.promptHint;
    return {
      id: `${genreKey}-${index + 1}`,
      ...item,
      name: dynamicName,
      promptHint: dynamicPromptHint,
      source: signal ? "NOVEL_ANALYZED" : "STATIC",
      originReason: reason
    };
  });
}

function pickRecommendedStylePreset(
  presets: VisualStylePreset[],
  contextText: string
): VisualStylePreset | null {
  if (presets.length === 0) {
    return null;
  }
  const context = contextText.toLowerCase();
  if (!context.trim()) {
    return presets[0] ?? null;
  }

  let best: VisualStylePreset = presets[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  presets.forEach((preset, index) => {
    const cues = [
      ...preset.promptHint.split(/[、，,\/\s]+/),
      ...preset.tone.split(/[、，,\/\s]+/),
      ...preset.palette.split(/[、，,\/\s]+/),
      preset.name
    ]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const score = cues.reduce((sum, cue) => {
      return context.includes(cue) ? sum + 2 : sum;
    }, 0);
    const tieBreaker = -index * 0.01;
    const finalScore = score + tieBreaker;
    if (finalScore > bestScore) {
      bestScore = finalScore;
      best = preset;
    }
  });

  return best;
}

function buildCharacterPortraitPrompt(input: {
  character?: CharacterOption | null;
  globalFeaturePrompt?: string;
}): string {
  const character = input.character;
  const blocks = [
    `角色名：${character?.name || "未命名角色"}`,
    character?.appearance ? `外貌重点：${character.appearance}` : "外貌重点：五官清晰、体态明确、服装层次分明",
    input.globalFeaturePrompt ? `外貌强化：${input.globalFeaturePrompt}` : "",
    "构图要求：人物半身立绘、纯色或透明背景、无场景元素",
    "限制要求：避免剧情事件描述与剧透，不出现文字与水印"
  ]
    .filter(Boolean)
    .join("；");
  return blocks || "人物半身立绘；外貌特征清晰；纯背景；无文字无水印；避免剧情剧透。";
}

function buildCharacterStylePrompt(stylePreset?: VisualStylePreset | null): string {
  if (!stylePreset) {
    return "风格：写实角色立绘；色调克制；线条干净。";
  }
  return [
    `风格：${stylePreset.name}`,
    `基调：${stylePreset.tone}`,
    `色板：${stylePreset.palette}`,
    "画法：角色立绘、线条干净、材质清晰、电影级打光",
    "背景：保持纯色或透明背景，不生成场景"
  ].join("；");
}

function composeVisualStylePrompt(stylePreset?: VisualStylePreset | null, customStylePrompt?: string): string {
  const blocks = [
    stylePreset?.promptHint ? `风格关键词：${stylePreset.promptHint}` : "",
    stylePreset?.palette ? `色板：${stylePreset.palette}` : "",
    stylePreset?.tone ? `基调：${stylePreset.tone}` : "",
    customStylePrompt?.trim() ? `创作者自定义风格：${customStylePrompt.trim()}` : ""
  ]
    .filter(Boolean)
    .join("；");
  return blocks || "风格关键词：写实、清晰、电影感。";
}

function pickPlayerBioFromComponents(components: Record<string, unknown>): string {
  const candidates = [
    components.origin_background,
    components.profile,
    components.character_profile,
    components.summary,
    components.intro,
    components.biography,
    components.bio,
    components.background,
    components.description,
    components.title
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickAppearanceFromComponents(components: Record<string, unknown>): string {
  const candidates = [
    components.appearance,
    components.visual_profile,
    components.looks,
    components.outfit,
    components.face,
    components.weapon_appearance
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickInventoryFromComponents(components: Record<string, unknown>): Array<{
  item_id: string;
  name: string;
  category: string;
  quantity: number;
}> {
  const raw =
    components.inventory_system ??
    components.inventory ??
    components.backpack ??
    components.items ??
    components.bag ??
    [];
  if (!Array.isArray(raw)) {
    return [];
  }

  const out = raw
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? row.item_name ?? row.title ?? "").trim();
      const category = String(row.category ?? row.type ?? "misc").trim() || "misc";
      const quantity = clamp(Math.floor(Number(row.quantity ?? row.count ?? 1) || 1), 0, 9999);
      if (!name) {
        return null;
      }
      return {
        item_id: String(row.item_id ?? row.id ?? `item_${index + 1}`),
        name,
        category,
        quantity
      };
    })
    .filter(
      (item): item is { item_id: string; name: string; category: string; quantity: number } => item !== null
    );
  return out.slice(0, 60);
}

function pickAttributeStatsFromComponents(
  components: Record<string, unknown>,
  attrKeys: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  const coreAttrs = components.core_attributes;
  if (coreAttrs && typeof coreAttrs === "object" && !Array.isArray(coreAttrs)) {
    Object.entries(coreAttrs as Record<string, unknown>).forEach(([key, value]) => {
      if (!attrKeys.includes(key)) {
        return;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = clamp(value, 0, 100);
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const n = Number((value as Record<string, unknown>).value);
        if (Number.isFinite(n)) {
          out[key] = clamp(n, 0, 100);
        }
      }
    });
  }
  return out;
}

function ensurePlayerEntity(state: FrontendGameState): NonNullable<FrontendGameState["player_entity"]> {
  return {
    biography: {
      name: state.player_entity?.biography?.name ?? "玩家",
      age: state.player_entity?.biography?.age ?? 18,
      gender: state.player_entity?.biography?.gender ?? "未知",
      origin_background: state.player_entity?.biography?.origin_background ?? "未设定",
      appearance: state.player_entity?.biography?.appearance ?? ""
    },
    core_attributes: state.player_entity?.core_attributes ?? {},
    status_effects: state.player_entity?.status_effects ?? [],
    inventory_system: state.player_entity?.inventory_system ?? [],
    equipped_gear: state.player_entity?.equipped_gear ?? {}
  };
}

function buildCoreAttributesByTemplate(
  attributes: Array<{ key: string; name: string }>,
  stats: Record<string, number>,
  previous: NonNullable<FrontendGameState["player_entity"]>["core_attributes"]
): NonNullable<FrontendGameState["player_entity"]>["core_attributes"] {
  const next: NonNullable<FrontendGameState["player_entity"]>["core_attributes"] = {};
  attributes.forEach((attribute) => {
    const prev = previous?.[attribute.key];
    const value = Number.isFinite(stats[attribute.key]) ? stats[attribute.key] : prev?.value ?? 50;
    next[attribute.key] = {
      value: clamp(value, 0, 100),
      min: 0,
      max: 100,
      description: attribute.name || prev?.description || attribute.key
    };
  });
  return next;
}

function getGenreRecommendation(genre: string): TimeStepConfig {
  const text = genre.trim();
  if (text.includes("悬疑") || text.includes("都市")) {
    return { unit: "hour", value: 6, source: "LLM_RECOMMENDED", recommendation_reason: "高频事件建议小时级结算" };
  }
  if (text.includes("仙侠") || text.includes("玄幻") || text.includes("史诗")) {
    return { unit: "day", value: 1, source: "LLM_RECOMMENDED", recommendation_reason: "大世界剧情建议按天推进" };
  }
  if (text.includes("科幻") || text.includes("战争")) {
    return { unit: "week", value: 1, source: "LLM_RECOMMENDED", recommendation_reason: "宏观策略题材建议周级演化" };
  }
  return INITIAL_TIME_STEP;
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes < kb) {
    return `${bytes} B`;
  }
  if (bytes < mb) {
    return `${(bytes / kb).toFixed(1)} KB`;
  }
  return `${(bytes / mb).toFixed(2)} MB`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepCloneGameState(state: FrontendGameState): FrontendGameState {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as FrontendGameState;
}

function normalizeActionLabel(text: string): string {
  return text
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function entityKindZh(entityId: string): string {
  if (entityId.startsWith("char_")) return "角色";
  if (entityId.startsWith("faction_")) return "势力";
  if (entityId.startsWith("item_")) return "物品";
  if (entityId.startsWith("loc_")) return "地点";
  return "实体";
}

function attributeKeyZh(attributeKey: string): string {
  const map: Record<string, string> = {
    residence: "居住地",
    status: "状态",
    hp: "生命值",
    stamina: "体力",
    combat: "战斗",
    intelligence: "智谋",
    affinity: "好感",
    faction: "所属势力",
    profession: "职业",
    power: "战力",
    rank: "位阶",
    weapon: "武器"
  };
  return map[attributeKey] ?? attributeKey;
}

function formatResolutionKeyLabel(entityId: string, attributeKey: string): string {
  return `${entityId}.${attributeKey}（${entityKindZh(entityId)} · ${attributeKeyZh(attributeKey)}）`;
}

function parseFactionCallTokens(rawText: string): { cleanText: string; effects: FactionCallEffect[]; conditions: string[] } {
  const clean = (rawText ?? "")
    .replace(/<!\s*[\s\S]*?\s*!>/g, " ")
    .replace(/（\s*）/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/`+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    cleanText: normalizeActionLabel(clean),
    effects: [],
    conditions: []
  };
}

function parseFactionCallRulesFromMarkdown(markdown: string): Map<string, FactionCallRule> {
  void markdown;
  return new Map<string, FactionCallRule>();
}

function resolveActionTextAndFactionEffects(
  rawText: string,
  mapping: Map<string, FactionCallRule>
): { cleanText: string; effects: FactionCallEffect[]; conditions: string[] } {
  const parsed = parseFactionCallTokens(rawText ?? "");
  const cleanText = parsed.cleanText || normalizeActionLabel(rawText ?? "");
  const mapped = mapping.get(cleanText) ?? {
    effects: [],
    conditions: []
  };
  return {
    cleanText: cleanText || "继续观察",
    effects: [...parsed.effects, ...mapped.effects],
    conditions: unique([...parsed.conditions, ...mapped.conditions])
  };
}

function parseMaterialKind(file: File): MaterialAssetItem["kind"] {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime.startsWith("audio/")) {
    if (/(voice|cv|dub|tts|vocal|声线|配音)/i.test(name)) {
      return "VOICE";
    }
    return name.includes("sfx") || name.includes("se") ? "SFX" : "BGM";
  }
  if (mime.startsWith("video/")) {
    return "VIDEO";
  }
  if (mime.startsWith("image/")) {
    return name.includes("cg") ? "CG" : "IMAGE";
  }
  if (name.match(/\.(mp3|wav|ogg|flac|m4a)$/)) {
    if (/(voice|cv|dub|tts|vocal|声线|配音)/i.test(name)) {
      return "VOICE";
    }
    return name.includes("sfx") || name.includes("se") ? "SFX" : "BGM";
  }
  if (name.match(/\.(mp4|mov|webm|mkv)$/)) {
    return "VIDEO";
  }
  if (name.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/)) {
    return name.includes("cg") ? "CG" : "IMAGE";
  }
  return "IMAGE";
}

function makeMaterialToMediaAsset(item: MaterialAssetItem): MediaAsset {
  const kind = item.kind === "VIDEO" ? "VIDEO" : item.kind === "IMAGE" || item.kind === "CG" ? "IMAGE" : "BGM";
  return {
    asset_id: item.id,
    kind,
    url: item.url,
    title: item.name,
    loop: item.kind === "BGM"
  };
}

function stripTokenControlWrappers(text: string): string {
  return normalizeActionLabel(text.replace(/^["'`]+|["'`]+$/g, ""));
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".").map((item) => item.trim()).filter(Boolean);
  if (keys.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function getNestedValue(target: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".").map((item) => item.trim()).filter(Boolean);
  let cursor: unknown = target;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function resolveConditionOperandValue(state: FrontendGameState, rawOperand: string): unknown {
  const operand = stripTokenControlWrappers(rawOperand).trim();
  if (!operand) {
    return undefined;
  }
  if (/^["'].*["']$/.test(operand)) {
    return operand.slice(1, -1);
  }
  if (/^(true|false)$/i.test(operand)) {
    return operand.toLowerCase() === "true";
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(operand)) {
    return Number(operand);
  }

  const root = state as unknown as Record<string, unknown>;
  const candidates = operand.includes(".")
    ? [operand]
    : [
        `world_state.dynamic_vars.${operand}`,
        `world_state.${operand}`,
        `player_entity.core_attributes.${operand}.value`,
        `player_entity.${operand}`
      ];

  for (const path of candidates) {
    const value = getNestedValue(root, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function trimOuterParentheses(text: string): string {
  let out = text.trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < out.length; i += 1) {
      const ch = out[i];
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (depth === 0 && i < out.length - 1) {
        balanced = false;
        break;
      }
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
    if (!balanced) {
      break;
    }
    out = out.slice(1, -1).trim();
  }
  return out;
}

function splitByLogicalOperator(expression: string, operator: "&&" | "||"): string[] {
  const out: string[] = [];
  let token = "";
  let quote: '"' | "'" | "`" | null = null;
  let depth = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    const next = expression[i + 1];
    if (quote) {
      token += ch;
      if (ch === quote && expression[i - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      token += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      token += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      token += ch;
      continue;
    }
    if (depth === 0 && ch === operator[0] && next === operator[1]) {
      out.push(token.trim());
      token = "";
      i += 1;
      continue;
    }
    token += ch;
  }
  if (token.trim()) {
    out.push(token.trim());
  }
  return out;
}

function evaluateSingleFactionCondition(state: FrontendGameState, expression: string): boolean {
  const normalized = trimOuterParentheses(expression.replace(/\s+/g, " ").trim());
  if (!normalized) {
    return true;
  }

  const orParts = splitByLogicalOperator(normalized, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateSingleFactionCondition(state, part));
  }
  const andParts = splitByLogicalOperator(normalized, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateSingleFactionCondition(state, part));
  }
  if (normalized.startsWith("!")) {
    const negated = trimOuterParentheses(normalized.slice(1).trim());
    if (!negated) {
      return true;
    }
    return !evaluateSingleFactionCondition(state, negated);
  }

  const comparison = normalized.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!comparison) {
    const lone = resolveConditionOperandValue(state, normalized);
    return Boolean(lone);
  }

  const left = resolveConditionOperandValue(state, comparison[1]);
  const operator = comparison[2];
  const right = resolveConditionOperandValue(state, comparison[3]);

  if (left === undefined || right === undefined) {
    return false;
  }

  const leftNum = Number(left);
  const rightNum = Number(right);
  const numericComparable = Number.isFinite(leftNum) && Number.isFinite(rightNum);
  const a: unknown = numericComparable ? leftNum : String(left);
  const b: unknown = numericComparable ? rightNum : String(right);

  if (operator === ">=") return (a as number | string) >= (b as number | string);
  if (operator === "<=") return (a as number | string) <= (b as number | string);
  if (operator === ">") return (a as number | string) > (b as number | string);
  if (operator === "<") return (a as number | string) < (b as number | string);
  if (operator === "==") return a === b;
  if (operator === "!=") return a !== b;
  return false;
}

function evaluateFactionConditions(
  state: FrontendGameState,
  conditions: string[]
): { pass: boolean; unmetConditions: string[] } {
  if (!conditions.length) {
    return {
      pass: true,
      unmetConditions: []
    };
  }
  const unmetConditions = unique(
    conditions
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((expr) => !evaluateSingleFactionCondition(state, expr))
  );
  return {
    pass: unmetConditions.length === 0,
    unmetConditions
  };
}

function applySetExpressionToState(state: FrontendGameState, expr: string): string | null {
  const normalized = expr.replace(/\s+/g, " ").trim();
  const opMatch = normalized.match(/^(.+?)\s*(\+=|-=|=)\s*(.+)$/);
  if (!opMatch) {
    return null;
  }
  const leftRaw = stripTokenControlWrappers(opMatch[1]);
  const operator = opMatch[2];
  const rightRaw = stripTokenControlWrappers(opMatch[3]);
  const leftPath = leftRaw.includes(".") ? leftRaw : `world_state.dynamic_vars.${leftRaw}`;

  const root = state as unknown as Record<string, unknown>;
  const currentValue = getNestedValue(root, leftPath);

  const parseNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const currentNum = parseNumber(currentValue) ?? 0;

  const parseRightAsNumber = (): number | null => {
    const plain = rightRaw.replace(/,/g, "").trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(plain)) {
      return Number(plain);
    }
    const selfCalc = plain.match(/^(.+?)\s*([+-])\s*(\d+(\.\d+)?)$/);
    if (selfCalc) {
      const rhsVar = stripTokenControlWrappers(selfCalc[1]);
      const rhsPath = rhsVar.includes(".") ? rhsVar : `world_state.dynamic_vars.${rhsVar}`;
      if (rhsPath === leftPath) {
        const delta = Number(selfCalc[3]);
        return selfCalc[2] === "-" ? currentNum - delta : currentNum + delta;
      }
    }
    return null;
  };

  let nextValue: unknown = rightRaw;
  const numeric = parseRightAsNumber();
  if (operator === "+=") {
    const deltaText = rightRaw.replace(/,/g, "").trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(deltaText)) {
      nextValue = currentNum + Number(deltaText);
    } else if (numeric !== null) {
      nextValue = numeric;
    }
  } else if (operator === "-=") {
    const deltaText = rightRaw.replace(/,/g, "").trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(deltaText)) {
      nextValue = currentNum - Number(deltaText);
    } else if (numeric !== null) {
      nextValue = numeric;
    }
  } else if (operator === "=") {
    if (numeric !== null) {
      nextValue = numeric;
    } else if (/^(true|false)$/i.test(rightRaw)) {
      nextValue = rightRaw.toLowerCase() === "true";
    } else {
      nextValue = rightRaw.replace(/^["']|["']$/g, "");
    }
  }

  setNestedValue(root, leftPath, nextValue);
  return `${leftPath} ${operator} ${String(nextValue)}`;
}

function applyFactionCallEffects(state: FrontendGameState, effects: FactionCallEffect[]): string[] {
  const logs: string[] = [];
  effects.forEach((effect) => {
    if (effect.kind === "BGM") {
      const payload = parseFactionAudioTrackName(effect.value);
      const trackName = payload || "unnamed_bgm";
      const asset: MediaAsset = {
        asset_id: `bgm-call-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        kind: "BGM",
        title: trackName,
        url: payload.startsWith("http") || payload.startsWith("blob:") ? payload : `asset://bgm/${encodeURIComponent(trackName)}`,
        loop: true
      };
      state.media_assets.bgm_tracks = [...(state.media_assets.bgm_tracks ?? []), asset];
      state.world_state.world_events = unique([...(state.world_state.world_events ?? []), `BGM切换：${trackName}`]).slice(0, 40);
      logs.push(`BGM => ${trackName}`);
      return;
    }

    if (effect.kind === "SFX") {
      const payload = parseFactionAudioTrackName(effect.value);
      const sfxName = payload || "unnamed_sfx";
      state.world_state.world_events = unique([...(state.world_state.world_events ?? []), `SFX触发：${sfxName}`]).slice(0, 40);
      logs.push(`SFX => ${sfxName}`);
      return;
    }

    if (effect.kind === "SET") {
      const applied = applySetExpressionToState(state, effect.value);
      if (applied) {
        logs.push(`SET => ${applied}`);
      }
    }
  });
  return logs;
}

function dedupeMediaAssets(items: MediaAsset[]): MediaAsset[] {
  const out = new Map<string, MediaAsset>();
  items.forEach((item) => {
    const key = `${item.kind}::${item.title ?? ""}::${item.url}`;
    if (!out.has(key)) {
      out.set(key, item);
    }
  });
  return Array.from(out.values());
}

function parseFactionAudioTrackName(rawPayload: string): string {
  const quoted = rawPayload.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  return rawPayload.replace(/^play\s*,?/i, "").trim().replace(/^["'`]|["'`]$/g, "");
}

function dedupeFactionEffects(effects: FactionCallEffect[]): FactionCallEffect[] {
  const out = new Map<string, FactionCallEffect>();
  effects.forEach((effect) => {
    const key = `${effect.kind}::${effect.value.trim().toLowerCase()}`;
    if (!out.has(key)) {
      out.set(key, effect);
    }
  });
  return Array.from(out.values());
}

function mergeAvailableActionsWithScripted(
  modelActions: NonNullable<FrontendGameState["event_engine"]>["available_actions"],
  scriptedActions: NonNullable<FrontendGameState["event_engine"]>["available_actions"]
): NonNullable<FrontendGameState["event_engine"]>["available_actions"] {
  const merged: NonNullable<FrontendGameState["event_engine"]>["available_actions"] = [];
  const seen = new Set<string>();
  const append = (action: NonNullable<FrontendGameState["event_engine"]>["available_actions"][number]) => {
    const key = normalizeActionLabel(action.prompt_text || action.action_id || "").toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(action);
  };
  modelActions.forEach(append);
  scriptedActions.forEach(append);
  if (merged.length > 0) {
    return merged;
  }
  return [
    {
      action_id: "wait",
      prompt_text: "继续观察",
      required_stats: {}
    }
  ];
}

function parseGameCardActs(markdown: string): GameCardActNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const acts: GameCardActNode[] = [];
  let currentAct: GameCardActNode | null = null;
  let currentEvent: GameCardEventNode | null = null;
  let inMainTimeline = false;
  let timelineHeadingLevel = 2;
  let parseMode: "IDLE" | "EVENT" | "SCENE" | "CHOICE" = "IDLE";
  const conditionStack: Array<{ expression: string; inElse: boolean }> = [];

  const cleanInline = (text: string): string =>
    text
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\d+[\.\)]\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^\>\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isActTitleLine = (line: string): boolean => {
    if (/^\|.*\|$/.test(line)) {
      return false;
    }
    const normalized = cleanInline(line);
    if (!normalized || /主线剧情|Timeline Acts/i.test(normalized)) {
      return false;
    }
    return /^(Act\s*\d+|第\s*\d+\s*幕)(?:\s*[:：].*)?$/i.test(normalized);
  };

  const snapshotChoiceConditions = (): string[] =>
    unique(
      conditionStack
        .map((item) => item.expression.trim())
        .filter(Boolean)
        .map((expr, idx) => (conditionStack[idx].inElse ? `!(${expr})` : expr))
    );

  const getOrCreateCurrentEvent = (): GameCardEventNode | null => {
    if (!currentAct) {
      return null;
    }
    if (currentEvent) {
      return currentEvent;
    }
    currentEvent = {
      id: `${currentAct.id}-event-${currentAct.events.length + 1}`,
      title: `事件${currentAct.events.length + 1}`,
      keyScenes: [],
      choices: [],
      directives: []
    };
    return currentEvent;
  };

  const pushEvent = () => {
    if (!currentAct || !currentEvent) {
      currentEvent = null;
      return;
    }
    currentEvent.keyScenes = unique(currentEvent.keyScenes.map((item) => cleanInline(item)).filter(Boolean));
    currentEvent.choices = Array.from(
      new Map(
        currentEvent.choices
          .map((choice) => ({
            ...choice,
            label: cleanInline(choice.label),
            rawText: choice.rawText.trim(),
            conditions: unique((choice.conditions ?? []).map((item) => item.trim()).filter(Boolean))
          }))
          .filter((choice) => choice.rawText.length > 0)
          .map((choice) => [`${choice.rawText}::${choice.conditions.join("&&")}`, choice])
      ).values()
    );
    currentEvent.directives = dedupeFactionEffects(currentEvent.directives ?? []);
    if (currentEvent.keyScenes.length === 0) {
      currentEvent.keyScenes.push("（未提取到关键场景）");
    }
    currentAct.events.push(currentEvent);
    currentAct.keyScenes.push(...currentEvent.keyScenes.map((scene) => `${currentEvent?.title}：${scene}`));
    currentEvent = null;
  };

  const pushAct = () => {
    if (!currentAct) {
      return;
    }
    pushEvent();
    currentAct.keyScenes = unique(currentAct.keyScenes.map((item) => cleanInline(item)).filter(Boolean));
    if (currentAct.keyScenes.length === 0) {
      currentAct.keyScenes.push("（未提取到关键场景引用，请在该幕中补充“场景锁定”内容）");
    }
    if (currentAct.events.length === 0) {
      currentAct.events.push({
        id: `${currentAct.id}-event-1`,
        title: `${currentAct.title} / 默认事件`,
        keyScenes: [...currentAct.keyScenes],
        choices: [],
        directives: []
      });
    }
    acts.push(currentAct);
    currentAct = null;
    currentEvent = null;
    parseMode = "IDLE";
    conditionStack.length = 0;
  };

  const startAct = (title: string) => {
    pushAct();
    currentAct = {
      id: `act-${acts.length + 1}`,
      title: cleanInline(title),
      events: [],
      keyScenes: [],
      index: acts.length
    };
    parseMode = "EVENT";
  };

  const startEvent = (title: string) => {
    if (!currentAct) {
      return;
    }
    pushEvent();
    currentEvent = {
      id: `${currentAct.id}-event-${currentAct.events.length + 1}`,
      title: cleanInline(title) || `事件${currentAct.events.length + 1}`,
      keyScenes: [],
      choices: [],
      directives: []
    };
    parseMode = "SCENE";
  };

  const addScene = (rawText: string) => {
    const event = getOrCreateCurrentEvent();
    if (!event) {
      return;
    }
    const cleaned = cleanInline(rawText)
      .replace(/^🎬\s*/, "")
      .replace(/^(场景锁定|Scene Override)\s*[:：]?\s*/i, "")
      .trim();
    if (!cleaned || /^(强制选项|玩家抉择点|玩家选择点|Forced Choices)\b/i.test(cleaned)) {
      return;
    }
    event.keyScenes.push(cleaned);
  };

  const addChoice = (rawLine: string) => {
    const event = getOrCreateCurrentEvent();
    if (!event) {
      return;
    }
    const choiceMatch =
      rawLine.match(/^(?:[-*]\s*|\d+[\.\)]\s*)?\[([^\]]+)\]\s*(.*)$/) ??
      rawLine.match(/^[-*]\s*([^<\n\r]+?)\s*(.*)$/);
    if (!choiceMatch) {
      return;
    }
    const label = cleanInline(choiceMatch[1] ?? "");
    const suffix = String(choiceMatch[2] ?? "").trim();
    const rawText = [label, suffix].filter(Boolean).join(" ").trim();
    if (!rawText) {
      return;
    }
    event.choices.push({
      id: `${event.id}-choice-${event.choices.length + 1}`,
      label: label || `选项${event.choices.length + 1}`,
      rawText,
      conditions: snapshotChoiceConditions()
    });
  };

  lines.forEach((raw) => {
    if (!raw.trim()) {
      return;
    }
    const rawLine = raw.trim();
    const heading = rawLine.match(/^(#{1,6})\s+(.+)$/);
    let workingLine = rawLine;
    let headingLevel = 0;
    if (heading) {
      headingLevel = heading[1].length;
      workingLine = cleanInline(heading[2]);
    }

    if (heading && /主线剧情|Timeline Acts|按幕/i.test(workingLine)) {
      inMainTimeline = true;
      timelineHeadingLevel = headingLevel;
      parseMode = "EVENT";
      currentAct = null;
      currentEvent = null;
      conditionStack.length = 0;
      return;
    }

    const actTitleCandidate = heading ? workingLine : rawLine;
    if (isActTitleLine(actTitleCandidate)) {
      inMainTimeline = true;
      startAct(actTitleCandidate);
      return;
    }

    if (heading && inMainTimeline && headingLevel <= timelineHeadingLevel && acts.length > 0) {
      pushAct();
      inMainTimeline = false;
      parseMode = "IDLE";
      return;
    }

    if (!inMainTimeline || !currentAct) {
      return;
    }

    if (/^\|.*\|$/.test(rawLine)) {
      return;
    }

    const logicLine = cleanInline(workingLine);
    const ifMatch = logicLine.match(/^#if\s+(.+)$/i);
    if (ifMatch) {
      conditionStack.push({ expression: ifMatch[1].trim(), inElse: false });
      return;
    }
    if (/^#else\b/i.test(logicLine)) {
      if (conditionStack.length > 0) {
        conditionStack[conditionStack.length - 1].inElse = true;
      }
      return;
    }
    if (/^#endif\b/i.test(logicLine)) {
      if (conditionStack.length > 0) {
        conditionStack.pop();
      }
      return;
    }

    if (/关键事件|关键事件与玩家抉择|Key Event/i.test(logicLine)) {
      parseMode = "EVENT";
      pushEvent();
      return;
    }
    if (/关键场景|场景锁定|Scene Override/i.test(logicLine)) {
      parseMode = "SCENE";
      getOrCreateCurrentEvent();
      const afterColon = logicLine.split(/[:：]/).slice(1).join("：").trim();
      if (afterColon) {
        addScene(afterColon);
      }
      return;
    }
    if (/玩家抉择点|玩家选择点|强制选项|Forced Choices/i.test(logicLine)) {
      parseMode = "CHOICE";
      getOrCreateCurrentEvent();
      return;
    }
    if (/背景|各角色线差异|承接上幕|推进下幕|结局|附录/i.test(logicLine)) {
      parseMode = "IDLE";
      pushEvent();
      return;
    }

    const eventStartMatch =
      logicLine.match(/^\d+[\.\)]\s*(?:\[(.+?)\]|(.+))$/) ??
      logicLine.match(/^\[(.+?)\]\s*(.*)$/);
    if (eventStartMatch) {
      const eventTitle = cleanInline(eventStartMatch[1] ?? eventStartMatch[2] ?? "");
      if (eventTitle) {
        startEvent(eventTitle);
        return;
      }
    }

    const quoteRaw = rawLine.startsWith(">") ? rawLine.replace(/^>\s?/, "").trim() : rawLine;
    const quoteClean = cleanInline(quoteRaw);
    if (!quoteClean) {
      return;
    }

    const directiveParsed = parseFactionCallTokens(quoteRaw);
    if (directiveParsed.effects.length > 0 && !directiveParsed.cleanText) {
      const event = getOrCreateCurrentEvent();
      if (event) {
        event.directives.push(...directiveParsed.effects);
      }
      return;
    }

    const looksLikeChoice = /^(?:[-*]\s*|\d+[\.\)]\s*)?\[[^\]]+\]/.test(quoteRaw);
    if (parseMode === "CHOICE" || looksLikeChoice) {
      addChoice(quoteRaw);
      return;
    }

    if (parseMode === "SCENE" || parseMode === "EVENT" || currentEvent) {
      const cleaned = quoteClean
        .replace(/^[-*]\s*/, "")
        .replace(/^[🎬🔘]\s*/, "")
        .trim();
      if (
        cleaned &&
        !/^(收益|风险)\s*[:：]/.test(cleaned) &&
        !/^[-*]\s*\[[^\]]+\]/.test(cleaned) &&
        !/^(玩家抉择点|强制选项|Forced Choices)\b/i.test(cleaned)
      ) {
        addScene(cleaned);
      }
    }
  });

  pushAct();
  if (acts.length > 0) {
    return acts;
  }

  // 兜底：若文档未包含“主线剧情”标题，尝试全局识别标准 Act 标题。
  const fallbackActs: GameCardActNode[] = [];
  markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || /^\|.*\|$/.test(line)) {
        return;
      }
      if (!isActTitleLine(line)) {
        return;
      }
      fallbackActs.push({
        id: `fallback-act-${fallbackActs.length + 1}`,
        title: cleanInline(line),
        events: [
          {
            id: `fallback-act-${fallbackActs.length + 1}-event-1`,
            title: `${cleanInline(line)} / 默认事件`,
            keyScenes: ["（未提取到关键场景引用，请在该幕中补充 > 引用语块）"],
            choices: [],
            directives: []
          }
        ],
        keyScenes: ["（未提取到关键场景引用，请在该幕中补充 > 引用语块）"],
        index: fallbackActs.length
      });
    });
  return fallbackActs;
}

function estimateAnchorByAct(index: number, totalActs: number, totalChunks: number): number {
  if (totalChunks <= 0 || totalActs <= 0) {
    return Math.max(1, index + 1);
  }
  const ratio = (index + 1) / totalActs;
  return clamp(Math.round(ratio * totalChunks), 1, totalChunks);
}

function buildCardEventActions(
  event: GameCardActNode["events"][number] | null | undefined
): NonNullable<FrontendGameState["event_engine"]>["available_actions"] {
  if (!event || !event.choices || event.choices.length === 0) {
    return [
      {
        action_id: "wait",
        prompt_text: "继续观察",
        required_stats: {}
      }
    ];
  }
  return event.choices.map((choice, idx) => ({
    action_id: `card::${event.id}::${idx + 1}`,
    prompt_text: choice.rawText || choice.label || `选项${idx + 1}`,
    required_stats: {},
    conditions: choice.conditions ?? []
  }));
}

function mergeGraph(existing: EcsLocalGraph[], graph: EcsLocalGraph): EcsLocalGraph[] {
  const next = [...existing];
  const idx = next.findIndex((it) => it.chapter_index === graph.chapter_index);
  if (idx >= 0) {
    next[idx] = graph;
  } else {
    next.push(graph);
    next.sort((a, b) => a.chapter_index - b.chapter_index);
  }
  return next;
}

function summarizeRuleCount(graphs: EcsLocalGraph[]): { social: number; ability: number; causal: number; factions: number } {
  const social = unique(graphs.flatMap((g) => g.implicit_rules.social_power_relations)).length;
  const ability = unique(graphs.flatMap((g) => g.implicit_rules.ability_costs)).length;
  const causal = unique(graphs.flatMap((g) => g.implicit_rules.causal_invariants)).length;
  const factions = unique(
    graphs.flatMap((g) => g.entities.filter((entity) => entity.entity_type === "faction").map((entity) => entity.display_name))
  ).length;
  return { social, ability, causal, factions };
}

interface ChunkCluster {
  id: string;
  label: string;
  summary: string;
  chunkIndexes: number[];
  resolved: boolean;
}

type ResolutionStatus = "DENSITY_FILTERED" | "TEMPORAL_OVERRIDE" | "CRA_PATCHED" | "BIFURCATED";

interface CandidateTrace {
  value: string;
  chapterIndex: number;
  chunkId: string;
}

interface ResolutionDetailItem {
  id: string;
  entityId: string;
  attributeKey: string;
  status: ResolutionStatus;
  selectedValue?: string;
  discardedValues: string[];
  patchNarrative?: string;
  reason?: string;
  candidates: CandidateTrace[];
}

const RESOLUTION_MODULE_HELP: Record<ResolutionStatus, { title: string; desc: string }> = {
  DENSITY_FILTERED: {
    title: "密度过滤",
    desc: "同类设定冲突时，优先保留高频高证据版本（默认阈值 5:1）。"
  },
  TEMPORAL_OVERRIDE: {
    title: "时序覆写",
    desc: "当冲突密度接近时，后章节设定覆盖前章节设定。"
  },
  CRA_PATCHED: {
    title: "CRA 补丁",
    desc: "核心人物硬冲突由 CRA 生成圆谎叙事补丁以维持可玩性。"
  },
  BIFURCATED: {
    title: "平行分叉",
    desc: "宏观设定冲突过大时保留多世界线，并允许合并多条世界线作为主基调。"
  }
};

const MOJIBAKE_RE = /�|锟斤拷|Ã|â|鈥|ï»¿|�/g;

function shorten(text: string, max = 42): string {
  const clean = sanitizeNarrativeText(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function sanitizeNarrativeText(text: string): string {
  return text.replace(/\u0000/g, "").replace(MOJIBAKE_RE, " ").replace(/\s+/g, " ").trim();
}

function isLikelyGarbled(text: string): boolean {
  const clean = text.trim();
  if (!clean) {
    return false;
  }
  const weirdCount = (clean.match(MOJIBAKE_RE)?.length ?? 0) + (clean.match(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu)?.length ?? 0);
  return weirdCount / Math.max(clean.length, 1) > 0.15;
}

function inferPlotLabelFromGraph(graph: EcsLocalGraph, fallbackChunkText: string): { label: string; summary: string } {
  const faction = graph.entities.find((entity) => entity.entity_type === "faction")?.display_name;
  const metaSummary =
    typeof graph.metadata?.brief_summary === "string" ? sanitizeNarrativeText(String(graph.metadata.brief_summary)) : "";
  const fact = graph.assertions.find((a) => a.category === "FACT")?.value;
  const causal = graph.implicit_rules.causal_invariants[0];
  const fallback = sanitizeNarrativeText(fallbackChunkText).slice(0, 120);

  const bestSummary = [metaSummary, fact ?? "", causal ?? "", fallback].find((item) => item && !isLikelyGarbled(item)) ?? fallback;

  if (faction && !isLikelyGarbled(faction)) {
    return {
      label: `${faction} 势力线`,
      summary: shorten(bestSummary || `${faction} 相关剧情推进`, 68)
    };
  }

  if (fact && !isLikelyGarbled(fact)) {
    return {
      label: shorten(fact, 14),
      summary: shorten(bestSummary || fact, 68)
    };
  }

  if (causal && !isLikelyGarbled(causal)) {
    return {
      label: shorten(causal, 14),
      summary: shorten(bestSummary || causal, 68)
    };
  }

  if (bestSummary) {
    return {
      label: shorten(bestSummary, 14),
      summary: shorten(bestSummary, 68)
    };
  }

  return {
    label: `章节 ${graph.chapter_index}`,
    summary: "该切片摘要质量较低，建议单独解析该切片后再归类。"
  };
}

function buildChunkClusters(allChunks: string[], graphs: EcsLocalGraph[]): ChunkCluster[] {
  const graphByChunk = new Map<number, EcsLocalGraph>();
  graphs.forEach((graph) => {
    graphByChunk.set(graph.chapter_index - 1, graph);
  });

  const clusterMap = new Map<string, ChunkCluster>();
  for (let idx = 0; idx < allChunks.length; idx += 1) {
    const graph = graphByChunk.get(idx);
    const chunkPreview = allChunks[idx] ?? "";
    const labelData = graph
      ? inferPlotLabelFromGraph(graph, chunkPreview)
      : {
          label: "待 AI 归类",
          summary: "尚未执行 map 提取，暂无法推断情节类目。"
        };
    const key = `${graph ? "resolved" : "pending"}::${labelData.label}`;
    const existing = clusterMap.get(key);
    if (existing) {
      existing.chunkIndexes.push(idx);
      continue;
    }

    clusterMap.set(key, {
      id: key,
      label: labelData.label,
      summary: labelData.summary,
      chunkIndexes: [idx],
      resolved: !!graph
    });
  }

  return [...clusterMap.values()].sort((a, b) => {
    if (a.resolved !== b.resolved) {
      return a.resolved ? -1 : 1;
    }
    return b.chunkIndexes.length - a.chunkIndexes.length;
  });
}

export default function App() {
  const [mode, setMode] = React.useState<"beginner" | "expert">("beginner");
  const [rightTab, setRightTab] = React.useState<"guide" | "debug" | "card" | "expert">("guide");
  const [guideStage, setGuideStage] = React.useState<1 | 2>(1);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [processedNovelHistory, setProcessedNovelHistory] = React.useState<ProcessedNovelHistoryItem[]>([]);

  const [gameState, setGameState] = React.useState<FrontendGameState>(INITIAL_STATE);
  const [timeStepConfig, setTimeStepConfig] = React.useState<TimeStepConfig>(INITIAL_TIME_STEP);
  const [plotMode, setPlotMode] = React.useState<"FOLLOW_CANON" | "SANDBOX">("FOLLOW_CANON");

  const [sourceFileName, setSourceFileName] = React.useState("未上传小说");
  const [sourceRawText, setSourceRawText] = React.useState("");
  const [allChunks, setAllChunks] = React.useState<string[]>([]);
  const [chunkSize, setChunkSize] = React.useState(3200);
  const [uploadDragOver, setUploadDragOver] = React.useState(false);
  const [selectedChunkIndex, setSelectedChunkIndex] = React.useState(0);
  const [timelineAnchor, setTimelineAnchor] = React.useState(1);
  const [baselineContext, setBaselineContext] = React.useState("");
  const [chunkBrowserOpen, setChunkBrowserOpen] = React.useState(false);
  const [selectedClusterId, setSelectedClusterId] = React.useState<string>("");

  const [localGraphs, setLocalGraphs] = React.useState<EcsLocalGraph[]>([]);
  const [selectedGraphIndex, setSelectedGraphIndex] = React.useState(0);
  const [reduceResult, setReduceResult] = React.useState<ReduceConflictResponse | null>(null);
  const [fullParseJob, setFullParseJob] = React.useState<FullParseJob | null>(null);
  const [resolutionDrawerOpen, setResolutionDrawerOpen] = React.useState(false);
  const [activeResolutionStatus, setActiveResolutionStatus] = React.useState<ResolutionStatus>("DENSITY_FILTERED");
  const [worldlineSelections, setWorldlineSelections] = React.useState<Record<string, string[]>>({});
  const [resolutionOverrides, setResolutionOverrides] = React.useState<Record<string, string>>({});
  const [selectedCharacterId, setSelectedCharacterId] = React.useState<string>(CUSTOM_CHARACTER_OPTION);
  const [lastTurnResult, setLastTurnResult] = React.useState<TurnExecuteResponse | null>(null);

  const [turnActionId, setTurnActionId] = React.useState("wait");
  const [customActionText, setCustomActionText] = React.useState("");
  const [historyStack, setHistoryStack] = React.useState<FrontendGameState[]>([]);
  const [narrativeArchive, setNarrativeArchive] = React.useState<string[]>([]);

  const [negativeWordsText, setNegativeWordsText] = React.useState("赛博朋克");
  const [systemPromptDraft, setSystemPromptDraft] = React.useState(
    "你是严格遵守状态机的叙事渲染器。禁止越权替玩家选择。禁止违背世界观法则。"
  );

  const [jsonDraft, setJsonDraft] = React.useState(JSON.stringify(INITIAL_STATE, null, 2));
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const [shareLink, setShareLink] = React.useState("");
  const [apiError, setApiError] = React.useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardAnswers, setWizardAnswers] = React.useState<DraftWizardAnswers>({
    world_rule: "",
    power_cost: "",
    faction_tension: ""
  });

  const [loading, setLoading] = React.useState({
    upload: false,
    mapCurrent: false,
    mapBatch: false,
    reduce: false,
    turn: false,
    wizardAi: false
  });
  const [gameCardMarkdown, setGameCardMarkdown] = React.useState("");
  const [gameCardReferenceMarkdown, setGameCardReferenceMarkdown] = React.useState("");
  const [gameCardGenerating, setGameCardGenerating] = React.useState(false);
  const [gameCardLoadingTipIndex, setGameCardLoadingTipIndex] = React.useState(0);
  const [waitingCardStart, setWaitingCardStart] = React.useState(false);
  const [cardStartMode, setCardStartMode] = React.useState<"ANCHOR" | "BEGINNING">("ANCHOR");
  const [cardRuntimeEnabled, setCardRuntimeEnabled] = React.useState(false);
  const [cardRuntimeCursor, setCardRuntimeCursor] = React.useState<{ actId: string; eventId: string } | null>(null);
  const [leftPanelMode, setLeftPanelMode] = React.useState<"play" | "mita">("play");
  const [mitaEnabled, setMitaEnabled] = React.useState(false);
  const [mitaPreset, setMitaPreset] = React.useState<"STRICT" | "CREATIVE">("STRICT");
  const [mitaInput, setMitaInput] = React.useState("");
  const [mitaLoading, setMitaLoading] = React.useState(false);
  const [mitaHistory, setMitaHistory] = React.useState<MitaMessage[]>([]);
  const [selectedCardActId, setSelectedCardActId] = React.useState("");
  const [selectedCardEventId, setSelectedCardEventId] = React.useState("");
  const [selectedCardScene, setSelectedCardScene] = React.useState("");
  const [materialLibrary, setMaterialLibrary] = React.useState<MaterialAssetItem[]>([]);
  const [materialFilter, setMaterialFilter] = React.useState<"ALL" | "BGM" | "SFX" | "VOICE" | "IMAGE" | "VIDEO" | "CG">("ALL");
  const [audioNowPlaying, setAudioNowPlaying] = React.useState<{
    materialId: string;
    name: string;
    kind: "BGM" | "SFX" | "VOICE";
  } | null>(null);
  const [selectedVisualPresetId, setSelectedVisualPresetId] = React.useState("");
  const [chunkStrategyConfirmed, setChunkStrategyConfirmed] = React.useState(false);
  const [customizationSaved, setCustomizationSaved] = React.useState(false);
  const [dynamicStylePresets, setDynamicStylePresets] = React.useState<VisualStylePreset[]>([]);
  const [stylePresetLoading, setStylePresetLoading] = React.useState(false);
  const [stylePresetError, setStylePresetError] = React.useState<string | null>(null);
  const [stylePreviewMap, setStylePreviewMap] = React.useState<Record<string, VisualPreviewItemState>>({});
  const [autoRecommendedStyleId, setAutoRecommendedStyleId] = React.useState("");
  const [customStylePrompt, setCustomStylePrompt] = React.useState("");
  const [selectedPortraitCharacterId, setSelectedPortraitCharacterId] = React.useState("");
  const [characterPromptDraftMap, setCharacterPromptDraftMap] = React.useState<Record<string, string>>({});
  const [characterPreviewMap, setCharacterPreviewMap] = React.useState<Record<string, VisualPreviewItemState>>({});
  const [characterReferenceImageMap, setCharacterReferenceImageMap] = React.useState<Record<string, string>>({});
  const [characterFeaturePrompt, setCharacterFeaturePrompt] = React.useState(
    "强调角色五官特征、体态习惯与武器辨识度，避免模板化描述。"
  );
  const [voiceMode, setVoiceMode] = React.useState<"UPLOAD_CLONE" | "AI_RANDOM">("UPLOAD_CLONE");
  const [selectedVoiceMaterialId, setSelectedVoiceMaterialId] = React.useState("");
  const [voicePrompt, setVoicePrompt] = React.useState(DEFAULT_VOICE_PROMPT);
  const [characterVoiceDraftMap, setCharacterVoiceDraftMap] = React.useState<Record<string, CharacterVoiceDraft>>({});
  const [voiceGatewayConfig, setVoiceGatewayConfig] = React.useState<VoiceCloneGatewayConfig>({
    provider: "LOCAL_MATERIAL",
    endpoint: "",
    model: "local-preview"
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const debugMaterialInputRef = React.useRef<HTMLInputElement | null>(null);
  const cardMaterialInputRef = React.useRef<HTMLInputElement | null>(null);
  const characterRefInputRef = React.useRef<HTMLInputElement | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const applyCustomizationRef = React.useRef<(() => void) | null>(null);

  const pushProcessedNovelHistory = React.useCallback((input: { fileName: string; chunkCount: number; charCount: number }) => {
    const item: ProcessedNovelHistoryItem = {
      id: `${input.fileName}-${Date.now()}`,
      fileName: input.fileName,
      chunkCount: input.chunkCount,
      charCount: input.charCount,
      processedAt: Date.now()
    };
    setProcessedNovelHistory((prev) => {
      const deduped = prev.filter((row) => row.fileName !== input.fileName);
      return [item, ...deduped].slice(0, 30);
    });
  }, []);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROCESSED_NOVEL_HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      const normalized = parsed
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const fileName = String((item as { fileName?: unknown }).fileName ?? "").trim();
          const processedAt = Number((item as { processedAt?: unknown }).processedAt ?? 0);
          const chunkCount = Number((item as { chunkCount?: unknown }).chunkCount ?? 0);
          const charCount = Number((item as { charCount?: unknown }).charCount ?? 0);
          if (!fileName || !Number.isFinite(processedAt) || processedAt <= 0) {
            return null;
          }
          return {
            id: String((item as { id?: unknown }).id ?? `${fileName}-${processedAt}`),
            fileName,
            processedAt,
            chunkCount: Number.isFinite(chunkCount) ? Math.max(0, Math.floor(chunkCount)) : 0,
            charCount: Number.isFinite(charCount) ? Math.max(0, Math.floor(charCount)) : 0
          } satisfies ProcessedNovelHistoryItem;
        })
        .filter((item): item is ProcessedNovelHistoryItem => !!item)
        .slice(0, 30);
      setProcessedNovelHistory(normalized);
    } catch {
      // ignore broken local cache
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(PROCESSED_NOVEL_HISTORY_STORAGE_KEY, JSON.stringify(processedNovelHistory));
    } catch {
      // ignore storage quota errors
    }
  }, [processedNovelHistory]);

  React.useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const pollFullParseJobUntilStop = React.useCallback(
    async (jobId: string): Promise<{ status: "SUCCEEDED"; result: Omit<FullParsePipelineResponse, "ok"> } | { status: "PAUSED" }> => {
      for (let i = 0; i < 3600; i += 1) {
        await delay(1000);
        const snapshot = await apiManager.getFullParseJob(jobId);
        setFullParseJob(snapshot.job);

        if (snapshot.job.status === "SUCCEEDED") {
          if (!snapshot.job.result) {
            throw new Error("全局解析任务已完成，但未返回结果。");
          }
          return { status: "SUCCEEDED", result: snapshot.job.result };
        }

        if (snapshot.job.status === "FAILED") {
          throw new Error(snapshot.job.error ?? "全局解析任务失败。");
        }

        if (snapshot.job.status === "PAUSED") {
          return { status: "PAUSED" };
        }
      }

      throw new Error("全局解析任务超时（超过 60 分钟），请重试或减少切片量。");
    },
    []
  );

  const selectedGraph = localGraphs[selectedGraphIndex] ?? null;
  const feed = gameState.event_engine.narrative_feed ?? [];
  const availableActions = gameState.event_engine.available_actions ?? [];
  const player = ensurePlayerEntity(gameState);
  const playerBiography = player.biography ?? {
    name: "玩家",
    age: 18,
    gender: "未知",
    origin_background: "未设定",
    appearance: ""
  };
  const playerAttributes = player.core_attributes ?? {};
  const playerInventory = player.inventory_system ?? [];
  const ruleCount = React.useMemo(() => summarizeRuleCount(localGraphs), [localGraphs]);
  const chunkClusters = React.useMemo(() => buildChunkClusters(allChunks, localGraphs), [allChunks, localGraphs]);
  const fullParsePayload = React.useMemo(
    () => ({
      chunks: allChunks,
      baseline_context: baselineContext,
      chunk_id_prefix: sourceFileName,
      start_chapter_index: 1
    }),
    [allChunks, baselineContext, sourceFileName]
  );
  const totalChunkChars = React.useMemo(() => allChunks.reduce((sum, item) => sum + item.length, 0), [allChunks]);
  const fullParsePayloadBytes = React.useMemo(
    () => new TextEncoder().encode(JSON.stringify(fullParsePayload)).byteLength,
    [fullParsePayload]
  );
  const selectedCluster =
    chunkClusters.find((cluster) => cluster.id === selectedClusterId) ?? chunkClusters[0] ?? null;
  const visualSourceSummary = React.useMemo(() => {
    const worldEvents = gameState.world_state.world_events ?? [];
    const eventSummary = worldEvents.slice(0, 8).join("；");
    const graphSummary = localGraphs
      .slice(0, 6)
      .map((graph) => graph.metadata?.brief_summary ?? "")
      .filter(Boolean)
      .join("；");
    return [sourceFileName, baselineContext, graphSummary, eventSummary].filter(Boolean).join("；").slice(0, 1200);
  }, [baselineContext, gameState.world_state.world_events, localGraphs, sourceFileName]);
  const parsedCardActs = React.useMemo(() => parseGameCardActs(gameCardMarkdown), [gameCardMarkdown]);
  const factionCallRules = React.useMemo(() => parseFactionCallRulesFromMarkdown(gameCardMarkdown), [gameCardMarkdown]);
  const availableActionViews = React.useMemo(
    () =>
      availableActions.map((action) => {
        const rawText =
          typeof action.prompt_text === "string" && action.prompt_text.trim().length > 0 ? action.prompt_text : action.action_id;
        const resolved = resolveActionTextAndFactionEffects(rawText, factionCallRules);
        const rawActionConditions = (action as { conditions?: unknown }).conditions;
        const actionConditions = Array.isArray(rawActionConditions)
          ? rawActionConditions.map((item) => String(item).trim()).filter(Boolean)
          : [];
        const mergedConditions = unique([...resolved.conditions, ...actionConditions]);
        const conditionResult = evaluateFactionConditions(gameState, mergedConditions);
        return {
          ...action,
          rawText,
          displayText: resolved.cleanText,
          factionEffects: resolved.effects,
          factionConditions: mergedConditions,
          conditionPassed: conditionResult.pass,
          unmetConditions: conditionResult.unmetConditions
        };
      }),
    [availableActions, factionCallRules, gameState]
  );
  const selectedCardAct = parsedCardActs.find((act) => act.id === selectedCardActId) ?? parsedCardActs[0] ?? null;
  const selectedCardEvent =
    selectedCardAct?.events.find((event) => event.id === selectedCardEventId) ?? selectedCardAct?.events[0] ?? null;
  const selectedCardEventScenes = selectedCardEvent?.keyScenes ?? selectedCardAct?.keyScenes ?? [];
  const cardTimelineEvents = React.useMemo(
    () =>
      parsedCardActs.flatMap((act, actIdx) =>
        act.events.map((event, eventIdx) => ({
          act,
          event,
          actIdx,
          eventIdx
        }))
      ),
    [parsedCardActs]
  );
  const cardRuntimeProgress = React.useMemo(() => {
    const total = cardTimelineEvents.length;
    if (total === 0) {
      return {
        current: 0,
        total: 0,
        percent: 0,
        label: "尚未识别到可推进事件"
      };
    }

    const cursorIndex =
      cardRuntimeCursor
        ? cardTimelineEvents.findIndex(
            (item) => item.act.id === cardRuntimeCursor.actId && item.event.id === cardRuntimeCursor.eventId
          )
        : -1;
    const current = cursorIndex >= 0 ? cursorIndex + 1 : cardRuntimeEnabled ? 1 : 0;
    const currentNode = cursorIndex >= 0 ? cardTimelineEvents[cursorIndex] : null;
    const label = currentNode
      ? `${currentNode.act.title} · ${currentNode.event.title}`
      : cardRuntimeEnabled
        ? "游戏卡推演进行中"
        : "尚未开始游戏卡推演";

    return {
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
      label
    };
  }, [cardRuntimeCursor, cardRuntimeEnabled, cardTimelineEvents]);
  const filteredMaterials = React.useMemo(
    () => (materialFilter === "ALL" ? materialLibrary : materialLibrary.filter((item) => item.kind === materialFilter)),
    [materialFilter, materialLibrary]
  );
  const visualStylePresets = React.useMemo(() => dynamicStylePresets, [dynamicStylePresets]);
  const selectedVisualPreset =
    visualStylePresets.find((preset) => preset.id === selectedVisualPresetId) ?? visualStylePresets[0] ?? null;
  const voiceMaterials = React.useMemo(
    () => materialLibrary.filter((item) => item.kind === "VOICE"),
    [materialLibrary]
  );
  const selectedVoiceMaterial = voiceMaterials.find((item) => item.id === selectedVoiceMaterialId) ?? null;
  const workflowStep: WorkflowStep = rightTab === "guide" ? guideStage : rightTab === "debug" ? 3 : 4;
  const runtimeSurfaceVisible = cardRuntimeEnabled || mitaEnabled;
  const workflowGateState = React.useMemo<WorkflowGateState>(() => {
    const uploaded = sourceFileName !== "未上传小说" && allChunks.length > 0;
    const step1Ready = uploaded;
    const step2Ready = step1Ready && localGraphs.length > 0 && !!reduceResult?.global_state_tree;
    const step3Ready = step2Ready && customizationSaved;
    const step4Ready = step3Ready && gameCardMarkdown.trim().length > 0;
    return {
      step1Ready,
      step2Ready,
      step3Ready,
      step4Ready,
      canFreeNavigate: step4Ready
    };
  }, [
    allChunks.length,
    chunkStrategyConfirmed,
    customizationSaved,
    gameCardMarkdown,
    localGraphs.length,
    reduceResult?.global_state_tree,
    sourceFileName
  ]);
  const workflowStepLocks = React.useMemo<Record<WorkflowStep, string | null>>(
    () => ({
      1: null,
      2: workflowGateState.step1Ready ? null : "请先上传小说并完成切片。",
      3: workflowGateState.step2Ready ? null : "请先完成全局解析（含自动仲裁）。",
      4: workflowGateState.step3Ready ? null : "请先保存风格与人物定制。"
    }),
    [workflowGateState.step1Ready, workflowGateState.step2Ready, workflowGateState.step3Ready]
  );
  const nextStepLockReason =
    workflowStep < 4 ? workflowStepLocks[(workflowStep + 1) as WorkflowStep] : null;
  const globalStateTree = reduceResult?.global_state_tree;
  const rpgGlobalAttributes = React.useMemo(() => {
    const fromBackend = Array.isArray(globalStateTree?.global_attributes) ? globalStateTree.global_attributes : [];
    const normalized = fromBackend
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const key = String((item as { key?: unknown }).key ?? "").trim();
        const name = String((item as { name?: unknown }).name ?? key).trim();
        if (!key) {
          return null;
        }
        return { key, name: name || key };
      })
      .filter((item): item is { key: string; name: string } => !!item);

    if (normalized.length > 0) {
      return normalized;
    }
    return Object.entries(playerAttributes).map(([key, attr]) => ({
      key,
      name: attr.description || key
    }));
  }, [globalStateTree?.global_attributes, playerAttributes]);

  const characterStatsMap = React.useMemo(() => {
    const stats = globalStateTree?.character_stats;
    const out: Record<string, Record<string, number>> = {};
    if (stats && typeof stats === "object") {
      Object.entries(stats).forEach(([entityId, item]) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const row: Record<string, number> = {};
        Object.entries(item as Record<string, unknown>).forEach(([key, value]) => {
          const n = Number(value);
          if (Number.isFinite(n)) {
            row[key] = clamp(n, 0, 100);
          }
        });
        out[entityId] = row;
      });
    }

    const attributeKeys =
      (Array.isArray(globalStateTree?.global_attributes)
        ? globalStateTree.global_attributes
            .map((item) =>
              item && typeof item === "object" && !Array.isArray(item)
                ? String((item as { key?: unknown }).key ?? "").trim()
                : ""
            )
            .filter(Boolean)
        : []) ?? [];
    const entityRows =
      globalStateTree?.entities && typeof globalStateTree.entities === "object" ? globalStateTree.entities : {};
    Object.entries(entityRows).forEach(([entityId, entity]) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        return;
      }
      const components = (entity as { components?: unknown }).components;
      if (!components || typeof components !== "object" || Array.isArray(components)) {
        return;
      }
      const componentStats = pickAttributeStatsFromComponents(components as Record<string, unknown>, attributeKeys);
      if (Object.keys(componentStats).length === 0) {
        return;
      }
      out[entityId] = {
        ...(out[entityId] ?? {}),
        ...componentStats
      };
    });
    return out;
  }, [globalStateTree?.character_stats, globalStateTree?.entities, globalStateTree?.global_attributes]);

  const characterInventoryMap = React.useMemo(() => {
    const out: Record<string, NonNullable<FrontendGameState["player_entity"]>["inventory_system"]> = {};
    const entities = globalStateTree?.entities;
    if (!entities || typeof entities !== "object") {
      return out;
    }
    Object.entries(entities).forEach(([entityId, entity]) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        return;
      }
      const components = (entity as { components?: unknown }).components;
      if (!components || typeof components !== "object" || Array.isArray(components)) {
        return;
      }
      const items = pickInventoryFromComponents(components as Record<string, unknown>);
      if (items.length > 0) {
        out[entityId] = items;
      }
    });
    return out;
  }, [globalStateTree?.entities]);

  const coreCharacterOptions = React.useMemo(() => {
    const entityBioById = new Map<string, { name?: string; biography?: string; appearance?: string }>();
    if (globalStateTree?.entities && typeof globalStateTree.entities === "object") {
      Object.entries(globalStateTree.entities).forEach(([entityId, entity]) => {
        if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
          return;
        }
        const row = entity as {
          display_name?: unknown;
          name?: unknown;
          components?: unknown;
        };
        const components =
          row.components && typeof row.components === "object" && !Array.isArray(row.components)
            ? (row.components as Record<string, unknown>)
            : {};
        const biography = pickPlayerBioFromComponents(components);
        const appearance = pickAppearanceFromComponents(components);
        const name = String(row.display_name ?? row.name ?? entityId).trim();
        entityBioById.set(entityId, {
          name: name || entityId,
          ...(biography ? { biography } : {}),
          ...(appearance ? { appearance } : {})
        });
      });
    }

    const fromBackend = Array.isArray(globalStateTree?.core_characters) ? globalStateTree.core_characters : [];
    const merged = new Map<string, CharacterOption>();
    fromBackend.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const entityId = String((item as { entity_id?: unknown }).entity_id ?? "").trim();
      if (!entityId) {
        return;
      }
      const entityFallback = entityBioById.get(entityId);
      const biographyRaw = String(
        (item as { biography?: unknown; origin_background?: unknown; profile?: unknown }).biography ??
          (item as { origin_background?: unknown }).origin_background ??
          (item as { profile?: unknown }).profile ??
          ""
      ).trim();
      const appearanceRaw = String(
        (item as { appearance?: unknown; looks?: unknown; visual_profile?: unknown }).appearance ??
          (item as { looks?: unknown }).looks ??
          (item as { visual_profile?: unknown }).visual_profile ??
          ""
      ).trim();
      merged.set(entityId, {
        entity_id: entityId,
        name: String((item as { name?: unknown }).name ?? entityFallback?.name ?? entityId),
        ...(biographyRaw || entityFallback?.biography ? { biography: biographyRaw || entityFallback?.biography || "" } : {}),
        ...(appearanceRaw || entityFallback?.appearance ? { appearance: appearanceRaw || entityFallback?.appearance || "" } : {})
      });
    });

    const normalized: CharacterOption[] = Array.from(merged.values())
      .map((item): CharacterOption | null => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const entityId = String((item as { entity_id?: unknown }).entity_id ?? "").trim();
        if (!entityId) {
          return null;
        }
        const biography = String((item as { biography?: unknown }).biography ?? "").trim();
        const appearance = String((item as { appearance?: unknown }).appearance ?? "").trim();
        return {
          entity_id: entityId,
          name: String((item as { name?: unknown }).name ?? entityId),
          ...(biography ? { biography } : {}),
          ...(appearance ? { appearance } : {})
        };
      })
      .filter((item): item is CharacterOption => item !== null);

    if (normalized.length > 0) {
      return normalized;
    }

    return Object.keys(characterStatsMap).map((entityId) => {
      const fromEntity = globalStateTree?.entities?.[entityId];
      const profile = entityBioById.get(entityId);
      const biography = profile?.biography ?? (fromEntity?.components ? pickPlayerBioFromComponents(fromEntity.components) : "");
      const appearance = profile?.appearance ?? (fromEntity?.components ? pickAppearanceFromComponents(fromEntity.components) : "");
      return {
        entity_id: entityId,
        name: profile?.name || fromEntity?.display_name || entityId,
        ...(biography ? { biography } : {}),
        ...(appearance ? { appearance } : {})
      };
    });
  }, [characterStatsMap, globalStateTree?.core_characters, globalStateTree?.entities]);

  const customRecommendedStats = React.useMemo(() => {
    const fromBackend = globalStateTree?.custom_character_recommendation;
    const rec: Record<string, number> = {};
    rpgGlobalAttributes.forEach((attribute) => {
      const fromApi = Number((fromBackend as Record<string, unknown> | undefined)?.[attribute.key]);
      if (Number.isFinite(fromApi)) {
        rec[attribute.key] = clamp(fromApi, 0, 100);
        return;
      }

      const values = Object.values(characterStatsMap)
        .map((row) => row[attribute.key])
        .filter((value): value is number => Number.isFinite(value));
      if (values.length === 0) {
        rec[attribute.key] = 50;
      } else {
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        rec[attribute.key] = clamp(avg, 0, 100);
      }
    });
    return rec;
  }, [characterStatsMap, globalStateTree?.custom_character_recommendation, rpgGlobalAttributes]);

  const portraitCharacterOptions = React.useMemo(() => {
    if (coreCharacterOptions.length > 0) {
      return coreCharacterOptions;
    }
    return [
      {
        entity_id: CUSTOM_CHARACTER_OPTION,
        name: playerBiography.name || "当前玩家角色",
        biography: playerBiography.origin_background || "",
        appearance: playerBiography.appearance || ""
      } satisfies CharacterOption
    ];
  }, [coreCharacterOptions, playerBiography.appearance, playerBiography.name, playerBiography.origin_background]);

  const selectedPortraitCharacter =
    portraitCharacterOptions.find((item) => item.entity_id === selectedPortraitCharacterId) ??
    portraitCharacterOptions[0] ??
    null;
  const selectedPortraitPrompt = selectedPortraitCharacter ? characterPromptDraftMap[selectedPortraitCharacter.entity_id] ?? "" : "";
  const selectedPortraitPreview = selectedPortraitCharacter ? characterPreviewMap[selectedPortraitCharacter.entity_id] : undefined;
  const selectedPortraitReferenceImage = selectedPortraitCharacter
    ? characterReferenceImageMap[selectedPortraitCharacter.entity_id] ?? ""
    : "";
  const activeVoiceDraft = React.useMemo(() => {
    const candidateId =
      selectedCharacterId && selectedCharacterId !== CUSTOM_CHARACTER_OPTION
        ? selectedCharacterId
        : selectedPortraitCharacter?.entity_id ?? "";
    if (!candidateId) {
      return null;
    }
    const byCharacter = characterVoiceDraftMap[candidateId];
    if (byCharacter) {
      return byCharacter;
    }
    if (selectedVoiceMaterialId || voicePrompt.trim()) {
      return {
        mode: voiceMode,
        material_id: selectedVoiceMaterialId,
        prompt: voicePrompt
      } satisfies CharacterVoiceDraft;
    }
    return null;
  }, [
    characterVoiceDraftMap,
    selectedCharacterId,
    selectedPortraitCharacter?.entity_id,
    selectedVoiceMaterialId,
    voiceMode,
    voicePrompt
  ]);
  const activeVoiceProfilePayload =
    activeVoiceDraft && (activeVoiceDraft.material_id || activeVoiceDraft.prompt.trim())
      ? {
          mode: activeVoiceDraft.mode,
          material_id: activeVoiceDraft.material_id || null,
          prompt: activeVoiceDraft.prompt.trim() || null,
          gateway: voiceGatewayConfig
        }
      : undefined;

  const isCustomCharacter = selectedCharacterId === CUSTOM_CHARACTER_OPTION;
  const goToWorkflowStep = React.useCallback(
    (step: WorkflowStep) => {
      if (!workflowGateState.canFreeNavigate && step < workflowStep) {
        setApiError("当前为严格门控流程：完成步骤 4 后才允许自由回退。");
        return;
      }

      if (step > workflowStep + 1 && !workflowGateState.canFreeNavigate) {
        setApiError("当前步骤不可跳过，请按顺序推进。");
        return;
      }

      if (workflowStep === 3 && step >= 4 && !customizationSaved && workflowGateState.step2Ready) {
        const shouldApply = window.confirm("检测到第三步有未应用修改。是否先应用当前修改再继续？");
        if (!shouldApply) {
          setApiError("已取消跳转。请先点击“应用当前修改”。");
          return;
        }
        applyCustomizationRef.current?.();
        if (step === 4) {
          setApiError(null);
          setRightTab("card");
          return;
        }
      }

      const lockReason = workflowStepLocks[step];
      if (lockReason) {
        setApiError(lockReason);
        return;
      }

      setApiError(null);
      if (step === 1 || step === 2) {
        setGuideStage(step);
        setRightTab("guide");
        return;
      }
      if (step === 3) {
        setRightTab("debug");
        return;
      }
      setRightTab("card");
    },
    [customizationSaved, workflowGateState.canFreeNavigate, workflowGateState.step2Ready, workflowStep, workflowStepLocks]
  );

  React.useEffect(() => {
    setJsonDraft(JSON.stringify(gameState, null, 2));
  }, [gameState]);

  React.useEffect(() => {
    if (!selectedVisualPresetId && visualStylePresets.length > 0) {
      setSelectedVisualPresetId(visualStylePresets[0].id);
      return;
    }
    if (selectedVisualPresetId && !visualStylePresets.some((preset) => preset.id === selectedVisualPresetId)) {
      setSelectedVisualPresetId(visualStylePresets[0]?.id ?? "");
    }
  }, [selectedVisualPresetId, visualStylePresets]);

  React.useEffect(() => {
    if (portraitCharacterOptions.length === 0) {
      if (selectedPortraitCharacterId) {
        setSelectedPortraitCharacterId("");
      }
      return;
    }

    if (!selectedPortraitCharacterId || !portraitCharacterOptions.some((item) => item.entity_id === selectedPortraitCharacterId)) {
      setSelectedPortraitCharacterId(portraitCharacterOptions[0].entity_id);
    }
  }, [portraitCharacterOptions, selectedPortraitCharacterId]);

  React.useEffect(() => {
    if (portraitCharacterOptions.length === 0) {
      return;
    }
    setCharacterPromptDraftMap((prev) => {
      let changed = false;
      const next = { ...prev };
      portraitCharacterOptions.forEach((option) => {
        if (next[option.entity_id]?.trim()) {
          return;
        }
        next[option.entity_id] = buildCharacterPortraitPrompt({
          character: option,
          globalFeaturePrompt: characterFeaturePrompt
        });
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [characterFeaturePrompt, portraitCharacterOptions, selectedVisualPreset]);

  React.useEffect(() => {
    if (portraitCharacterOptions.length === 0) {
      return;
    }
    setCharacterVoiceDraftMap((prev) => {
      let changed = false;
      const next = { ...prev };
      portraitCharacterOptions.forEach((item) => {
        if (next[item.entity_id]) {
          return;
        }
        next[item.entity_id] = {
          mode: "UPLOAD_CLONE",
          material_id: "",
          prompt: DEFAULT_VOICE_PROMPT
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [portraitCharacterOptions]);

  React.useEffect(() => {
    if (!selectedPortraitCharacter) {
      return;
    }
    const draft = characterVoiceDraftMap[selectedPortraitCharacter.entity_id];
    const materialFallback = voiceMaterials[0]?.id ?? "";
    setVoiceMode(draft?.mode ?? "UPLOAD_CLONE");
    setVoicePrompt(draft?.prompt || DEFAULT_VOICE_PROMPT);
    const nextMaterialId = draft?.material_id ?? "";
    if (nextMaterialId && voiceMaterials.some((item) => item.id === nextMaterialId)) {
      setSelectedVoiceMaterialId(nextMaterialId);
    } else {
      setSelectedVoiceMaterialId(materialFallback);
    }
  }, [characterVoiceDraftMap, selectedPortraitCharacter, voiceMaterials]);

  React.useEffect(() => {
    if (!gameCardGenerating) {
      setGameCardLoadingTipIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setGameCardLoadingTipIndex((prev) => (prev + 1) % GAME_CARD_LOADING_TIPS.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [gameCardGenerating]);

  React.useEffect(() => {
    if (availableActions.length === 0) {
      return;
    }
    if (!availableActions.some((action) => action.action_id === turnActionId)) {
      setTurnActionId(availableActions[0].action_id);
    }
  }, [availableActions, turnActionId]);

  React.useEffect(() => {
    if (chunkClusters.length === 0) {
      setSelectedClusterId("");
      return;
    }
    if (!chunkClusters.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(chunkClusters[0].id);
    }
  }, [chunkClusters, selectedClusterId]);

  React.useEffect(() => {
    if (parsedCardActs.length === 0) {
      setSelectedCardActId("");
      setSelectedCardEventId("");
      setSelectedCardScene("");
      return;
    }

    const nextAct = parsedCardActs.find((item) => item.id === selectedCardActId) ?? parsedCardActs[0];
    if (nextAct.id !== selectedCardActId) {
      setSelectedCardActId(nextAct.id);
    }

    const nextEvent = nextAct.events.find((event) => event.id === selectedCardEventId) ?? nextAct.events[0] ?? null;
    if (nextEvent) {
      if (nextEvent.id !== selectedCardEventId) {
        setSelectedCardEventId(nextEvent.id);
      }
      const sceneList = nextEvent.keyScenes.length > 0 ? nextEvent.keyScenes : nextAct.keyScenes;
      const hasSelectedScene = selectedCardScene && sceneList.includes(selectedCardScene);
      if (!hasSelectedScene) {
        const nextScene = sceneList[0] ?? "";
        if (selectedCardScene !== nextScene) {
          setSelectedCardScene(nextScene);
        }
      }
      return;
    }

    if (selectedCardEventId) {
      setSelectedCardEventId("");
    }
    const fallbackScene = nextAct.keyScenes[0] ?? "";
    if (selectedCardScene !== fallbackScene) {
      setSelectedCardScene(fallbackScene);
    }
  }, [parsedCardActs, selectedCardActId, selectedCardEventId, selectedCardScene]);

  React.useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const snapshotId = params.get("snapshot");
    if (!snapshotId) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(`utre_snapshot_${snapshotId}`);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        game_state: FrontendGameState;
        local_graphs: EcsLocalGraph[];
        reduce_result: ReduceConflictResponse | null;
        narrative_archive: string[];
      };

      setGameState(parsed.game_state);
      setLocalGraphs(parsed.local_graphs ?? []);
      setReduceResult(parsed.reduce_result ?? null);
      setWorldlineSelections({});
      setResolutionOverrides({});
      setNarrativeArchive(parsed.narrative_archive ?? []);
      setSourceFileName(`已加载快照 ${snapshotId}`);
      setShareLink(window.location.href);
    } catch {
      // Ignore invalid snapshot payload.
    }
  }, []);

  const appendFeed = React.useCallback((role: "system" | "player" | "ai", content: string, turn?: number) => {
    setGameState((prev) => ({
      ...prev,
      event_engine: {
        ...prev.event_engine,
        narrative_feed: [
          ...(prev.event_engine.narrative_feed ?? []),
          {
            id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            turn: turn ?? prev.world_state.current_turn,
            role,
            content
          }
        ]
      }
    }));
  }, []);

  const applyCharacterSelection = React.useCallback(
    (characterId: string) => {
      setSelectedCharacterId(characterId);
      setGameState((prev) => {
        const nextPlayer = ensurePlayerEntity(prev);
        const currentBio = nextPlayer.biography ?? {
          name: "玩家",
          age: 18,
          gender: "未知",
          origin_background: "未设定",
          appearance: ""
        };

        if (characterId === CUSTOM_CHARACTER_OPTION) {
          return {
            ...prev,
            player_entity: {
              ...nextPlayer,
              biography: {
                ...currentBio,
                name: currentBio.name === "玩家" ? "" : currentBio.name,
                origin_background: currentBio.origin_background === "未设定" ? "" : currentBio.origin_background,
                appearance: ""
              },
              core_attributes: buildCoreAttributesByTemplate(rpgGlobalAttributes, customRecommendedStats, nextPlayer.core_attributes ?? {})
            }
          };
        }

        const selected = coreCharacterOptions.find((item) => item.entity_id === characterId);
        const roleStats = characterStatsMap[characterId] ?? customRecommendedStats;
        const roleInventory = characterInventoryMap[characterId] ?? [];
        const fallbackBio = currentBio.origin_background === "待从小说中提取" ? "" : currentBio.origin_background;
        return {
          ...prev,
          player_entity: {
            ...nextPlayer,
            biography: {
              ...currentBio,
              name: selected?.name || currentBio.name,
              origin_background: selected?.biography || fallbackBio || currentBio.origin_background,
              appearance: selected?.appearance ?? currentBio.appearance ?? ""
            },
            core_attributes: buildCoreAttributesByTemplate(rpgGlobalAttributes, roleStats, nextPlayer.core_attributes ?? {}),
            inventory_system: roleInventory
          }
        };
      });
    },
    [characterInventoryMap, characterStatsMap, coreCharacterOptions, customRecommendedStats, rpgGlobalAttributes]
  );

  React.useEffect(() => {
    if (coreCharacterOptions.length === 0) {
      return;
    }
    const hasSelectedCoreCharacter = coreCharacterOptions.some((item) => item.entity_id === selectedCharacterId);
    if (!hasSelectedCoreCharacter) {
      applyCharacterSelection(coreCharacterOptions[0].entity_id);
      return;
    }

    // 默认初始是“自定义角色”，这里在检测到仍为占位信息时自动切到首个已解析角色，
    // 避免步骤三看起来像“没有解析出传记/数值”。
    if (selectedCharacterId === CUSTOM_CHARACTER_OPTION) {
      const bio = (playerBiography.origin_background ?? "").trim();
      const name = (playerBiography.name ?? "").trim();
      const isPlaceholderBio = !bio || bio === "待从小说中提取" || bio === "未设定";
      const isPlaceholderName = !name || name === "玩家";
      if (isPlaceholderBio && isPlaceholderName) {
        applyCharacterSelection(coreCharacterOptions[0].entity_id);
      }
      return;
    }

    if (!hasSelectedCoreCharacter) {
      applyCharacterSelection(coreCharacterOptions[0].entity_id);
    }
  }, [
    applyCharacterSelection,
    coreCharacterOptions,
    playerBiography.name,
    playerBiography.origin_background,
    selectedCharacterId
  ]);

  React.useEffect(() => {
    if (!globalStateTree || rpgGlobalAttributes.length === 0) {
      return;
    }

    if (selectedCharacterId === CUSTOM_CHARACTER_OPTION) {
      setGameState((prev) => {
        const nextPlayer = ensurePlayerEntity(prev);
        return {
          ...prev,
          player_entity: {
            ...nextPlayer,
            core_attributes: buildCoreAttributesByTemplate(rpgGlobalAttributes, customRecommendedStats, nextPlayer.core_attributes ?? {})
          }
        };
      });
      return;
    }

    const selected = coreCharacterOptions.find((item) => item.entity_id === selectedCharacterId);
    if (!selected) {
      return;
    }
    const roleStats = characterStatsMap[selectedCharacterId] ?? customRecommendedStats;
    const roleInventory = characterInventoryMap[selectedCharacterId] ?? [];
    setGameState((prev) => {
      const nextPlayer = ensurePlayerEntity(prev);
      const currentBio = nextPlayer.biography ?? {
        name: "玩家",
        age: 18,
        gender: "未知",
        origin_background: "未设定",
        appearance: ""
      };
      return {
        ...prev,
        player_entity: {
          ...nextPlayer,
          biography: {
            ...currentBio,
            name: selected.name || currentBio.name,
            origin_background:
              selected.biography ||
              (currentBio.origin_background === "待从小说中提取" ? "" : currentBio.origin_background) ||
              currentBio.origin_background,
            appearance: selected.appearance ?? currentBio.appearance ?? ""
          },
          core_attributes: buildCoreAttributesByTemplate(rpgGlobalAttributes, roleStats, nextPlayer.core_attributes ?? {}),
          inventory_system: roleInventory
        }
      };
    });
  }, [
    characterInventoryMap,
    characterStatsMap,
    coreCharacterOptions,
    customRecommendedStats,
    globalStateTree,
    rpgGlobalAttributes,
    selectedCharacterId
  ]);

  const applyGraphToState = React.useCallback((graph: EcsLocalGraph) => {
    const social = graph.implicit_rules.social_power_relations;
    const ability = graph.implicit_rules.ability_costs;
    const causal = graph.implicit_rules.causal_invariants;
    const eventFacts = graph.assertions.filter((a) => a.category === "FACT").map((a) => a.value);
    const factions = graph.entities.filter((entity) => entity.entity_type === "faction").map((entity) => entity.display_name);

    setGameState((prev) => {
      const prevPlayer = ensurePlayerEntity(prev);
      const mergedEvents = unique([...(prev.world_state.world_events ?? []), ...eventFacts, ...causal]).slice(0, 14);
      const mergedFactions = unique([...(prev.world_state.global_factions ?? []).map((f) => f.name), ...factions]).map((name, idx) => {
        const existing = (prev.world_state.global_factions ?? []).find((f) => f.name === name);
        return (
          existing ?? {
            faction_id: `f_auto_${idx + 1}`,
            name,
            power_level: 50,
            attitude_to_player: 0
          }
        );
      });

      return {
        ...prev,
        player_entity: {
          ...prevPlayer,
          biography: {
            ...(prevPlayer.biography ?? {
              name: "玩家",
              age: 18,
              gender: "未知",
              origin_background: "未设定",
              appearance: ""
            }),
            origin_background:
              social[0] ||
              ability[0] ||
              prevPlayer.biography?.origin_background ||
              "由 AI 从原文推断"
          }
        },
        world_state: {
          ...prev.world_state,
          world_events: mergedEvents,
          global_factions: mergedFactions,
          timeline_anchor: timelineAnchor,
          plot_mode: plotMode
        },
        event_engine: {
          ...prev.event_engine,
          narrative_log: eventFacts[0] || causal[0] || prev.event_engine.narrative_log
        }
      };
    });
  }, [plotMode, timelineAnchor]);

  const maybeOpenDraftWizard = React.useCallback((graphs: EcsLocalGraph[]) => {
    const summary = summarizeRuleCount(graphs);
    const shouldOpen = summary.social < 2 || summary.ability < 1 || summary.causal < 1 || summary.factions < 1;

    if (!shouldOpen) {
      return;
    }

    setWizardAnswers((prev) => ({
      world_rule: prev.world_rule || "这个世界最不能违反的底层规则是？",
      power_cost: prev.power_cost || "角色施展能力时需要付出的代价是？",
      faction_tension: prev.faction_tension || "主要势力之间的核心矛盾是？"
    }));
    setWizardOpen(true);
  }, []);

  const runMapExtract = React.useCallback(
    async (chunkIndex: number) => {
      if (!allChunks[chunkIndex]) {
        return;
      }

      const response = await apiManager.mapExtract({
        chunk_id: `${sourceFileName}-chunk-${chunkIndex + 1}`,
        chapter_index: chunkIndex + 1,
        chunk_text: allChunks[chunkIndex],
        baseline_context: baselineContext
      });

      const graph = response.ecs_local_graph;
      let nextGraphsSnapshot: EcsLocalGraph[] = [];
      setLocalGraphs((prev) => {
        const next = mergeGraph(prev, graph);
        nextGraphsSnapshot = next;
        return next;
      });
      if (nextGraphsSnapshot.length > 0) {
        setSelectedGraphIndex(nextGraphsSnapshot.findIndex((g) => g.chapter_index === graph.chapter_index));
      }

      const mergedRules = unique([
        ...graph.implicit_rules.social_power_relations,
        ...graph.implicit_rules.ability_costs,
        ...graph.implicit_rules.causal_invariants
      ]).join("；");
      if (mergedRules) {
        setBaselineContext(mergedRules.slice(0, 1600));
      }

      applyGraphToState(graph);
      maybeOpenDraftWizard(nextGraphsSnapshot);
      appendFeed(
        "system",
        `切片 ${chunkIndex + 1} 提取完成：实体 ${graph.entities.length}，断言 ${graph.assertions.length}，隐性规则 ${
          graph.implicit_rules.social_power_relations.length +
          graph.implicit_rules.ability_costs.length +
          graph.implicit_rules.causal_invariants.length
        } 条。`
      );
    },
    [allChunks, appendFeed, applyGraphToState, baselineContext, maybeOpenDraftWizard, sourceFileName]
  );

  const getVisualSourceSummary = React.useCallback(() => {
    return visualSourceSummary;
  }, [visualSourceSummary]);

  const onRecommendVisualStylePresets = React.useCallback(async () => {
    if (!workflowGateState.step2Ready) {
      return;
    }
    setStylePresetLoading(true);
    setStylePresetError(null);
    try {
      const response = await visualGenService.recommendStylePresets({
        genre: gameState.genre_metadata?.genre ?? "通用题材",
        source_summary: getVisualSourceSummary(),
        source_file_name: sourceFileName
      });
      const normalized: VisualStylePreset[] = [];
      response.presets.forEach((item, idx) => {
        if (normalized.length >= 4) {
          return;
        }
        const name = String(item.name ?? "").trim();
        const themeStyle = String(item.themeStyle ?? "").trim();
        const tone = String(item.tone ?? "").trim();
        const palette = String(item.palette ?? "").trim();
        const promptHint = String(item.promptHint ?? "").trim();
        const originReason = String(item.originReason ?? "").trim();
        if (!name || !themeStyle || !tone || !palette || !promptHint) {
          return;
        }
        normalized.push({
          id: `llm-${idx + 1}`,
          name,
          themeStyle,
          tone,
          palette,
          promptHint,
          source: "NOVEL_ANALYZED",
          originReason: originReason || "由小说内容自动推断。"
        });
      });
      if (normalized.length === 4) {
        setDynamicStylePresets(normalized);
        setSelectedVisualPresetId((prev) => prev || normalized[0].id);
        return;
      }
      throw new Error("动态风格预设生成结果不完整。");
    } catch (error) {
      setDynamicStylePresets([]);
      setStylePresetError(error instanceof Error ? error.message : "动态风格预设生成失败");
    } finally {
      setStylePresetLoading(false);
    }
  }, [gameState.genre_metadata?.genre, getVisualSourceSummary, sourceFileName, workflowGateState.step2Ready]);

  const onGenerateStylePreview = React.useCallback(
    async (preset: VisualStylePreset, options?: { force?: boolean; markAsAuto?: boolean }) => {
      const existing = stylePreviewMap[preset.id];
      if (!options?.force && (existing?.status === "ready" || existing?.status === "loading")) {
        return;
      }
      setStylePreviewMap((prev) => ({
        ...prev,
        [preset.id]: {
          ...(prev[preset.id] ?? {}),
          status: "loading",
          error: undefined
        }
      }));

      try {
        const result = await visualGenService.generateStylePreview({
          style_name: preset.name,
          style_prompt: composeVisualStylePrompt(preset, customStylePrompt),
          genre: gameState.genre_metadata?.genre ?? "通用题材",
          source_summary: getVisualSourceSummary(),
          aspect_ratio: "16:9"
        });
        setStylePreviewMap((prev) => ({
          ...prev,
          [preset.id]: {
            status: "ready",
            imageUrl: result.image_url,
            prompt: result.prompt
          }
        }));
        if (options?.markAsAuto) {
          setAutoRecommendedStyleId(preset.id);
        }
      } catch (error) {
        setStylePreviewMap((prev) => ({
          ...prev,
          [preset.id]: {
            ...(prev[preset.id] ?? {}),
            status: "error",
            error: error instanceof Error ? error.message : "生成失败"
          }
        }));
      }
    },
    [customStylePrompt, gameState.genre_metadata?.genre, getVisualSourceSummary, stylePreviewMap]
  );

  const onUploadCharacterReferenceImage = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !selectedPortraitCharacter) {
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("角色参考图读取失败"));
          reader.readAsDataURL(file);
        });
        setCharacterReferenceImageMap((prev) => ({
          ...prev,
          [selectedPortraitCharacter.entity_id]: dataUrl
        }));
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "角色参考图读取失败");
      } finally {
        event.target.value = "";
      }
    },
    [selectedPortraitCharacter]
  );

  const onGenerateCharacterRestyle = React.useCallback(async () => {
    if (!selectedVisualPreset) {
      setApiError("请先选择一个画风预设。");
      return;
    }
    if (!selectedPortraitCharacter) {
      setApiError("请先选择一个角色。");
      return;
    }

    const characterId = selectedPortraitCharacter.entity_id;
    const stylePreviewPrompt = stylePreviewMap[selectedVisualPreset.id]?.prompt ?? "";
    const promptDraft =
      characterPromptDraftMap[characterId]?.trim() ||
      buildCharacterPortraitPrompt({
        character: selectedPortraitCharacter,
        globalFeaturePrompt: characterFeaturePrompt
      });

    setApiError(null);
    setCharacterPreviewMap((prev) => ({
      ...prev,
      [characterId]: {
        ...(prev[characterId] ?? {}),
        status: "loading",
        error: undefined
      }
    }));
    try {
      const strongStylePrompt = [
        `严格沿用风格预设「${selectedVisualPreset.name}」`,
        `画面基调：${selectedVisualPreset.tone}`,
        `色彩方案：${selectedVisualPreset.palette}`,
        buildCharacterStylePrompt(selectedVisualPreset),
        stylePreviewPrompt ? `风格样张提示词参考：${stylePreviewPrompt}` : "",
        customStylePrompt.trim() ? `创作者补充风格：${customStylePrompt.trim()}` : "",
        "人物画风必须与当前风格预设一致，不可偏离到其他流派"
      ]
        .filter(Boolean)
        .join("；");
      const response = await visualGenService.restyleCharacter({
        style_prompt: strongStylePrompt,
        style_name: selectedVisualPreset.name,
        style_tone: selectedVisualPreset.tone,
        style_palette: selectedVisualPreset.palette,
        character_prompt: promptDraft,
        reference_image_data_url: characterReferenceImageMap[characterId] || undefined,
        aspect_ratio: "3:4"
      });
      setCharacterPreviewMap((prev) => ({
        ...prev,
        [characterId]: {
          status: "ready",
          imageUrl: response.image_url,
          prompt: response.prompt
        }
      }));
    } catch (error) {
      setCharacterPreviewMap((prev) => ({
        ...prev,
        [characterId]: {
          ...(prev[characterId] ?? {}),
          status: "error",
          error: error instanceof Error ? error.message : "人物重绘失败"
        }
      }));
    }
  }, [
    characterFeaturePrompt,
    characterPromptDraftMap,
    characterReferenceImageMap,
    customStylePrompt,
    stylePreviewMap,
    selectedPortraitCharacter,
    selectedVisualPreset
  ]);

  const updateSelectedCharacterVoiceDraft = React.useCallback(
    (patch: Partial<CharacterVoiceDraft>) => {
      if (!selectedPortraitCharacter) {
        return;
      }
      const characterId = selectedPortraitCharacter.entity_id;
      setCharacterVoiceDraftMap((prev) => {
        const base = prev[characterId] ?? {
          mode: "UPLOAD_CLONE",
          material_id: "",
          prompt: DEFAULT_VOICE_PROMPT
        };
        return {
          ...prev,
          [characterId]: {
            ...base,
            ...patch
          }
        };
      });
      setCustomizationSaved(false);
    },
    [selectedPortraitCharacter]
  );

  React.useEffect(() => {
    if (!workflowGateState.step2Ready || stylePresetLoading) {
      return;
    }
    if (dynamicStylePresets.length === 4) {
      return;
    }
    void onRecommendVisualStylePresets();
  }, [dynamicStylePresets.length, onRecommendVisualStylePresets, stylePresetLoading, workflowGateState.step2Ready]);

  React.useEffect(() => {
    if (!workflowGateState.step2Ready || visualStylePresets.length === 0) {
      return;
    }
    const contextText = getVisualSourceSummary();
    const target = pickRecommendedStylePreset(visualStylePresets, contextText) ?? visualStylePresets[0];
    if (!target) {
      return;
    }
    if (!selectedVisualPresetId) {
      setSelectedVisualPresetId(target.id);
    }
    if (stylePreviewMap[target.id]?.status === "ready" || stylePreviewMap[target.id]?.status === "loading") {
      if (!autoRecommendedStyleId) {
        setAutoRecommendedStyleId(target.id);
      }
      return;
    }
    void onGenerateStylePreview(target, { markAsAuto: true });
  }, [
    autoRecommendedStyleId,
    dynamicStylePresets.length,
    getVisualSourceSummary,
    onGenerateStylePreview,
    onRecommendVisualStylePresets,
    selectedVisualPresetId,
    stylePreviewMap,
    visualStylePresets,
    workflowGateState.step2Ready
  ]);

  const resetForNewUpload = React.useCallback(() => {
    setSelectedChunkIndex(0);
    setTimelineAnchor(1);
    setLocalGraphs([]);
    setReduceResult(null);
    setFullParseJob(null);
    setSelectedCharacterId(CUSTOM_CHARACTER_OPTION);
    setResolutionDrawerOpen(false);
    setWorldlineSelections({});
    setResolutionOverrides({});
    setLastTurnResult(null);
    setSelectedClusterId("");
    setCustomActionText("");
    setBaselineContext("");
    setGameCardMarkdown("");
    setGameCardReferenceMarkdown("");
    setGameCardGenerating(false);
    setCustomizationSaved(false);
    setDynamicStylePresets([]);
    setStylePresetLoading(false);
    setStylePresetError(null);
    setStylePreviewMap({});
    setAutoRecommendedStyleId("");
    setCustomStylePrompt("");
    setSelectedPortraitCharacterId("");
    setCharacterPromptDraftMap({});
    setCharacterPreviewMap({});
    setCharacterReferenceImageMap({});
    setCharacterVoiceDraftMap({});
    setVoiceMode("UPLOAD_CLONE");
    setSelectedVoiceMaterialId("");
    setVoicePrompt(DEFAULT_VOICE_PROMPT);
    setWaitingCardStart(false);
    setCardRuntimeEnabled(false);
    setCardRuntimeCursor(null);
    setSelectedCardActId("");
    setSelectedCardEventId("");
    setSelectedCardScene("");
    setMitaEnabled(false);
    setMitaHistory([]);
    setMitaInput("");
    setLeftPanelMode("play");
    setGuideStage(1);
    setRightTab("guide");
    setSidebarOpen(false);
  }, []);

  const handleNovelUpload = React.useCallback(
    async (file: File) => {
      setLoading((prev) => ({ ...prev, upload: true }));
      setApiError(null);
      try {
        const rawText = await parseNovelFile(file);
        const chunks = splitTextToChunks(rawText, chunkSize);
        if (chunks.length === 0) {
          throw new Error("上传内容为空，无法切片。");
        }
        setSourceFileName(file.name);
        setSourceRawText(rawText);
        setAllChunks(chunks);
        setChunkStrategyConfirmed(true);
        resetForNewUpload();
        appendFeed("system", `文件 ${file.name} 上传成功。当前切片 ${chunks.length}，可继续调节切片长度后再执行一键全局解析。`);
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "文件上传失败");
      } finally {
        setLoading((prev) => ({ ...prev, upload: false }));
      }
    },
    [appendFeed, chunkSize, resetForNewUpload]
  );

  const onUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    await handleNovelUpload(file);
    event.target.value = "";
  };

  const onDropUploadFile = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setUploadDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }
    await handleNovelUpload(file);
  };

  const onAdjustChunkSizeBeforeParse = React.useCallback(
    (nextSize: number) => {
      const safe = clamp(Math.floor(nextSize), 1200, 40000);
      setChunkSize(safe);
      setChunkStrategyConfirmed(true);
      if (!sourceRawText.trim()) {
        return;
      }
      const chunks = splitTextToChunks(sourceRawText, safe);
      setAllChunks(chunks);
      setSelectedChunkIndex(0);
      if (localGraphs.length > 0 || reduceResult || fullParseJob) {
        setLocalGraphs([]);
        setReduceResult(null);
        setFullParseJob(null);
        setGameCardMarkdown("");
        setGameCardReferenceMarkdown("");
        appendFeed("system", `切片长度已调整为 ${safe}，解析结果已清空，请重新执行一键全局解析。`);
      }
    },
    [appendFeed, fullParseJob, localGraphs.length, reduceResult, sourceRawText]
  );

  const stopAudioPreview = React.useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setAudioNowPlaying(null);
  }, []);

  const findMaterialAudioByName = React.useCallback(
    (trackName: string): MaterialAssetItem | null => {
      const normalize = (name: string): { full: string; base: string } => {
        const cleaned = name.trim().replace(/^["'`]|["'`]$/g, "");
        const slashNormalized = cleaned.replace(/\\/g, "/");
        const filename = slashNormalized.split("/").pop() || slashNormalized;
        const full = slashNormalized.toLowerCase();
        const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
        return { full, base };
      };
      const normalized = normalize(trackName);
      if (!normalized.full) {
        return null;
      }
      return (
        materialLibrary.find((item) => {
          if (item.kind !== "BGM" && item.kind !== "SFX") {
            return false;
          }
          const itemNorm = normalize(item.name);
          return (
            itemNorm.full === normalized.full ||
            itemNorm.base === normalized.base ||
            itemNorm.full.endsWith(`/${normalized.full}`) ||
            normalized.full.endsWith(`/${itemNorm.full}`)
          );
        }) ?? null
      );
    },
    [materialLibrary]
  );

  const playAudioPreview = React.useCallback(
    async (item: MaterialAssetItem, loop: boolean) => {
      try {
        stopAudioPreview();
        const audio = new Audio(item.url);
        audio.loop = loop;
        audioRef.current = audio;
        audio.onended = () => {
          if (!audio.loop) {
            setAudioNowPlaying(null);
          }
        };
        await audio.play();
        setAudioNowPlaying({
          materialId: item.id,
          name: item.name,
          kind: item.kind === "BGM" ? "BGM" : item.kind === "VOICE" ? "VOICE" : "SFX"
        });
      } catch {
        setApiError(`素材 ${item.name} 播放失败，请检查浏览器音频权限。`);
      }
    },
    [stopAudioPreview]
  );

  const onPreviewMaterialAudio = React.useCallback(
    async (item: MaterialAssetItem) => {
      if (item.kind !== "BGM" && item.kind !== "SFX" && item.kind !== "VOICE") {
        return;
      }
      if (audioNowPlaying?.materialId === item.id) {
        stopAudioPreview();
        return;
      }
      await playAudioPreview(item, item.kind === "BGM");
    },
    [audioNowPlaying?.materialId, playAudioPreview, stopAudioPreview]
  );

  const playFactionAudioByEffects = React.useCallback(
    async (effects: FactionCallEffect[]) => {
      for (const effect of effects) {
        if (effect.kind !== "BGM" && effect.kind !== "SFX") {
          continue;
        }
        const trackName = parseFactionAudioTrackName(effect.value);
        const material = findMaterialAudioByName(trackName);
        if (!material) {
          continue;
        }
        await playAudioPreview(material, effect.kind === "BGM");
      }
    },
    [findMaterialAudioByName, playAudioPreview]
  );

  const onUploadMaterials = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const created: MaterialAssetItem[] = files.map((file) => {
      const id = `material-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      return {
        id,
        name: file.name,
        kind: parseMaterialKind(file),
        mime: file.type || "application/octet-stream",
        size: file.size,
        url: URL.createObjectURL(file),
        uploadedAt: Date.now()
      };
    });

    setMaterialLibrary((prev) => [...created, ...prev]);
    setMaterialFilter("ALL");
    setGameState((prev) => {
      const nextBgmTracks = [...(prev.media_assets.bgm_tracks ?? [])];
      const nextPortraits = { ...(prev.media_assets.character_portraits ?? {}) };
      let nextIntro = prev.media_assets.intro_cinematic;
      let nextEnding = prev.media_assets.ending_cinematic;

      created.forEach((item) => {
        const mediaAsset = makeMaterialToMediaAsset(item);
        if (item.kind === "BGM" || item.kind === "SFX") {
          nextBgmTracks.push(mediaAsset);
          return;
        }
        if (item.kind === "VOICE") {
          return;
        }
        if (item.kind === "VIDEO") {
          if (!nextIntro) {
            nextIntro = { ...mediaAsset, kind: "VIDEO" };
          } else if (!nextEnding) {
            nextEnding = { ...mediaAsset, kind: "VIDEO" };
          }
          return;
        }
        nextPortraits[item.id] = { ...mediaAsset, kind: "IMAGE" };
      });

      return {
        ...prev,
        media_assets: {
          ...prev.media_assets,
          bgm_tracks: nextBgmTracks,
          intro_cinematic: nextIntro,
          ending_cinematic: nextEnding,
          character_portraits: nextPortraits
        }
      };
    });

    appendFeed("system", `素材库新增 ${created.length} 个素材。`);
    setApiError(null);
    event.target.value = "";
  };

  const onRemoveMaterial = (materialId: string) => {
    if (audioNowPlaying?.materialId === materialId) {
      stopAudioPreview();
    }
    setMaterialLibrary((prev) => {
      const target = prev.find((item) => item.id === materialId);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((item) => item.id !== materialId);
    });
    setGameState((prev) => ({
      ...prev,
      media_assets: {
        ...prev.media_assets,
        bgm_tracks: (prev.media_assets.bgm_tracks ?? []).filter((item) => item.asset_id !== materialId),
        intro_cinematic: prev.media_assets.intro_cinematic?.asset_id === materialId ? null : prev.media_assets.intro_cinematic,
        ending_cinematic: prev.media_assets.ending_cinematic?.asset_id === materialId ? null : prev.media_assets.ending_cinematic,
        character_portraits: Object.fromEntries(
          Object.entries(prev.media_assets.character_portraits ?? {}).filter(([, item]) => item.asset_id !== materialId)
        )
      }
    }));
  };

  const onMapCurrent = async () => {
    setLoading((prev) => ({ ...prev, mapCurrent: true }));
    setApiError(null);
    try {
      await runMapExtract(selectedChunkIndex);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "当前切片提取失败");
    } finally {
      setLoading((prev) => ({ ...prev, mapCurrent: false }));
    }
  };

  const onMapByIndex = async (chunkIndex: number) => {
    setLoading((prev) => ({ ...prev, mapCurrent: true }));
    setApiError(null);
    try {
      setSelectedChunkIndex(chunkIndex);
      await runMapExtract(chunkIndex);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "切片提取失败");
    } finally {
      setLoading((prev) => ({ ...prev, mapCurrent: false }));
    }
  };

  const applyFullParseResult = React.useCallback(
    (parsed: Omit<FullParsePipelineResponse, "ok">) => {
      setLocalGraphs(parsed.local_graphs);
      setSelectedGraphIndex(0);
      setResolutionDrawerOpen(false);
      setWorldlineSelections({});
      setResolutionOverrides({});
      setGameCardMarkdown("");
      setGameCardReferenceMarkdown("");
      setCustomizationSaved(false);
      setStylePreviewMap({});
      setAutoRecommendedStyleId("");
      setCustomStylePrompt("");
      setSelectedPortraitCharacterId("");
      setCharacterPromptDraftMap({});
      setCharacterPreviewMap({});
      setCharacterReferenceImageMap({});
      setCharacterVoiceDraftMap({});
      setVoiceMode("UPLOAD_CLONE");
      setSelectedVoiceMaterialId("");
      setVoicePrompt(DEFAULT_VOICE_PROMPT);
      setWaitingCardStart(false);
      setCardRuntimeEnabled(false);
      setCardRuntimeCursor(null);
      setSelectedCardActId("");
      setSelectedCardEventId("");
      setSelectedCardScene("");
      setReduceResult({
        ok: true,
        global_state_tree: parsed.global_state_tree,
        resolution_report: parsed.resolution_report,
        requires_bifurcation: parsed.requires_bifurcation,
        bifurcation_reasons: parsed.bifurcation_reasons
      });

      const keyFacts = parsed.global_state_tree.assertions.slice(0, 8).map((item) => `${item.attribute_key}: ${item.value}`);
      setGameState((prev) => ({
        ...prev,
        world_state: {
          ...prev.world_state,
          world_events: unique([...(prev.world_state.world_events ?? []), ...keyFacts]).slice(0, 20),
          global_state_tree: parsed.global_state_tree
        }
      }));

      const mergedRules = unique(
        parsed.local_graphs.flatMap((graph) => [
          ...graph.implicit_rules.social_power_relations,
          ...graph.implicit_rules.ability_costs,
          ...graph.implicit_rules.causal_invariants
        ])
      );
      if (mergedRules.length > 0) {
        setBaselineContext(mergedRules.join("；").slice(0, 1800));
      }
      setGuideStage(2);
      pushProcessedNovelHistory({
        fileName: sourceFileName,
        chunkCount: parsed.pipeline_report.mapped_chunks,
        charCount: allChunks.reduce((sum, chunk) => sum + chunk.length, 0)
      });

      appendFeed(
        "system",
        `一键全局解析完成：Map ${parsed.pipeline_report.mapped_chunks} 个切片（失败 ${parsed.pipeline_report.failed_chunks ?? 0} 个），Reduce 仲裁 ${parsed.resolution_report.length} 组冲突。`
      );
      if (parsed.requires_bifurcation) {
        appendFeed("system", `发现可能冲突分支信号：${parsed.bifurcation_reasons.length} 项（可在仲裁详情中复核）。`);
      }
      appendFeed("system", "下一步：进入“风格与人物定制”完成画风、角色与声线设定。");
    },
    [allChunks, appendFeed, pushProcessedNovelHistory, sourceFileName]
  );

  const onMapBatch = async () => {
    if (!workflowGateState.step1Ready) {
      setApiError("请先完成步骤 1：上传小说并确认切片策略。");
      return;
    }
    if (allChunks.length === 0) {
      return;
    }

    setLoading((prev) => ({ ...prev, mapBatch: true }));
    setApiError(null);
    setFullParseJob(null);

    try {
      // Keep a safety margin under backend REQUEST_BODY_LIMIT (default 20mb).
      if (fullParsePayloadBytes > 19 * 1024 * 1024) {
        throw new Error(
          `全局解析请求体约 ${formatBytes(fullParsePayloadBytes)}，已接近/超过后端限制。` +
            "这不是 LLM 逐片调用失败，而是前端到后端单次请求过大。"
        );
      }

      const created = await apiManager.createFullParseJob(fullParsePayload);
      setFullParseJob(created.job);
      appendFeed("system", `已启动全局解析任务（${created.job.progress.total_chunks} 个切片）。`);

      const polled = await pollFullParseJobUntilStop(created.job.job_id);
      if (polled.status === "PAUSED") {
        appendFeed("system", "全局解析任务已暂停。你可以稍后点击“恢复解析”继续。");
        return;
      }

      applyFullParseResult(polled.result);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "批量提取失败");
    } finally {
      setLoading((prev) => ({ ...prev, mapBatch: false }));
    }
  };

  const onPauseMapBatch = async () => {
    if (!fullParseJob?.job_id) {
      return;
    }

    setApiError(null);
    try {
      const paused = await apiManager.pauseFullParseJob(fullParseJob.job_id);
      setFullParseJob(paused.job);
      appendFeed("system", "已请求暂停全局解析，当前切片完成后会进入暂停状态。");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "暂停全局解析失败");
    }
  };

  const onResumeMapBatch = async () => {
    if (!fullParseJob?.job_id) {
      return;
    }

    setLoading((prev) => ({ ...prev, mapBatch: true }));
    setApiError(null);

    try {
      const resumed = await apiManager.resumeFullParseJob(fullParseJob.job_id);
      setFullParseJob(resumed.job);
      const polled = await pollFullParseJobUntilStop(resumed.job.job_id);
      if (polled.status === "PAUSED") {
        appendFeed("system", "任务仍处于暂停状态。");
        return;
      }
      applyFullParseResult(polled.result);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "恢复全局解析失败");
    } finally {
      setLoading((prev) => ({ ...prev, mapBatch: false }));
    }
  };

  const onRunReduce = async () => {
    if (localGraphs.length === 0) {
      setApiError("请先至少提取一个切片。");
      return;
    }

    setLoading((prev) => ({ ...prev, reduce: true }));
    setApiError(null);

    try {
      const result = await apiManager.reduceConflict({ local_graphs: localGraphs });
      setReduceResult(result);
      setResolutionDrawerOpen(false);
      setWorldlineSelections({});
      setResolutionOverrides({});
      setCustomizationSaved(false);
      setStylePreviewMap({});
      setAutoRecommendedStyleId("");
      setSelectedPortraitCharacterId("");
      setCharacterPromptDraftMap({});
      setCharacterPreviewMap({});
      setCharacterReferenceImageMap({});
      setCharacterVoiceDraftMap({});
      setVoiceMode("UPLOAD_CLONE");
      setSelectedVoiceMaterialId("");
      setVoicePrompt(DEFAULT_VOICE_PROMPT);
      setGameCardMarkdown("");
      setGameCardReferenceMarkdown("");

      const keyFacts = result.global_state_tree.assertions.slice(0, 6).map((it) => `${it.attribute_key}: ${it.value}`);
      setGameState((prev) => ({
        ...prev,
        world_state: {
          ...prev.world_state,
          world_events: unique([...(prev.world_state.world_events ?? []), ...keyFacts]).slice(0, 16),
          global_state_tree: result.global_state_tree
        }
      }));

      if (result.requires_bifurcation) {
        appendFeed("system", `冲突仲裁完成：发现可能冲突分支 ${result.bifurcation_reasons.length} 项。`);
      } else {
        appendFeed("system", "冲突仲裁完成：设定已成功合并为全局状态树。");
      }
      setGuideStage(2);
      setRightTab("guide");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "冲突仲裁失败");
    } finally {
      setLoading((prev) => ({ ...prev, reduce: false }));
    }
  };

  const onUseCustomAction = () => {
    const text = customActionText.replace(/\s+/g, " ").trim();
    if (!text) {
      setApiError("请输入自定义行动内容。");
      return;
    }

    const actionId = `custom::${text.slice(0, 120)}`;
    setTurnActionId(actionId);
    setApiError(null);

    setGameState((prev) => {
      const exists = (prev.event_engine.available_actions ?? []).some((action) => action.action_id === actionId);
      if (exists) {
        return prev;
      }
      return {
        ...prev,
        event_engine: {
          ...prev.event_engine,
          available_actions: [
            ...(prev.event_engine.available_actions ?? []),
            {
              action_id: actionId,
              prompt_text: text,
              required_stats: {}
            }
          ]
        }
      };
    });
    appendFeed("system", `已添加自定义行动：${text}`);
  };

  const onResetRenderSession = React.useCallback(() => {
    const resetMessage = "渲染引擎已重置。请重新选择节点并开始推演。";
    setHistoryStack([]);
    setNarrativeArchive([]);
    setLastTurnResult(null);
    setCustomActionText("");
    setTurnActionId("wait");
    setLeftPanelMode("play");
    setWaitingCardStart(false);
    setCardRuntimeEnabled(false);
    setCardRuntimeCursor(null);
    setApiError(null);
    setGameState((prev) => ({
      ...prev,
      event_engine: {
        ...prev.event_engine,
        narrative_log: resetMessage,
        observation_data: "",
        available_actions: [
          {
            action_id: "wait",
            prompt_text: "继续观察",
            required_stats: {}
          }
        ],
        narrative_feed: [
          {
            id: `reset-${Date.now()}`,
            turn: prev.world_state.current_turn,
            role: "system",
            content: resetMessage
          }
        ]
      }
    }));
  }, []);

  const onRunTurn = async () => {
    if (waitingCardStart) {
      setApiError("请先在“游戏卡”页点击“开始推演”。");
      return;
    }

    setLoading((prev) => ({ ...prev, turn: true }));
    setApiError(null);

    try {
      const selectedAction = availableActionViews.find((it) => it.action_id === turnActionId);
      if (selectedAction && !selectedAction.conditionPassed) {
        const reason = selectedAction.unmetConditions[0] ?? "条件不足";
        setApiError(`该行动当前不可执行：${reason}`);
        return;
      }
      const rawActionText =
        selectedAction?.rawText ??
        (turnActionId.startsWith("custom::") ? turnActionId.replace(/^custom::/, "") : turnActionId);
      const resolvedAction = resolveActionTextAndFactionEffects(rawActionText, factionCallRules);
      const runtimeCondition = evaluateFactionConditions(
        gameState,
        unique([...(selectedAction?.factionConditions ?? []), ...resolvedAction.conditions])
      );
      if (!runtimeCondition.pass) {
        setApiError(`该行动当前不可执行：${runtimeCondition.unmetConditions[0] ?? "条件不足"}`);
        return;
      }
      const actionText = resolvedAction.cleanText || rawActionText;
      const factionEffects = resolvedAction.effects;
      const cardCursorIndex =
        cardRuntimeEnabled && cardRuntimeCursor
          ? cardTimelineEvents.findIndex(
              (item) => item.act.id === cardRuntimeCursor.actId && item.event.id === cardRuntimeCursor.eventId
            )
          : -1;
      const currentCardNode = cardCursorIndex >= 0 ? cardTimelineEvents[cardCursorIndex] : null;
      const nextCardNode = cardCursorIndex >= 0 ? cardTimelineEvents[cardCursorIndex + 1] ?? null : null;
      const nextCardDirectiveEffects =
        cardRuntimeEnabled && nextCardNode ? dedupeFactionEffects(nextCardNode.event.directives ?? []) : [];
      appendFeed("player", `选择：${actionText}`);

      setHistoryStack((prev) => [...prev, deepCloneGameState(gameState)]);
      const outboundState = deepCloneGameState(gameState);
      const factionEffectLogs = applyFactionCallEffects(outboundState, factionEffects);
      if (factionEffectLogs.length > 0) {
        appendFeed("system", `Faction Call 生效：${factionEffectLogs.join(" | ")}`);
        void playFactionAudioByEffects(factionEffects);
      }
      const outboundPlayer = ensurePlayerEntity(outboundState);

      const response = await apiManager.executeTurn({
        game_instance_id: gameState.game_instance_id,
        player_entity: outboundPlayer,
        world_state: {
          ...outboundState.world_state,
          current_turn: outboundState.world_state.current_turn,
          current_phase: outboundState.current_phase,
          timeline_anchor: timelineAnchor,
          plot_mode: plotMode,
          card_runtime:
            cardRuntimeEnabled && currentCardNode
              ? {
                  enabled: true,
                  act_id: currentCardNode.act.id,
                  act_title: currentCardNode.act.title,
                  event_id: currentCardNode.event.id,
                  event_title: currentCardNode.event.title,
                  key_scene: selectedCardScene || currentCardNode.event.keyScenes[0] || "",
                  next_event_title: nextCardNode?.event.title ?? null
                }
              : undefined,
          time_step_runtime: timeStepConfig,
          llm_constraints: {
            negative_words: negativeWordsText
              .split(/[，,\n]/)
              .map((it) => it.trim())
              .filter(Boolean),
            visual_style: selectedVisualPreset?.themeStyle ?? undefined,
            visual_style_prompt: composeVisualStylePrompt(selectedVisualPreset, customStylePrompt),
            character_feature_prompt: characterFeaturePrompt.trim() || undefined,
            voice_profile: activeVoiceProfilePayload
          }
        },
        action_id: cardRuntimeEnabled ? actionText : turnActionId,
        genre: gameState.genre_metadata?.genre ?? "通用题材"
      });

      setLastTurnResult(response);
      setGameState((prev) => {
        const next = deepCloneGameState(response.game_state);
        const nextWithFactionCall = deepCloneGameState(next);
        if (!nextWithFactionCall.media_assets) {
          nextWithFactionCall.media_assets = {
            bgm_tracks: [],
            intro_cinematic: null,
            ending_cinematic: null,
            character_portraits: {}
          };
        }
        if (factionEffects.length > 0) {
          applyFactionCallEffects(nextWithFactionCall, factionEffects);
        }
        nextWithFactionCall.media_assets.bgm_tracks = dedupeMediaAssets(nextWithFactionCall.media_assets.bgm_tracks ?? []);
        if (cardRuntimeEnabled && nextCardNode) {
          const scriptedActions = buildCardEventActions(nextCardNode.event);
          const modelActions = nextWithFactionCall.event_engine.available_actions ?? [];
          nextWithFactionCall.event_engine.available_actions = mergeAvailableActionsWithScripted(modelActions, scriptedActions);
          const scriptedScene = nextCardNode.event.keyScenes[0] ?? "";
          if (scriptedScene) {
            nextWithFactionCall.event_engine.observation_data = [
              nextWithFactionCall.event_engine.observation_data,
              `游戏卡锚点：${scriptedScene}`
            ]
              .filter(Boolean)
              .join(" | ");
          }
          if (nextCardDirectiveEffects.length > 0) {
            applyFactionCallEffects(nextWithFactionCall, nextCardDirectiveEffects);
          }
        }
        return {
          ...nextWithFactionCall,
          current_phase: nextWithFactionCall.current_phase ?? prev.current_phase,
          time_step_config: timeStepConfig,
          event_engine: {
            ...nextWithFactionCall.event_engine,
            narrative_feed: [
              ...(prev.event_engine.narrative_feed ?? []),
              {
                id: `ai-${Date.now()}`,
                turn: nextWithFactionCall.world_state.current_turn,
                role: "ai",
                content: nextWithFactionCall.event_engine.narrative_log
              },
              ...(nextWithFactionCall.event_engine.narrative_feed ?? [])
            ]
          }
        };
      });

      if (nextCardDirectiveEffects.length > 0) {
        appendFeed("system", `场景指令生效：${nextCardDirectiveEffects.map((item) => item.kind).join(" / ")}`);
        void playFactionAudioByEffects(nextCardDirectiveEffects);
      }

      setNarrativeArchive((prev) => [...prev, response.game_state.event_engine.narrative_log]);

      if (cardRuntimeEnabled) {
        if (nextCardNode) {
          setCardRuntimeCursor({ actId: nextCardNode.act.id, eventId: nextCardNode.event.id });
          setSelectedCardActId(nextCardNode.act.id);
          setSelectedCardEventId(nextCardNode.event.id);
          setSelectedCardScene(nextCardNode.event.keyScenes[0] ?? nextCardNode.act.keyScenes[0] ?? "");
        } else if (cardCursorIndex >= 0) {
          setCardRuntimeEnabled(false);
          setCardRuntimeCursor(null);
          appendFeed("system", "游戏卡主线事件已推演到末尾，后续回合切换为常规状态机。");
        }
      }

      if (response.integrity_report.has_mismatch) {
        appendFeed("system", `开发者覆盖已接受：${response.integrity_report.diffs.join(" | ")}`);
      }
    } catch (error) {
      setHistoryStack((prev) => prev.slice(0, -1));
      setApiError(error instanceof Error ? error.message : "执行回合失败");
    } finally {
      setLoading((prev) => ({ ...prev, turn: false }));
    }
  };

  const onUndoTurn = () => {
    setHistoryStack((prev) => {
      if (prev.length === 0) {
        setApiError("没有可回溯的历史快照。");
        return prev;
      }

      const restored = deepCloneGameState(prev[prev.length - 1]);
      setGameState({
        ...restored,
        event_engine: {
          ...restored.event_engine,
          narrative_feed: [
            ...(restored.event_engine.narrative_feed ?? []),
            {
              id: `rollback-${Date.now()}`,
              turn: restored.world_state.current_turn,
              role: "system",
              content: "已回滚到上一回合快照。"
            }
          ]
        }
      });
      setTurnActionId(restored.event_engine.available_actions?.[0]?.action_id ?? "wait");
      setApiError(null);
      return prev.slice(0, -1);
    });
  };

  const onApplyTimelineAnchor = () => {
    const safeAnchor = clamp(timelineAnchor, 1, Math.max(1, allChunks.length || 1));
    setTimelineAnchor(safeAnchor);
    setCardRuntimeEnabled(false);
    setCardRuntimeCursor(null);
    setGameState((prev) => ({
      ...prev,
      world_state: {
        ...prev.world_state,
        current_turn: safeAnchor - 1,
        timeline_anchor: safeAnchor,
        global_state_tree: reduceResult?.global_state_tree ?? prev.world_state.global_state_tree
      }
    }));
    appendFeed("system", `时间线锚点已设置到切片 ${safeAnchor}（作为第 0 回合起点）。`, safeAnchor - 1);
  };

  const onRecommendTimeStep = () => {
    const genre = gameState.genre_metadata?.genre ?? "通用题材";
    const rec = getGenreRecommendation(genre);
    setTimeStepConfig(rec);
    setGameState((prev) => ({
      ...prev,
      time_step_config: rec
    }));
    appendFeed("system", `已按题材“${genre}”推荐时间步长：${rec.value} ${rec.unit} / 回合。`);
  };

  const onApplyCustomTimeStep = (next: TimeStepConfig) => {
    const custom: TimeStepConfig = {
      ...next,
      value: Math.max(1, Math.floor(next.value)),
      source: "USER_OVERRIDE"
    };
    setTimeStepConfig(custom);
    setGameState((prev) => ({
      ...prev,
      time_step_config: custom
    }));
  };

  const onApplyCreativeCustomization = () => {
    const preset = selectedVisualPreset;
    const portraitPrompts = Object.fromEntries(
      Object.entries(characterPromptDraftMap)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value.length > 0)
    );
    const voiceProfilesByCharacter = Object.fromEntries(
      Object.entries(characterVoiceDraftMap)
        .map(([key, value]) => [
          key,
          {
            mode: value.mode,
            material_id: value.material_id || null,
            prompt: value.prompt.trim() || null
          }
        ])
        .filter(([, value]) => Boolean((value as { material_id: string | null; prompt: string | null }).material_id || (value as { material_id: string | null; prompt: string | null }).prompt))
    );
    const activeCharacterId =
      selectedCharacterId && selectedCharacterId !== CUSTOM_CHARACTER_OPTION
        ? selectedCharacterId
        : null;
    const currentAttributeSnapshot = Object.fromEntries(
      Object.entries(playerAttributes).map(([key, attr]) => [key, clamp(attr.value, attr.min, attr.max)])
    );
    const currentInventorySnapshot = playerInventory.map((item) => ({
      ...item,
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0))
    }));

    const patchGlobalTree = (treeInput: unknown) => {
      if (!isRecordLike(treeInput)) {
        return treeInput;
      }
      const tree = treeInput as Record<string, unknown>;
      const nextTree: Record<string, unknown> = { ...tree };
      const existingCustomization = isRecordLike(tree.customization) ? (tree.customization as Record<string, unknown>) : {};
      nextTree.customization = {
        ...existingCustomization,
        start_character_id: activeCharacterId ?? "custom",
        character_portrait_prompts: portraitPrompts,
        voice_profiles_by_character: voiceProfilesByCharacter
      };

      if (!activeCharacterId) {
        return nextTree;
      }

      if (isRecordLike(tree.character_stats)) {
        nextTree.character_stats = {
          ...(tree.character_stats as Record<string, unknown>),
          [activeCharacterId]: currentAttributeSnapshot
        };
      }

      if (isRecordLike(tree.entities)) {
        const entities = { ...(tree.entities as Record<string, unknown>) };
        const target = entities[activeCharacterId];
        if (isRecordLike(target)) {
          const nextTarget = { ...target } as Record<string, unknown>;
          const components = isRecordLike(nextTarget.components)
            ? ({ ...nextTarget.components } as Record<string, unknown>)
            : {};
          const appearancePrompt = portraitPrompts[activeCharacterId];
          components.core_attributes = currentAttributeSnapshot;
          components.inventory_system = currentInventorySnapshot;
          if (appearancePrompt) {
            components.appearance = appearancePrompt;
          }
          if (activeVoiceProfilePayload) {
            components.voice_profile = activeVoiceProfilePayload;
          }
          nextTarget.components = components;
          entities[activeCharacterId] = nextTarget;
          nextTree.entities = entities;
        }
      }

      if (Array.isArray(tree.core_characters)) {
        nextTree.core_characters = (tree.core_characters as Array<Record<string, unknown>>).map((item) => {
          if (String(item.entity_id ?? "") !== activeCharacterId) {
            return item;
          }
          return {
            ...item,
            ...(portraitPrompts[activeCharacterId] ? { appearance: portraitPrompts[activeCharacterId] } : {}),
            initial_stats: currentAttributeSnapshot
          };
        });
      }

      return nextTree;
    };

    setGameState((prev) => ({
      ...prev,
      world_state: {
        ...prev.world_state,
        global_state_tree: patchGlobalTree(prev.world_state.global_state_tree)
      },
      genre_metadata: {
        ...(prev.genre_metadata ?? {}),
        theme_style: preset?.themeStyle ?? prev.genre_metadata?.theme_style ?? "default",
        visual_tone: preset?.tone,
        visual_palette: preset?.palette,
        visual_prompt_hint: composeVisualStylePrompt(preset, customStylePrompt),
        character_feature_prompt: characterFeaturePrompt.trim() || undefined,
        character_portrait_prompts: portraitPrompts,
        voice_profiles_by_character: voiceProfilesByCharacter,
        voice_profile: activeVoiceProfilePayload,
        start_character_id: activeCharacterId ?? "custom",
        start_character_stats: currentAttributeSnapshot,
        start_character_inventory: currentInventorySnapshot
      }
    }));

    setReduceResult((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        global_state_tree: patchGlobalTree(prev.global_state_tree) as typeof prev.global_state_tree
      };
    });

    setCustomizationSaved(true);
    appendFeed("system", `已应用并保存定制：画风「${preset?.name ?? "未命名"}」+ 人物/声线方案。`);
  };

  React.useEffect(() => {
    applyCustomizationRef.current = onApplyCreativeCustomization;
  }, [onApplyCreativeCustomization]);

  const onGenerateRandomVoicePreset = async () => {
    const finalPrompt = voicePrompt.trim() || DEFAULT_VOICE_PROMPT;
    setVoiceMode("AI_RANDOM");
    setVoicePrompt(finalPrompt);
    if (selectedPortraitCharacter) {
      setCharacterVoiceDraftMap((prev) => ({
        ...prev,
        [selectedPortraitCharacter.entity_id]: {
          mode: "AI_RANDOM",
          material_id: "",
          prompt: finalPrompt
        }
      }));
    }
    setCustomizationSaved(false);
    try {
      await runVoiceClonePreview({
        gateway: voiceGatewayConfig,
        profile: {
          profile_id: `voice-${Date.now()}`,
          name: selectedPortraitCharacter ? `${selectedPortraitCharacter.name}-AI声线` : "AI声线草案",
          mode: "AI_RANDOM",
          prompt: finalPrompt
        },
        preview_text: "这是随机生成的声线占位预览。"
      });
      appendFeed("system", `已生成人物 AI 声线草案：${finalPrompt}`);
    } catch {
      appendFeed("system", "已生成 AI 声线描述草案。");
    }
  };

  const onCloneVoiceFromMaterial = React.useCallback(async () => {
    if (!selectedPortraitCharacter) {
      setApiError("请先选择一个调整角色。");
      return;
    }
    if (!selectedVoiceMaterialId) {
      setApiError("请先上传并选择声线素材。");
      return;
    }
    const finalPrompt = voicePrompt.trim() || DEFAULT_VOICE_PROMPT;
    setVoiceMode("UPLOAD_CLONE");
    setCharacterVoiceDraftMap((prev) => ({
      ...prev,
      [selectedPortraitCharacter.entity_id]: {
        mode: "UPLOAD_CLONE",
        material_id: selectedVoiceMaterialId,
        prompt: finalPrompt
      }
    }));
    setCustomizationSaved(false);

    try {
      await runVoiceClonePreview({
        gateway: voiceGatewayConfig,
        profile: {
          profile_id: `voice-material-${Date.now()}`,
          name: `${selectedPortraitCharacter.name}-素材克隆`,
          source_material_id: selectedVoiceMaterialId,
          mode: "UPLOAD_CLONE",
          prompt: finalPrompt
        },
        preview_text: "这是素材克隆声线占位预览。"
      });
      appendFeed("system", `已完成「${selectedPortraitCharacter.name}」声线克隆草案。`);
    } catch {
      appendFeed("system", "已保存声线克隆草案。");
    }
  }, [selectedPortraitCharacter, selectedVoiceMaterialId, voiceGatewayConfig, voicePrompt]);

  const onWizardAutoFill = async () => {
    setLoading((prev) => ({ ...prev, wizardAi: true }));
    setApiError(null);

    try {
      const response = await apiManager.mapExtract({
        chapter_index: Math.max(1, gameState.world_state.current_turn + 1),
        chunk_text: [
          "请根据以下残稿盲区自动补全设定：",
          `1) 世界铁律：${wizardAnswers.world_rule}`,
          `2) 能力代价：${wizardAnswers.power_cost}`,
          `3) 势力冲突：${wizardAnswers.faction_tension}`
        ].join("\n"),
        baseline_context: baselineContext
      });

      const social = response.ecs_local_graph.implicit_rules.social_power_relations[0] ?? "阶层制度以资源稀缺为核心";
      const ability = response.ecs_local_graph.implicit_rules.ability_costs[0] ?? "每次使用异能都会消耗寿命或精神";
      const causal = response.ecs_local_graph.implicit_rules.causal_invariants[0] ?? "越级挑战若失败会导致势力关系恶化";

      setWizardAnswers({
        world_rule: social,
        power_cost: ability,
        faction_tension: causal
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "AI 补全失败");
    } finally {
      setLoading((prev) => ({ ...prev, wizardAi: false }));
    }
  };

  const onApplyWizard = () => {
    const merged = unique([wizardAnswers.world_rule, wizardAnswers.power_cost, wizardAnswers.faction_tension]);
    setBaselineContext(unique([baselineContext, ...merged]).join("；").slice(0, 1800));

    setGameState((prev) => ({
      ...prev,
      player_entity: {
        ...ensurePlayerEntity(prev),
        biography: {
          ...(ensurePlayerEntity(prev).biography ?? {
            name: "玩家",
            age: 18,
            gender: "未知",
            origin_background: "未设定",
            appearance: ""
          }),
          origin_background: wizardAnswers.world_rule || ensurePlayerEntity(prev).biography?.origin_background || "未设定"
        }
      },
      world_state: {
        ...prev.world_state,
        world_events: unique([...(prev.world_state.world_events ?? []), ...merged]).slice(0, 16)
      }
    }));

    appendFeed("system", "已应用残稿补全设定。你可以继续执行 Reduce 与 Turn 推演。", gameState.world_state.current_turn);
    setWizardOpen(false);
  };

  const onShareSnapshot = async () => {
    try {
      const id = `s${Date.now()}`;
      window.localStorage.setItem(
        `utre_snapshot_${id}`,
        JSON.stringify({
          game_state: gameState,
          local_graphs: localGraphs,
          reduce_result: reduceResult,
          narrative_archive: narrativeArchive
        })
      );
      const link = `${window.location.origin}${window.location.pathname}?snapshot=${id}`;
      setShareLink(link);
      await navigator.clipboard.writeText(link);
      appendFeed("system", "快照链接已生成并复制到剪贴板。", gameState.world_state.current_turn);
    } catch {
      setApiError("快照已生成，但复制失败，请手动复制下方链接。");
    }
  };

  const onExportNovel = () => {
    const logs = narrativeArchive.length > 0 ? narrativeArchive : [gameState.event_engine.narrative_log];
    const content = logs.map((item, idx) => `第 ${idx + 1} 回合\n${item}\n`).join("\n");
    downloadTextFile(`互动小说草稿-${gameState.game_instance_id}.txt`, content);
    appendFeed("system", "已导出互动小说草稿。", gameState.world_state.current_turn);
  };

  const onApplyCardActAsAnchor = React.useCallback(
    (
      act: GameCardActNode,
      sceneText?: string,
      eventOverride?: GameCardActNode["events"][number] | null,
      options?: { fromBeginning?: boolean }
    ) => {
      const totalActs = Math.max(1, parsedCardActs.length);
      const anchor = options?.fromBeginning ? 1 : estimateAnchorByAct(act.index, totalActs, allChunks.length);
      const safeChunkIndex = clamp(anchor - 1, 0, Math.max(0, allChunks.length - 1));
      const selectedEvent =
        eventOverride ??
        act.events.find((event) => event.id === selectedCardEventId) ??
        act.events.find((event) => event.keyScenes.includes((sceneText ?? selectedCardScene ?? "").trim())) ??
        act.events[0] ??
        null;
      const pickedScene =
        (sceneText ??
          selectedCardScene ??
          selectedEvent?.keyScenes[0] ??
          act.keyScenes[0] ??
          "").trim();
      const scriptedActions = buildCardEventActions(selectedEvent);
      const selectedEventDirectiveEffects = dedupeFactionEffects(selectedEvent?.directives ?? []);
      const anchorNarrative = [
        `【起始幕：${act.title}】`,
        selectedEvent?.title ? `【关键事件：${selectedEvent.title}】` : "",
        pickedScene || "基于当前幕设定开始推演。"
      ]
        .filter(Boolean)
        .join("\n");

      setSelectedCardActId(act.id);
      setSelectedCardEventId(selectedEvent?.id ?? "");
      setSelectedCardScene(pickedScene);
      setCardRuntimeEnabled(true);
      setCardRuntimeCursor(selectedEvent ? { actId: act.id, eventId: selectedEvent.id } : null);
      setSelectedChunkIndex(safeChunkIndex);
      setTimelineAnchor(anchor);
      setRightTab("debug");
      setLeftPanelMode("play");
      setWaitingCardStart(false);
      setHistoryStack([]);
      setNarrativeArchive([]);
      setLastTurnResult(null);
      setCustomActionText("");
      setTurnActionId(scriptedActions[0]?.action_id ?? "wait");
      setApiError(null);

      setGameState((prev) => {
        const next: FrontendGameState = {
          ...prev,
          current_phase: "MAIN_LOOP",
          world_state: {
            ...prev.world_state,
            current_turn: anchor - 1,
            timeline_anchor: anchor,
            current_phase: "MAIN_LOOP",
            global_state_tree: reduceResult?.global_state_tree ?? prev.world_state.global_state_tree
          },
          event_engine: {
            ...prev.event_engine,
            narrative_log: anchorNarrative,
            observation_data: "",
            available_actions: scriptedActions,
            narrative_feed: [
              {
                id: `system-card-anchor-${Date.now()}-${act.index}`,
                turn: anchor - 1,
                role: "system",
                content: options?.fromBeginning
                  ? `已从故事开头进入游戏卡推演：${act.title}`
                  : `已选择 ${act.title} 作为推演起点。`
              },
              {
                id: `ai-card-anchor-${Date.now()}-${act.index}`,
                turn: anchor - 1,
                role: "ai",
                content: anchorNarrative
              }
            ]
          }
        };
        if (selectedEventDirectiveEffects.length > 0) {
          applyFactionCallEffects(next, selectedEventDirectiveEffects);
        }
        return next;
      });

      if (selectedEventDirectiveEffects.length > 0) {
        appendFeed("system", `场景指令生效：${selectedEventDirectiveEffects.map((item) => item.kind).join(" / ")}`);
        void playFactionAudioByEffects(selectedEventDirectiveEffects);
      }
    },
    [
      allChunks.length,
      appendFeed,
      parsedCardActs.length,
      playFactionAudioByEffects,
      reduceResult?.global_state_tree,
      selectedCardEventId,
      selectedCardScene
    ]
  );

  const onGenerateGameCard = async (options?: { allowAutoApply?: boolean }) => {
    const canAutoApply = !!options?.allowAutoApply;
    if (!workflowGateState.step3Ready) {
      if (canAutoApply) {
        onApplyCreativeCustomization();
      } else {
        setApiError("请先完成步骤 3 并点击“应用当前修改”。");
        return;
      }
    }
    if (!reduceResult?.global_state_tree) {
      setApiError("请先完成一次全局解析或冲突仲裁，再生成游戏卡。");
      return;
    }

    setGameCardGenerating(true);
    setApiError(null);
    try {
      const appliedGenreMeta = isRecordLike(gameState.genre_metadata) ? (gameState.genre_metadata as Record<string, unknown>) : {};
      const appliedPortraitPrompts = isRecordLike(appliedGenreMeta.character_portrait_prompts)
        ? (appliedGenreMeta.character_portrait_prompts as Record<string, unknown>)
        : Object.fromEntries(
            Object.entries(characterPromptDraftMap)
              .map(([key, value]) => [key, value.trim()])
              .filter(([, value]) => value.length > 0)
          );
      const appliedVoiceProfiles = isRecordLike(appliedGenreMeta.voice_profiles_by_character)
        ? (appliedGenreMeta.voice_profiles_by_character as Record<string, unknown>)
        : Object.fromEntries(
            Object.entries(characterVoiceDraftMap)
              .map(([key, value]) => [
                key,
                {
                  mode: value.mode,
                  material_id: value.material_id || null,
                  prompt: value.prompt.trim() || null
                }
              ])
              .filter(([, value]) => Boolean((value as { material_id: string | null; prompt: string | null }).material_id || (value as { material_id: string | null; prompt: string | null }).prompt))
          );
      const currentAttributeSnapshot = Object.fromEntries(
        Object.entries(playerAttributes).map(([key, attr]) => [key, clamp(attr.value, attr.min, attr.max)])
      );
      const currentInventorySnapshot = playerInventory.map((item) => ({
        ...item,
        quantity: Math.max(0, Math.floor(Number(item.quantity) || 0))
      }));
      const customizationDirectives = [
        "## 创作者定制注入（自动生成）",
        "- function_macro_status: disabled",
        `- visual_theme_style: ${String(appliedGenreMeta.theme_style ?? selectedVisualPreset?.themeStyle ?? "default")}`,
        `- visual_tone: ${String(appliedGenreMeta.visual_tone ?? selectedVisualPreset?.tone ?? "未指定")}`,
        `- visual_palette: ${String(appliedGenreMeta.visual_palette ?? selectedVisualPreset?.palette ?? "未指定")}`,
        `- visual_prompt_hint: ${String(appliedGenreMeta.visual_prompt_hint ?? composeVisualStylePrompt(selectedVisualPreset, customStylePrompt))}`,
        `- start_character_id: ${selectedCharacterId}`,
        `- start_character_stats_json: ${JSON.stringify(currentAttributeSnapshot)}`,
        `- start_character_inventory_json: ${JSON.stringify(currentInventorySnapshot)}`,
        `- character_portrait_prompts_json: ${JSON.stringify(appliedPortraitPrompts)}`,
        `- voice_profiles_by_character_json: ${JSON.stringify(appliedVoiceProfiles)}`,
        `- active_voice_profile_json: ${JSON.stringify(activeVoiceProfilePayload ?? null)}`,
        `- voice_gateway_provider: ${voiceGatewayConfig.provider}`,
        voiceGatewayConfig.endpoint ? `- voice_gateway_endpoint: ${voiceGatewayConfig.endpoint}` : "",
        voiceGatewayConfig.model ? `- voice_gateway_model: ${voiceGatewayConfig.model}` : ""
      ]
        .filter(Boolean)
        .join("\n");

      const response = await apiManager.generateGameCard({
        global_state_tree: reduceResult.global_state_tree,
        local_graphs: localGraphs,
        source_file_name: sourceFileName,
        source_char_count: totalChunkChars,
        directives_markdown: customizationDirectives
      });
      setGameCardReferenceMarkdown(response.markdown);
      setGameCardMarkdown(response.markdown);
      const acts = parseGameCardActs(response.markdown);
      if (acts.length > 0) {
        setSelectedCardActId(acts[0].id);
        setSelectedCardEventId(acts[0].events[0]?.id ?? "");
        setSelectedCardScene(acts[0].events[0]?.keyScenes[0] ?? acts[0].keyScenes[0] ?? "");
      } else {
        setSelectedCardActId("");
        setSelectedCardEventId("");
        setSelectedCardScene("");
      }
      setWaitingCardStart(true);
      setCardRuntimeEnabled(false);
      setCardRuntimeCursor(null);
      setHistoryStack([]);
      setNarrativeArchive([]);
      setLastTurnResult(null);
      setTurnActionId("wait");
      setCustomActionText("");
      setLeftPanelMode("play");
      goToWorkflowStep(4);
      appendFeed("system", "游戏卡已生成。请在“游戏卡”页确认后点击“开始推演”。");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "生成游戏卡失败");
    } finally {
      setGameCardGenerating(false);
    }
  };

  const onDownloadGameCard = () => {
    if (!gameCardMarkdown.trim()) {
      setApiError("请先生成游戏卡。");
      return;
    }
    const safeName = sourceFileName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_");
    downloadTextFile(`游戏卡-${safeName || "untitled"}.md`, gameCardMarkdown);
  };

  const onStartSimulationFromCard = () => {
    if (!gameCardMarkdown.trim()) {
      setApiError("请先生成游戏卡。");
      return;
    }

    if (cardStartMode === "BEGINNING") {
      const firstAct = parsedCardActs[0] ?? null;
      const firstEvent = firstAct?.events[0] ?? null;
      if (firstAct) {
        onApplyCardActAsAnchor(firstAct, firstEvent?.keyScenes[0] ?? firstAct.keyScenes[0] ?? "", firstEvent, {
          fromBeginning: true
        });
        return;
      }
    }

    if (selectedCardAct) {
      onApplyCardActAsAnchor(selectedCardAct, selectedCardScene, selectedCardEvent, { fromBeginning: false });
      return;
    }
    setApiError("请先在步骤四选择“从故事开头”或选定锚点场景后再开始推演。");
  };

  const onToggleMita = () => {
    if (!mitaEnabled) {
      const greeting: MitaMessage = {
        id: `mita-init-${Date.now()}`,
        role: "assistant",
        content: "你好！亲爱的“世界缔造者”，请问是否有创意枯竭或者对.md文档结构和格式有什么疑问呢？"
      };
      setMitaHistory([greeting]);
      setMitaEnabled(true);
      setLeftPanelMode("mita");
      setApiError(null);
      return;
    }
    setMitaEnabled(false);
    setLeftPanelMode("play");
  };

  const onAskMita = async () => {
    const question = mitaInput.replace(/\s+/g, " ").trim();
    if (!question) {
      setApiError("请输入要咨询秘塔AI的问题。");
      return;
    }
    if (!gameCardMarkdown.trim() && !gameCardReferenceMarkdown.trim()) {
      setApiError("请先生成或编辑游戏卡 Markdown 后再使用秘塔AI。");
      return;
    }

    const nextUserMessage: MitaMessage = {
      id: `mita-user-${Date.now()}`,
      role: "user",
      content: question
    };
    setMitaHistory((prev) => [...prev, nextUserMessage]);
    setMitaInput("");
    setMitaLoading(true);
    setApiError(null);

    try {
      const response = await apiManager.askGameCardAssistant({
        reference_markdown: gameCardReferenceMarkdown || gameCardMarkdown,
        editable_markdown: gameCardMarkdown,
        question,
        history: [...mitaHistory, nextUserMessage].map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          content: item.content
        })),
        preset: mitaPreset
      });

      setMitaHistory((prev) => [
        ...prev,
        {
          id: `mita-assistant-${Date.now()}`,
          role: "assistant",
          content: response.answer
        }
      ]);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "秘塔AI调用失败");
    } finally {
      setMitaLoading(false);
    }
  };

  const onApplyJsonDraft = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as FrontendGameState;
      setGameState(parsed);
      setJsonError(null);
      appendFeed("system", "已应用专家 JSON 修改。", parsed.world_state.current_turn);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "JSON 解析失败");
    }
  };

  const persistSelectedCharacterProfile = React.useCallback(
    (patch: { biography?: string; appearance?: string }) => {
      if (!selectedCharacterId || selectedCharacterId === CUSTOM_CHARACTER_OPTION) {
        return;
      }

      const nextBio = (patch.biography ?? "").trim();
      const nextAppearance = (patch.appearance ?? "").trim();

      setGameState((prev) => {
        const tree = prev.world_state.global_state_tree;
        if (!isRecordLike(tree) || !isRecordLike(tree.entities)) {
          return prev;
        }

        const entities = { ...(tree.entities as Record<string, unknown>) };
        const target = entities[selectedCharacterId];
        if (!isRecordLike(target)) {
          return prev;
        }

        const nextTarget = { ...target } as Record<string, unknown>;
        const components = isRecordLike(nextTarget.components)
          ? ({ ...nextTarget.components } as Record<string, unknown>)
          : {};

        if (patch.biography !== undefined) {
          components.biography = nextBio;
          components.origin_background = nextBio;
        }
        if (patch.appearance !== undefined) {
          components.appearance = nextAppearance;
        }

        nextTarget.components = components;
        entities[selectedCharacterId] = nextTarget;

        const nextTree: Record<string, unknown> = {
          ...tree,
          entities
        };

        if (Array.isArray((tree as { core_characters?: unknown }).core_characters)) {
          const coreCharacters = ((tree as { core_characters: unknown[] }).core_characters as Array<Record<string, unknown>>).map((item) => {
            if (String(item.entity_id ?? "") !== selectedCharacterId) {
              return item;
            }
            return {
              ...item,
              ...(patch.biography !== undefined ? { biography: nextBio } : {}),
              ...(patch.appearance !== undefined ? { appearance: nextAppearance } : {})
            };
          });
          nextTree.core_characters = coreCharacters;
        }

        return {
          ...prev,
          world_state: {
            ...prev.world_state,
            global_state_tree: nextTree
          }
        };
      });

      setReduceResult((prev) => {
        if (!prev || !isRecordLike(prev.global_state_tree)) {
          return prev;
        }
        const tree = prev.global_state_tree as Record<string, unknown>;
        if (!isRecordLike(tree.entities)) {
          return prev;
        }

        const entities = { ...(tree.entities as Record<string, unknown>) };
        const target = entities[selectedCharacterId];
        if (!isRecordLike(target)) {
          return prev;
        }

        const nextTarget = { ...target } as Record<string, unknown>;
        const components = isRecordLike(nextTarget.components)
          ? ({ ...nextTarget.components } as Record<string, unknown>)
          : {};
        if (patch.biography !== undefined) {
          components.biography = nextBio;
          components.origin_background = nextBio;
        }
        if (patch.appearance !== undefined) {
          components.appearance = nextAppearance;
        }
        nextTarget.components = components;
        entities[selectedCharacterId] = nextTarget;

        let coreCharacters = tree.core_characters;
        if (Array.isArray(coreCharacters)) {
          coreCharacters = (coreCharacters as Array<Record<string, unknown>>).map((item) => {
            if (String(item.entity_id ?? "") !== selectedCharacterId) {
              return item;
            }
            return {
              ...item,
              ...(patch.biography !== undefined ? { biography: nextBio } : {}),
              ...(patch.appearance !== undefined ? { appearance: nextAppearance } : {})
            };
          });
        }

        return {
          ...prev,
          global_state_tree: {
            ...prev.global_state_tree,
            entities: entities as typeof prev.global_state_tree.entities,
            ...(coreCharacters ? { core_characters: coreCharacters as typeof prev.global_state_tree.core_characters } : {})
          }
        };
      });
    },
    [selectedCharacterId]
  );

  const updateAttribute = (key: string, value: number) => {
    setGameState((prev) => {
      const nextPlayer = ensurePlayerEntity(prev);
      const target = prev.player_entity?.core_attributes?.[key];
      if (!target) {
        return prev;
      }
      const nextValue = clamp(value, target.min, target.max);
      return {
        ...prev,
        player_entity: {
          ...nextPlayer,
          core_attributes: {
            ...(nextPlayer.core_attributes ?? {}),
            [key]: {
              ...target,
              value: nextValue
            }
          }
        }
      };
    });
    setCustomizationSaved(false);
  };

  const updateInventory = (index: number, field: "name" | "category" | "quantity", value: string | number) => {
    setGameState((prev) => {
      const nextPlayer = ensurePlayerEntity(prev);
      const current = [...(nextPlayer.inventory_system ?? [])];
      const target = current[index];
      if (!target) {
        return prev;
      }
      current[index] = {
        ...target,
        [field]: field === "quantity" ? Number(value) : value
      };
      return {
        ...prev,
        player_entity: {
          ...nextPlayer,
          inventory_system: current
        }
      };
    });
    setCustomizationSaved(false);
  };

  const addInventoryItem = () => {
    setGameState((prev) => {
      const nextPlayer = ensurePlayerEntity(prev);
      return {
        ...prev,
        player_entity: {
          ...nextPlayer,
          inventory_system: [
            ...(nextPlayer.inventory_system ?? []),
            {
              item_id: `item_${Date.now()}`,
              name: "新道具",
              category: "misc",
              quantity: 1
            }
          ]
        }
      };
    });
    setCustomizationSaved(false);
  };

  const resolutionDetails = React.useMemo(() => {
    const rows = reduceResult?.resolution_report ?? [];
    const chapterToChunkId = new Map<number, string>();
    localGraphs.forEach((graph) => {
      chapterToChunkId.set(graph.chapter_index, graph.chunk_id || `chunk-${graph.chapter_index}`);
    });

    const assertionIndex = new Map<string, CandidateTrace[]>();
    localGraphs.forEach((graph) => {
      graph.assertions.forEach((assertion) => {
        const key = `${assertion.entity_id}::${assertion.attribute_key}`;
        const existing = assertionIndex.get(key) ?? [];
        existing.push({
          value: assertion.value,
          chapterIndex: assertion.chapter_index,
          chunkId: chapterToChunkId.get(assertion.chapter_index) ?? `chunk-${assertion.chapter_index}`
        });
        assertionIndex.set(key, existing);
      });
    });

    const targetStatuses: ResolutionStatus[] = ["DENSITY_FILTERED", "TEMPORAL_OVERRIDE", "CRA_PATCHED", "BIFURCATED"];
    const rawLogs = (reduceResult as { resolution_logs?: unknown[] } | null)?.resolution_logs;
    if (Array.isArray(rawLogs) && rawLogs.length > 0) {
      return rawLogs
        .filter((item): item is Record<string, unknown> => isRecordLike(item))
        .filter((item) => targetStatuses.includes(String(item.status) as ResolutionStatus))
        .map((item, index) => {
          const key = `${String(item.entity_id ?? "unknown")}::${String(item.attribute_key ?? "unknown")}`;
          const candidatesRaw = Array.isArray(item.candidates) ? item.candidates : [];
          const candidates = candidatesRaw
            .filter((candidate): candidate is Record<string, unknown> => isRecordLike(candidate))
            .map((candidate) => ({
              value: String(candidate.value ?? ""),
              chapterIndex: Number(candidate.chapter_index ?? 0),
              chunkId: String(candidate.chunk_id ?? `chunk-${Number(candidate.chapter_index ?? 0)}`)
            }))
            .filter((candidate) => candidate.value.trim().length > 0);

          return {
            id: `${key}::${index + 1}`,
            entityId: String(item.entity_id ?? "unknown"),
            attributeKey: String(item.attribute_key ?? "unknown"),
            status: String(item.status) as ResolutionStatus,
            selectedValue: typeof item.selected_value === "string" ? item.selected_value : undefined,
            discardedValues: unique(
              (Array.isArray(item.discarded_values) ? item.discarded_values : [])
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
            ),
            patchNarrative: typeof item.patch_narrative === "string" ? item.patch_narrative : undefined,
            reason: typeof item.reason === "string" ? item.reason : undefined,
            candidates
          } satisfies ResolutionDetailItem;
        });
    }

    return rows
      .filter((row) => targetStatuses.includes(row.status as ResolutionStatus))
      .map((row, index) => {
        const key = `${row.entity_id}::${row.attribute_key}`;
        const dedupedCandidates = Array.from(
          new Map(
            (assertionIndex.get(key) ?? [])
              .sort((a, b) => a.chapterIndex - b.chapterIndex)
              .map((item) => [`${item.chapterIndex}::${item.value}`, item])
          ).values()
        );
        const selectedValue = row.selected_value;
        const discardedValues = unique(
          (row.discarded_values ?? dedupedCandidates.filter((item) => item.value !== selectedValue).map((item) => item.value)).filter(Boolean)
        );

        return {
          id: `${key}::${index + 1}`,
          entityId: row.entity_id,
          attributeKey: row.attribute_key,
          status: row.status as ResolutionStatus,
          selectedValue,
          discardedValues,
          patchNarrative: row.patch_narrative,
          reason: row.reason,
          candidates: dedupedCandidates
        } satisfies ResolutionDetailItem;
      });
  }, [localGraphs, reduceResult]);

  const reduceStatusCount = React.useMemo(() => {
    return {
      density: resolutionDetails.filter((r) => r.status === "DENSITY_FILTERED").length,
      temporal: resolutionDetails.filter((r) => r.status === "TEMPORAL_OVERRIDE").length,
      cra: resolutionDetails.filter((r) => r.status === "CRA_PATCHED").length,
      bifurcated: resolutionDetails.filter((r) => r.status === "BIFURCATED").length
    };
  }, [resolutionDetails]);

  const activeResolutionItems = React.useMemo(
    () => resolutionDetails.filter((item) => item.status === activeResolutionStatus),
    [activeResolutionStatus, resolutionDetails]
  );

  const openResolutionDrawer = (status: ResolutionStatus) => {
    setActiveResolutionStatus(status);
    setResolutionDrawerOpen(true);
  };

  const applyResolutionOverride = (item: ResolutionDetailItem, nextValue: string) => {
    setResolutionOverrides((prev) => ({
      ...prev,
      [item.id]: nextValue
    }));

    setGameState((prev) => {
      const stateTree = isRecordLike(prev.world_state.global_state_tree) ? prev.world_state.global_state_tree : null;
      if (!stateTree || !Array.isArray((stateTree as { assertions?: unknown }).assertions)) {
        return prev;
      }

      const assertions = ((stateTree as { assertions: unknown[] }).assertions as Array<Record<string, unknown>>).map((assertion) => {
        if (
          String(assertion.entity_id ?? "") === item.entityId &&
          String(assertion.attribute_key ?? "") === item.attributeKey
        ) {
          return {
            ...assertion,
            value: nextValue
          };
        }
        return assertion;
      });

      return {
        ...prev,
        world_state: {
          ...prev.world_state,
          global_state_tree: {
            ...(stateTree as Record<string, unknown>),
            assertions
          }
        }
      };
    });

    appendFeed("system", `已人工覆盖仲裁：${item.entityId}.${item.attributeKey} => ${nextValue}`);
  };

  const clearResolutionOverride = (item: ResolutionDetailItem) => {
    setResolutionOverrides((prev) => {
      if (!(item.id in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    if (item.selectedValue) {
      setGameState((prev) => {
        const stateTree = isRecordLike(prev.world_state.global_state_tree) ? prev.world_state.global_state_tree : null;
        if (!stateTree || !Array.isArray((stateTree as { assertions?: unknown }).assertions)) {
          return prev;
        }

        const assertions = ((stateTree as { assertions: unknown[] }).assertions as Array<Record<string, unknown>>).map((assertion) => {
          if (
            String(assertion.entity_id ?? "") === item.entityId &&
            String(assertion.attribute_key ?? "") === item.attributeKey
          ) {
            return {
              ...assertion,
              value: item.selectedValue
            };
          }
          return assertion;
        });

        return {
          ...prev,
          world_state: {
            ...prev.world_state,
            global_state_tree: {
              ...(stateTree as Record<string, unknown>),
              assertions
            }
          }
        };
      });
    }

    appendFeed("system", `已撤销人工覆盖：${item.entityId}.${item.attributeKey}`);
  };

  const toggleWorldline = (item: ResolutionDetailItem, chosenValue: string) => {
    setWorldlineSelections((prev) => {
      const current = prev[item.id] ?? [];
      const exists = current.includes(chosenValue);
      const nextSelection = exists ? current.filter((value) => value !== chosenValue) : [...current, chosenValue];

      setGameState((statePrev) => ({
        ...statePrev,
        world_state: {
          ...statePrev.world_state,
          worldline_preference: {
            ...((statePrev.world_state.worldline_preference as Record<string, string[]> | undefined) ?? {}),
            [item.id]: nextSelection
          }
        }
      }));

      if (nextSelection.length > 0) {
        appendFeed("system", `已更新分叉基调：${item.entityId}.${item.attributeKey} => ${nextSelection.join(" + ")}`);
      } else {
        appendFeed("system", `已清空分叉基调：${item.entityId}.${item.attributeKey}`);
      }

      return {
        ...prev,
        [item.id]: nextSelection
      };
    });
  };

  return (
    <div className="kinetic-app h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-300">
      <header className="h-[52px] shrink-0 border-b border-gray-800 bg-[#0e0e0e] px-4">
        <div className="h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-800 bg-gray-900 text-gray-300 hover:border-green-400/40 hover:text-green-300"
              title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-[18px] font-black tracking-tight text-green-400">KINETIC_ENGINE_V1</span>
            <Wand2 className="h-4 w-4 text-green-400" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500">System Console</p>
              <h1 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-200">万能文游引擎 · 创世工坊</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <div className="border border-gray-800 bg-gray-900 px-2 py-1 text-green-400 inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />Turn {gameState.world_state.current_turn}
            </div>
            <div className="border border-gray-800 bg-gray-900 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-gray-400">
              workflow mode
            </div>
          </div>
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        {sidebarOpen ? (
          <button
            aria-label="关闭侧边栏遮罩"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-black/45 backdrop-brightness-[0.6] transition"
          />
        ) : null}

        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-gray-800 bg-[#201f1f] transition-transform duration-200 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between border-b border-gray-800 px-5 py-4">
            <div>
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-green-400">CONTEXT_SIDER</h2>
              <p className="font-mono text-[9px] text-gray-500">V.04_STABLE</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200"
              title="收起侧边栏"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <nav className="py-3">
            {[1, 2, 3, 4].map((step) => {
              const active = workflowStep === step;
              const label =
                step === 1 ? "01_HUB" : step === 2 ? "02_LOGIC" : step === 3 ? "03_STUDIO" : "04_TERMINAL";
              return (
                <button
                  key={`side-step-${step}`}
                  onClick={() => {
                    goToWorkflowStep(step as WorkflowStep);
                    setSidebarOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                    active ? "border-l-4 border-green-400 bg-[#353534] text-green-300" : "text-gray-500 hover:bg-[#353534]"
                  }`}
                >
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mx-4 mb-3 border border-gray-800 bg-[#141414]">
            <div className="border-b border-gray-800 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">FILE_HISTORY</p>
              <p className="text-[10px] text-gray-600">已处理小说记录（本机）</p>
            </div>
            <div className="max-h-44 overflow-y-auto px-2 py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
              {processedNovelHistory.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-gray-500">暂无记录，上传并处理小说后会自动写入。</p>
              ) : (
                <div className="space-y-1.5">
                  {processedNovelHistory.map((item) => (
                    <div key={item.id} className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
                      <p className="truncate text-[11px] text-gray-300" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-500">
                        {item.chunkCount} 切片 · {item.charCount.toLocaleString("zh-CN")} 字
                      </p>
                      <p className="text-[10px] text-gray-600">
                        {new Date(item.processedAt).toLocaleString("zh-CN", { hour12: false })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-gray-800 bg-[#0e0e0e]/50 px-4 py-3">
            <p className="font-mono text-[10px] text-gray-300">System Operator</p>
            <p className="font-mono text-[9px] text-green-400">STATUS: ONLINE</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 overflow-hidden">
        <section
          className={`${
            runtimeSurfaceVisible && workflowStep === 4
              ? "order-2 flex w-[44%] flex-col border-l border-gray-800 bg-gray-950"
              : "hidden"
          }`}
        >
          <div className="shrink-0 border-b border-gray-800 bg-gray-900/40 px-4 py-3 text-xs flex items-center justify-between">
            <span className="text-gray-500">游玩渲染区（Play）</span>
            <div className="flex items-center gap-2">
              <span className={plotMode === "FOLLOW_CANON" ? "text-green-400" : "text-yellow-500"}>
                {plotMode === "FOLLOW_CANON" ? "顺应原著模式" : "动态沙盒模式"}
              </span>
              <div className="inline-flex rounded border border-gray-800 bg-gray-900 p-0.5">
                <button
                  onClick={() => setLeftPanelMode("play")}
                  className={`rounded px-2 py-1 text-[11px] ${
                    leftPanelMode === "play" ? "bg-blue-500/20 text-blue-300" : "text-gray-500"
                  }`}
                >
                  剧情渲染
                </button>
                <button
                  disabled={!mitaEnabled}
                  onClick={() => setLeftPanelMode("mita")}
                  className={`rounded px-2 py-1 text-[11px] ${
                    leftPanelMode === "mita" ? "bg-indigo-500/20 text-indigo-300" : "text-gray-500"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  title={mitaEnabled ? "切换到秘塔AI" : "请先在右侧“游戏卡”页激活秘塔AI"}
                >
                  秘塔AI
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
            {leftPanelMode === "play" ? (
              <>
                {waitingCardStart ? (
                  <div className="mb-3 rounded border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
                    已生成游戏卡。请先在右侧“游戏卡”页点击“开始推演”，再进入回合推进。
                  </div>
                ) : null}
                {cardRuntimeProgress.total > 0 ? (
                  <div className="mb-3 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between text-blue-300">
                      <span>游戏卡推进进度</span>
                      <span>
                        {cardRuntimeProgress.current}/{cardRuntimeProgress.total}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-950/70">
                      <div
                        className="h-full bg-blue-400/80 transition-all duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, cardRuntimeProgress.percent))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-blue-200/90">{cardRuntimeProgress.label}</p>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {feed.map((entry) => {
                    const cls =
                      entry.role === "player"
                        ? "ml-auto max-w-[86%] border-blue-500/30 bg-blue-500/10 text-blue-300"
                        : entry.role === "system"
                          ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-500"
                          : "border-purple-500/25 bg-purple-500/10 text-gray-200";
                    return (
                      <div key={entry.id} className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
                        <p className="mb-1 text-[10px] opacity-80">回合 {entry.turn}</p>
                        <p>{entry.content}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col">
                {!mitaEnabled ? (
                  <div className="rounded border border-dashed border-gray-800 bg-gray-900/40 px-3 py-3 text-xs text-gray-500">
                    秘塔AI尚未激活。请在右侧“游戏卡”面板点击“秘塔AI”按钮后使用。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mitaHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-md border px-3 py-2 text-sm ${
                          entry.role === "user"
                            ? "ml-auto max-w-[88%] border-blue-500/30 bg-blue-500/10 text-blue-300"
                            : entry.role === "assistant"
                              ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-100"
                              : "border-yellow-500/25 bg-yellow-500/10 text-yellow-500"
                        }`}
                      >
                        <p className="mb-1 text-[10px] opacity-80">{entry.role === "user" ? "创作者" : "秘塔AI"}</p>
                        <p className="whitespace-pre-wrap">{entry.content}</p>
                      </div>
                    ))}
                    {mitaLoading ? (
                      <div className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
                        <p className="mb-1 text-[10px] opacity-80">秘塔AI</p>
                        <p className="inline-flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在等待 LLM 生成回复...
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-80 shrink-0 border-t border-gray-800 bg-[#0a0a0c] px-4 py-3">
            {leftPanelMode === "play" ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs tracking-wide text-gray-500">可选行动</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlotMode((prev) => (prev === "FOLLOW_CANON" ? "SANDBOX" : "FOLLOW_CANON"))}
                      className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:border-gray-600"
                    >
                      切换为{plotMode === "FOLLOW_CANON" ? "沙盒" : "原著"}
                    </button>
                    <button
                      onClick={onUndoTurn}
                      className="inline-flex items-center gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-500"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />撤销本回合
                    </button>
                  </div>
                </div>
                {audioNowPlaying ? (
                  <div className="mb-2 flex items-center justify-between rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-200">
                    <span>
                      音频播放中：[{audioNowPlaying.kind}] {shorten(audioNowPlaying.name, 48)}
                    </span>
                    <button
                      onClick={stopAudioPreview}
                      className="rounded border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-100"
                    >
                      停止
                    </button>
                  </div>
                ) : null}
                <div className="max-h-36 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                  <div className="grid grid-cols-1 gap-2">
                    {availableActionViews.map((action) => (
                      <button
                        key={action.action_id}
                        disabled={!action.conditionPassed}
                        onClick={() => setTurnActionId(action.action_id)}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                          !action.conditionPassed
                            ? "cursor-not-allowed border-gray-800 bg-gray-900/60 text-gray-500"
                            : turnActionId === action.action_id
                            ? "border-blue-400/60 bg-blue-500/10 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                            : "border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700"
                        }`}
                      >
                        <p>{action.displayText}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {action.required_stats && Object.keys(action.required_stats).length > 0
                            ? `需求：${JSON.stringify(action.required_stats)}`
                            : "无属性门槛"}
                        </p>
                        {!action.conditionPassed && action.unmetConditions.length > 0 ? (
                          <p className="mt-1 text-[11px] text-yellow-500">条件不足：{action.unmetConditions.join(" 且 ")}</p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-[1fr_96px] gap-2">
                  <input
                    value={customActionText}
                    onChange={(e) => setCustomActionText(e.target.value)}
                    placeholder="输入自定义行动，例如：翻墙潜入后院"
                    className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-300 placeholder:text-gray-500 focus:border-blue-400/50 focus:outline-none"
                  />
                  <button
                    onClick={onUseCustomAction}
                    className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-2 text-xs text-indigo-300 hover:border-indigo-400/60"
                  >
                    添加行动
                  </button>
                </div>

                <button
                  onClick={onRunTurn}
                  disabled={loading.turn || !turnActionId.trim() || waitingCardStart}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm text-purple-300 hover:border-purple-400/60 disabled:opacity-60"
                >
                  {loading.turn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}推进下一回合
                </button>
              </>
            ) : (
              <div className="h-full flex flex-col justify-between">
                <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-500">
                  <p>秘塔AI仅回答游戏卡 Markdown 范围内问题。</p>
                  <p className="mt-1">回答风格：直给结论，不寒暄，不越界。</p>
                </div>
                <div className="mt-3 grid grid-cols-[112px_1fr_84px] gap-2">
                  <select
                    value={mitaPreset}
                    onChange={(e) => setMitaPreset(e.target.value === "CREATIVE" ? "CREATIVE" : "STRICT")}
                    className="rounded border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-indigo-200"
                  >
                    <option value="STRICT">严谨 0.25</option>
                    <option value="CREATIVE">灵感 0.70</option>
                  </select>
                  <input
                    value={mitaInput}
                    onChange={(e) => setMitaInput(e.target.value)}
                    placeholder="例如：请把 Act 3 的关键场景改成更高冲突版本"
                    className="rounded border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!mitaLoading) {
                          void onAskMita();
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => void onAskMita()}
                    disabled={mitaLoading || !mitaEnabled}
                    className="inline-flex items-center justify-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-2 text-xs text-indigo-300 disabled:opacity-50"
                  >
                    {mitaLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    提问
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section
          className={`${
            runtimeSurfaceVisible && workflowStep === 4 ? "order-1 w-[56%]" : "w-full"
          } flex flex-col bg-[#0a0a0c]`}
        >
          <div className="shrink-0 border-b border-gray-800">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-1.5">
                {[
                  { step: 1 as const, title: "导入", desc: "上传与切片" },
                  { step: 2 as const, title: "解析", desc: "自动仲裁" },
                  { step: 3 as const, title: "定制", desc: "风格与人物" },
                  { step: 4 as const, title: "游戏卡", desc: "编辑与预览" }
                ].map((item) => {
                  const active = workflowStep === item.step;
                  const done =
                    (item.step === 1 && workflowGateState.step1Ready) ||
                    (item.step === 2 && workflowGateState.step2Ready) ||
                    (item.step === 3 && workflowGateState.step3Ready) ||
                    (item.step === 4 && workflowGateState.step4Ready);
                  const lockedReason = workflowStepLocks[item.step];
                  const locked = !!lockedReason;
                  return (
                    <button
                      key={`workflow-step-${item.step}`}
                      onClick={() => goToWorkflowStep(item.step)}
                      disabled={locked && !active}
                      title={lockedReason ?? (workflowGateState.canFreeNavigate ? "自由切换" : "按流程推进")}
                      className={`rounded border px-2.5 py-1.5 text-left transition ${
                        active
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                          : done
                            ? "border-green-500/40 bg-green-500/10 text-green-300"
                            : locked
                              ? "border-gray-800 bg-gray-950 text-gray-600"
                              : "border-gray-800 bg-gray-950 text-gray-500 hover:text-gray-300"
                      } disabled:cursor-not-allowed`}
                    >
                      <p className="flex items-center gap-1 text-[11px]">
                        {locked ? <Lock className="h-3 w-3" /> : done ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {item.step}. {item.title}
                      </p>
                      <p className="text-[10px] opacity-80">{locked ? "步骤锁定" : item.desc}</p>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => goToWorkflowStep((workflowStep <= 3 ? workflowStep + 1 : 4) as WorkflowStep)}
                  disabled={!!nextStepLockReason || workflowStep === 4}
                  title={nextStepLockReason ?? "推进到下一步"}
                  className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {workflowStep === 4 ? "当前已是最后一步" : "下一步"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
            {apiError ? (
              <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                API 错误：{apiError}
              </div>
            ) : null}
            <div className="mb-4">
              <div className="rounded border border-gray-800 bg-gray-900 px-3 py-2 text-[11px] text-gray-400">
                <p>
                  严格门控：{workflowGateState.canFreeNavigate ? "已完成全部步骤，可自由切换" : "未完成前不可跳步/不可回退"}
                </p>
                <p className="mt-1">
                  渲染区状态：
                  {runtimeSurfaceVisible && workflowStep === 4 ? "已激活（04_TERMINAL）" : "当前隐藏（仅04阶段显示）"}
                </p>
              </div>
            </div>

            {rightTab === "guide" ? (
              <div className={guideStage === 1 ? "grid gap-4 lg:grid-cols-[1.6fr_1fr]" : "grid gap-4 lg:grid-cols-[1.1fr_1.3fr]"}>
                <section className="border border-gray-800 bg-gray-900 p-4">
                  <div className="mb-4 flex items-center justify-between border-b border-gray-800 pb-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                        {guideStage === 1 ? "01_HUB" : "02_LOGIC"}
                      </p>
                      <h2 className="text-sm uppercase tracking-[0.08em] text-gray-200">
                        {guideStage === 1 ? "项目导入与切片控制台" : "冲突仲裁与状态树合并"}
                      </h2>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.epub,text/plain,application/epub+zip"
                      onChange={onUploadFile}
                      className="hidden"
                    />
                    {guideStage === 1 ? (
                      <p className="text-xs text-gray-500">支持拖拽上传或手动选择文件</p>
                    ) : (
                      <p className="inline-flex items-center gap-1 border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300">
                        <GitMerge className="h-3.5 w-3.5" />
                        已自动完成冲突仲裁
                      </p>
                    )}
                  </div>

                  {guideStage === 1 ? (
                    <div className="space-y-4 text-xs">
                      <div
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setUploadDragOver(true);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setUploadDragOver(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setUploadDragOver(false);
                        }}
                        onDrop={(e) => void onDropUploadFile(e)}
                        className={`rounded border-2 border-dashed px-6 py-12 text-center transition ${
                          uploadDragOver
                            ? "border-green-400/60 bg-green-500/10"
                            : "border-green-400/35 bg-[#111213]"
                        }`}
                      >
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded border border-gray-700 bg-gray-900 text-green-400">
                          {loading.upload ? <Loader2 className="h-7 w-7 animate-spin" /> : <FileUp className="h-7 w-7" />}
                        </div>
                        <p className="mt-4 text-2xl tracking-tight text-gray-200">Drop .txt / .epub here</p>
                        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500">
                          MAX_FILE_SIZE: 128MB // UTF-8 ONLY
                        </p>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={loading.upload}
                          className="mt-5 inline-flex items-center gap-2 border border-gray-700 bg-gray-800 px-6 py-2 text-sm tracking-[0.08em] text-gray-200 hover:border-green-400/50 hover:text-green-300 disabled:opacity-60"
                        >
                          {loading.upload ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          BROWSE_FILES
                        </button>
                      </div>

                      <div className="rounded border border-gray-800 bg-gray-950 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Chunk Size</span>
                          <span className="border border-gray-800 bg-gray-900 px-2 py-1 text-center font-mono text-green-300">{chunkSize}</span>
                        </div>
                        <input
                          type="range"
                          min={1200}
                          max={40000}
                          step={100}
                          value={chunkSize}
                          onChange={(e) => onAdjustChunkSizeBeforeParse(Number(e.target.value))}
                          disabled={!sourceRawText.trim() || loading.mapBatch || fullParseJob?.status === "RUNNING"}
                          className="h-1 w-full appearance-none bg-gray-800 accent-green-400 disabled:opacity-50"
                        />
                        <p className="mt-2 text-[11px] text-gray-500">
                          上传后可实时调整切片长度（越短越精细，解析越慢）。推荐先用 3200~5000 快速完成首轮解析。
                        </p>
                      </div>

                      <label className="block text-gray-500">
                        Baseline Context
                        <textarea
                          value={baselineContext}
                          onChange={(e) => setBaselineContext(e.target.value)}
                          className="mt-1 h-24 w-full resize-none border border-gray-800 bg-gray-950 px-2 py-2 font-mono text-xs text-gray-300"
                          placeholder="可选：给解析器补充世界观基线（例如：时间点、势力关系、隐性规则约束）"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {[
                          { title: "密度过滤", status: "DENSITY_FILTERED", count: reduceStatusCount.density, tone: "text-blue-300" },
                          { title: "时序覆写", status: "TEMPORAL_OVERRIDE", count: reduceStatusCount.temporal, tone: "text-green-400" },
                          { title: "CRA补丁", status: "CRA_PATCHED", count: reduceStatusCount.cra, tone: "text-green-300" },
                          { title: "平行分叉", status: "BIFURCATED", count: reduceStatusCount.bifurcated, tone: "text-red-400" }
                        ].map((item) => (
                          <button
                            key={item.title}
                            onClick={() => openResolutionDrawer(item.status as ResolutionStatus)}
                            className="border border-gray-800 bg-gray-950 px-3 py-2 text-left"
                          >
                            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">{item.title}</p>
                            <p className={`mt-1 text-lg ${item.tone}`}>{item.count}</p>
                            <p className="text-[10px] text-gray-500">查看模块日志</p>
                          </button>
                        ))}
                      </div>

                      {reduceResult ? (
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          {reduceResult.requires_bifurcation ? (
                            <div className="inline-flex items-center gap-2 text-yellow-400">
                              <AlertTriangle className="h-4 w-4" />发现可能冲突分支（建议人工复核）
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2 text-green-400">
                              <CheckCircle2 className="h-4 w-4" />合并稳定，可进入定制阶段
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="border border-dashed border-gray-800 bg-gray-950 px-3 py-2 text-gray-500">尚未执行 Reduce。</div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => goToWorkflowStep(1)}
                          className="border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-300"
                        >
                          返回导入
                        </button>
                        <button
                          onClick={() => goToWorkflowStep(3)}
                          className="border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300"
                        >
                          进入定制
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                <aside className="border border-gray-800 bg-gray-900 p-4">
                  {guideStage === 1 ? (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">FILE</p>
                          <p className="mt-1 truncate text-gray-300" title={sourceFileName}>{sourceFileName}</p>
                        </div>
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">CHUNKS</p>
                          <p className="mt-1 text-lg text-green-400">{allChunks.length}</p>
                        </div>
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">PARSED</p>
                          <p className="mt-1 text-lg text-green-300">{localGraphs.length}</p>
                        </div>
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">PAYLOAD</p>
                          <p className={`mt-1 ${fullParsePayloadBytes > 19 * 1024 * 1024 ? "text-red-400" : "text-yellow-500"}`}>
                            {formatBytes(fullParsePayloadBytes)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Chunk Preview</p>
                        <button
                          onClick={() => setChunkBrowserOpen(true)}
                          disabled={allChunks.length === 0}
                          className="border border-gray-800 bg-gray-950 px-2 py-1 text-xs text-green-300 disabled:opacity-50"
                        >
                          打开总览
                        </button>
                      </div>

                      <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                        {allChunks.length === 0 ? (
                          <div className="border border-dashed border-gray-800 bg-gray-950 px-3 py-2 text-gray-500">暂无切片预览</div>
                        ) : (
                          allChunks.slice(0, 16).map((chunk, idx) => (
                            <button
                              key={`chunk-${idx}`}
                              onClick={() => setSelectedChunkIndex(idx)}
                              className={`w-full border px-3 py-2 text-left ${
                                selectedChunkIndex === idx
                                  ? "border-green-500/40 bg-green-500/10 text-green-300"
                                  : "border-gray-800 bg-gray-950 text-gray-400"
                              }`}
                            >
                              <p className="font-mono text-[10px] uppercase tracking-[0.12em]">Chunk {idx + 1}</p>
                              <p className="mt-1 line-clamp-2 text-xs">{chunk.slice(0, 120)}...</p>
                            </button>
                          ))
                        )}
                      </div>

                      {fullParseJob ? (
                        <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                          <div className="flex items-center justify-between text-gray-400">
                            <span>任务：{fullParseJob.status}</span>
                            <span>{fullParseJob.progress.mapped_chunks}/{fullParseJob.progress.total_chunks}</span>
                          </div>
                          <div className="mt-2 h-1 overflow-hidden bg-gray-800">
                            <div
                              className={`h-full ${fullParseJob.status === "FAILED" ? "bg-red-500/80" : "bg-green-500/80"} transition-all duration-300`}
                              style={{ width: `${Math.max(0, Math.min(100, fullParseJob.progress.percentage))}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-gray-500">{fullParseJob.progress.message ?? "解析进行中..."}</p>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2">
                          <button
                            onClick={onMapBatch}
                            disabled={
                              loading.mapBatch ||
                              !workflowGateState.step1Ready ||
                              allChunks.length === 0 ||
                              fullParseJob?.status === "RUNNING" ||
                              fullParseJob?.status === "PAUSED"
                            }
                            className="inline-flex items-center justify-center gap-1 border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300 disabled:opacity-50"
                          >
                            {loading.mapBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                            一键全局解析
                          </button>
                          {workflowGateState.step2Ready ? (
                            <button
                              onClick={() => goToWorkflowStep(2)}
                              className="w-full border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300"
                            >
                              进入步骤 2：解析仲裁
                            </button>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {fullParseJob?.status === "RUNNING" ? (
                            <button
                              onClick={onPauseMapBatch}
                              className="inline-flex items-center gap-1 border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500"
                            >
                              暂停解析
                            </button>
                          ) : null}
                          {fullParseJob?.status === "PAUSED" ? (
                            <button
                              onClick={onResumeMapBatch}
                              disabled={loading.mapBatch}
                              className="inline-flex items-center gap-1 border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400"
                            >
                              {loading.mapBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              恢复解析
                            </button>
                          ) : null}
                          <button
                            onClick={() => setWizardOpen(true)}
                            className="inline-flex items-center gap-1 border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500"
                          >
                            <Brain className="h-3.5 w-3.5" />残稿补全向导
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">GLOBAL TREE</p>
                        <p className="mt-1 text-gray-300">
                          {reduceResult ? `实体 ${Object.keys(reduceResult.global_state_tree.entities).length} / 断言 ${reduceResult.global_state_tree.assertions.length}` : "未生成"}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          实体：世界中的对象（角色/势力/物品/地点）；断言：关于实体属性或规则的结构化结论。
                        </p>
                      </div>

                      <div className="border border-gray-800 bg-gray-950 px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">RESOLUTION REPORT</p>
                        {reduceResult?.resolution_report?.length ? (
                          <div className="mt-2 max-h-[460px] space-y-2 overflow-y-auto pr-1">
                            {reduceResult.resolution_report.slice(0, 22).map((item, idx) => (
                              <div
                                key={`${item.entity_id}-${item.attribute_key}-${idx}`}
                                className="w-full border border-gray-800 bg-gray-900 px-2 py-2 text-left"
                              >
                                <p className="text-[11px] text-gray-300">{formatResolutionKeyLabel(item.entity_id, item.attribute_key)}</p>
                                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-green-400">{item.status}</p>
                                <details className="mt-1 rounded border border-gray-800 bg-gray-950 px-2 py-1">
                                  <summary className="cursor-pointer text-[10px] text-gray-500">查看字段代码</summary>
                                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-gray-400">
{`entity_id: "${item.entity_id}"
attribute_key: "${item.attribute_key}"
selected_value: "${item.selected_value ?? ""}"
status: "${item.status}"`}
                                  </pre>
                                </details>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-gray-500">暂无仲裁条目</p>
                        )}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            ) : null}

            {rightTab === "debug" ? (
              <div className="grid gap-4 lg:grid-cols-[0.92fr_1.28fr]">
                <section className="border border-gray-800 bg-gray-900 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">03_STUDIO</p>
                  <h2 className="text-sm text-gray-200">风格定制（紧凑）</h2>

                  <div className="mt-3 rounded border border-gray-800 bg-gray-950 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">当前风格预览</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void onRecommendVisualStylePresets()}
                          disabled={stylePresetLoading || !workflowGateState.step2Ready}
                          className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-300 disabled:opacity-50"
                        >
                          {stylePresetLoading ? "LLM生成中..." : "重算4套动态预设"}
                        </button>
                        <button
                          onClick={() => selectedVisualPreset && void onGenerateStylePreview(selectedVisualPreset, { force: true })}
                          disabled={!selectedVisualPreset}
                          className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300 disabled:opacity-50"
                        >
                          生成预览
                        </button>
                        <button
                          onClick={() => selectedVisualPreset && void onGenerateStylePreview(selectedVisualPreset, { force: true, markAsAuto: true })}
                          disabled={!selectedVisualPreset}
                          className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300 disabled:opacity-50"
                        >
                          重试
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 h-48 overflow-hidden rounded border border-gray-800 bg-gray-900">
                      {selectedVisualPreset && stylePreviewMap[selectedVisualPreset.id]?.status === "ready" ? (
                        <img
                          src={stylePreviewMap[selectedVisualPreset.id]?.imageUrl}
                          alt={`${selectedVisualPreset.name} style preview`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                          {selectedVisualPreset && stylePreviewMap[selectedVisualPreset.id]?.status === "loading"
                            ? "正在生成风格预览..."
                            : "尚未生成预览图"}
                        </div>
                      )}
                    </div>

                    {selectedVisualPreset && stylePreviewMap[selectedVisualPreset.id]?.error ? (
                      <p className="mt-2 text-[11px] text-red-400">{stylePreviewMap[selectedVisualPreset.id]?.error}</p>
                    ) : null}
                    {stylePresetError ? <p className="mt-2 text-[11px] text-yellow-400">动态预设生成失败：{stylePresetError}</p> : null}
                    {selectedVisualPreset?.originReason ? (
                      <p className="mt-2 text-[11px] text-gray-500">
                        {selectedVisualPreset.source === "NOVEL_ANALYZED" ? "小说信号推荐" : "题材回退推荐"}：{selectedVisualPreset.originReason}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded border border-gray-800 bg-gray-950 p-3">
                    <p className="text-xs text-gray-500">4 套风格预设</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {visualStylePresets.map((preset) => {
                        const active = selectedVisualPreset?.id === preset.id;
                        const preview = stylePreviewMap[preset.id];
                        const statusText =
                          preview?.status === "ready"
                            ? "已生成"
                            : preview?.status === "loading"
                              ? "生成中"
                              : preview?.status === "error"
                                ? "失败"
                                : "未生成";

                        return (
                          <button
                            key={`style-preset-${preset.id}`}
                            onClick={() => {
                              setSelectedVisualPresetId(preset.id);
                              setCustomizationSaved(false);
                            }}
                            className={`rounded border px-3 py-2 text-left transition ${
                              active
                                ? "border-indigo-500/50 bg-indigo-500/10"
                                : "border-gray-800 bg-gray-900 hover:border-gray-700"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <p className={`text-xs ${active ? "text-indigo-200" : "text-gray-200"}`}>{preset.name}</p>
                              <span className="text-[10px] text-gray-500">{statusText}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">{preset.tone} · {preset.palette}</p>
                            {autoRecommendedStyleId === preset.id ? (
                              <p className="mt-1 text-[10px] text-green-400">系统推荐</p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="mt-3 block rounded border border-gray-800 bg-gray-950 p-3 text-xs text-gray-500">
                    风格预设 Prompt（可自定义）
                    <textarea
                      value={customStylePrompt}
                      onChange={(e) => {
                        setCustomStylePrompt(e.target.value);
                        setCustomizationSaved(false);
                      }}
                      className="mt-2 h-24 w-full resize-none rounded border border-gray-800 bg-gray-900 px-2 py-2 font-mono text-[11px] text-gray-300"
                      placeholder="例如：冷峻纪实构图，低饱和蓝灰主色，逆光强对比，保持东方奇幻质感。"
                    />
                  </label>
                </section>

                <section className="border border-gray-800 bg-gray-900 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">PROFILE_EDITOR</p>
                  <h2 className="text-sm text-gray-200">人物主控区（角色列表、外貌、属性、声线）</h2>

                  <input
                    ref={characterRefInputRef}
                    type="file"
                    accept="image/*,.png,.jpg,.jpeg,.webp,.bmp"
                    onChange={onUploadCharacterReferenceImage}
                    className="hidden"
                  />
                  <input
                    ref={debugMaterialInputRef}
                    type="file"
                    multiple
                    accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
                    onChange={onUploadMaterials}
                    className="hidden"
                  />

                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_250px]">
                    <div className="space-y-3">
                      <div className="rounded border border-gray-800 bg-gray-950 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-500">角色列表（点击切换当前编辑人物）</span>
                          <span className="text-[11px] text-indigo-300">{coreCharacterOptions.length + 1} 个可选</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {coreCharacterOptions.map((option) => (
                            <button
                              key={`role-tag-${option.entity_id}`}
                              onClick={() => {
                                applyCharacterSelection(option.entity_id);
                                setSelectedPortraitCharacterId(option.entity_id);
                                setCustomizationSaved(false);
                              }}
                              className={`rounded border px-2 py-1 text-[11px] transition ${
                                selectedCharacterId === option.entity_id
                                  ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                                  : "border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700"
                              }`}
                            >
                              {option.name}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              applyCharacterSelection(CUSTOM_CHARACTER_OPTION);
                              setSelectedPortraitCharacterId(CUSTOM_CHARACTER_OPTION);
                              setCustomizationSaved(false);
                            }}
                            className={`rounded border px-2 py-1 text-[11px] transition ${
                              selectedCharacterId === CUSTOM_CHARACTER_OPTION
                                ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                                : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400/50"
                            }`}
                          >
                            [+] 自定义新角色
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-500">切换后可直接修改该角色的外貌、数值、背包与声线。</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-gray-500">
                          名称
                          <input
                            readOnly={!isCustomCharacter}
                            value={playerBiography.name}
                            onChange={(e) => {
                              setGameState((prev) => ({
                                ...prev,
                                player_entity: {
                                  ...ensurePlayerEntity(prev),
                                  biography: {
                                    ...(ensurePlayerEntity(prev).biography ?? {
                                      name: "玩家",
                                      age: 18,
                                      gender: "未知",
                                      origin_background: "未设定",
                                      appearance: ""
                                    }),
                                    name: e.target.value
                                  }
                                }
                              }));
                              setCustomizationSaved(false);
                            }}
                            className={`mt-1 w-full rounded border px-2 py-1.5 ${
                              isCustomCharacter
                                ? "border-gray-800 bg-gray-950 text-gray-300"
                                : "border-gray-800 bg-gray-900 text-gray-500"
                            }`}
                          />
                        </label>
                        <label className="text-xs text-gray-500">
                          出身/传记
                          <input
                            readOnly={!isCustomCharacter}
                            value={playerBiography.origin_background}
                            onChange={(e) => {
                              setGameState((prev) => ({
                                ...prev,
                                player_entity: {
                                  ...ensurePlayerEntity(prev),
                                  biography: {
                                    ...(ensurePlayerEntity(prev).biography ?? {
                                      name: "玩家",
                                      age: 18,
                                      gender: "未知",
                                      origin_background: "未设定",
                                      appearance: ""
                                    }),
                                    origin_background: e.target.value
                                  }
                                }
                              }));
                              setCustomizationSaved(false);
                            }}
                            className={`mt-1 w-full rounded border px-2 py-1.5 ${
                              isCustomCharacter
                                ? "border-gray-800 bg-gray-950 text-gray-300"
                                : "border-gray-800 bg-gray-900 text-gray-500"
                            }`}
                          />
                        </label>
                      </div>

                      <div className="rounded border border-gray-800 bg-gray-950 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-gray-500">调整角色（立绘 / 声线）</p>
                          <select
                            value={selectedPortraitCharacter?.entity_id ?? ""}
                            onChange={(e) => {
                              setSelectedPortraitCharacterId(e.target.value);
                              setCustomizationSaved(false);
                            }}
                            className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                          >
                            {portraitCharacterOptions.map((option) => (
                              <option key={`portrait-char-${option.entity_id}`} value={option.entity_id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <label className="mt-2 block text-xs text-gray-500">
                          外貌特征 / 当前人物生成 Prompt（可直接编辑）
                          <textarea
                            value={selectedPortraitPrompt}
                            onChange={(e) => {
                              if (!selectedPortraitCharacter) {
                                return;
                              }
                              const nextValue = e.target.value;
                              setCharacterPromptDraftMap((prev) => ({
                                ...prev,
                                [selectedPortraitCharacter.entity_id]: nextValue
                              }));
                              if (selectedPortraitCharacter.entity_id === selectedCharacterId) {
                                setGameState((prev) => ({
                                  ...prev,
                                  player_entity: {
                                    ...ensurePlayerEntity(prev),
                                    biography: {
                                      ...(ensurePlayerEntity(prev).biography ?? {
                                        name: "玩家",
                                        age: 18,
                                        gender: "未知",
                                        origin_background: "未设定",
                                        appearance: ""
                                      }),
                                      appearance: nextValue
                                    }
                                  }
                                }));
                              }
                              setCustomizationSaved(false);
                            }}
                            onBlur={(e) => {
                              if (selectedPortraitCharacter?.entity_id === selectedCharacterId) {
                                persistSelectedCharacterProfile({ appearance: e.target.value });
                              }
                            }}
                            className="mt-1 h-28 w-full resize-none rounded border border-gray-800 bg-gray-900 px-2 py-2 font-mono text-[11px] text-gray-300"
                            placeholder="聚焦人物外貌，不混入剧情剧透：五官、体型、服装、标志武器、表情与姿态。"
                          />
                        </label>

                        {selectedPortraitPreview?.prompt ? (
                          <p className="mt-1 text-[11px] text-indigo-300">
                            最近一次模型执行 Prompt 已记录，可继续手动微调。
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => characterRefInputRef.current?.click()}
                            className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300"
                          >
                            上传角色参考图
                          </button>
                          <button
                            onClick={() => {
                              if (!selectedPortraitCharacter) {
                                return;
                              }
                              setCharacterPromptDraftMap((prev) => ({
                                ...prev,
                                [selectedPortraitCharacter.entity_id]: buildCharacterPortraitPrompt({
                                  character: selectedPortraitCharacter,
                                  globalFeaturePrompt: characterFeaturePrompt
                                })
                              }));
                              setCustomizationSaved(false);
                            }}
                            disabled={!selectedPortraitCharacter}
                            className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300 disabled:opacity-50"
                          >
                            重新生成人物 Prompt
                          </button>
                          <button
                            onClick={() => void onGenerateCharacterRestyle()}
                            disabled={!selectedVisualPreset || !selectedPortraitCharacter || selectedPortraitPreview?.status === "loading"}
                            className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-300 disabled:opacity-50"
                          >
                            {selectedPortraitPreview?.status === "loading" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            生成人物立绘
                          </button>
                        </div>
                      </div>

                      <div className="rounded border border-gray-800 bg-gray-950 p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-gray-500">人物声线（按“调整角色”独立绑定）</p>
                          <div className="inline-flex rounded border border-gray-800 bg-gray-900 p-0.5">
                            <button
                              onClick={() => {
                                setVoiceMode("UPLOAD_CLONE");
                                updateSelectedCharacterVoiceDraft({ mode: "UPLOAD_CLONE" });
                              }}
                              className={`rounded px-2 py-1 text-[11px] ${
                                voiceMode === "UPLOAD_CLONE" ? "bg-green-500/20 text-green-300" : "text-gray-500"
                              }`}
                            >
                              上传声线
                            </button>
                            <button
                              onClick={() => {
                                setVoiceMode("AI_RANDOM");
                                updateSelectedCharacterVoiceDraft({ mode: "AI_RANDOM" });
                              }}
                              className={`rounded px-2 py-1 text-[11px] ${
                                voiceMode === "AI_RANDOM" ? "bg-indigo-500/20 text-indigo-300" : "text-gray-500"
                              }`}
                            >
                              AI 克隆
                            </button>
                          </div>
                        </div>

                        {voiceMode === "UPLOAD_CLONE" ? (
                          <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] gap-2">
                            <select
                              value={selectedVoiceMaterialId}
                              onChange={(e) => {
                                setSelectedVoiceMaterialId(e.target.value);
                                updateSelectedCharacterVoiceDraft({ material_id: e.target.value, mode: "UPLOAD_CLONE" });
                              }}
                              className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300"
                            >
                              <option value="">未选择声线素材</option>
                              {voiceMaterials.map((item) => (
                                <option key={`voice-material-${item.id}`} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => debugMaterialInputRef.current?.click()}
                              className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300"
                            >
                              上传
                            </button>
                            <button
                              onClick={() => void onCloneVoiceFromMaterial()}
                              className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1.5 text-xs text-green-300"
                            >
                              一键克隆
                            </button>
                            <button
                              disabled={!selectedVoiceMaterial}
                              onClick={() => selectedVoiceMaterial && void onPreviewMaterialAudio(selectedVoiceMaterial)}
                              className="inline-flex items-center gap-1 rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" />
                              试听
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                            <input
                              value={voicePrompt}
                              onChange={(e) => {
                                const nextPrompt = e.target.value;
                                setVoicePrompt(nextPrompt);
                                updateSelectedCharacterVoiceDraft({ prompt: nextPrompt, mode: "AI_RANDOM", material_id: "" });
                              }}
                              className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-300"
                              placeholder="输入声线描述 Prompt（例如：克制冷峻、低频、断句短）"
                            />
                            <button
                              onClick={() => void onGenerateRandomVoicePreset()}
                              className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1.5 text-xs text-indigo-300"
                            >
                              <Mic className="h-3.5 w-3.5" />
                              一键生成
                            </button>
                          </div>
                        )}

                        <details className="mt-2 rounded border border-gray-800 bg-gray-900 px-2 py-1.5">
                          <summary className="cursor-pointer text-[11px] text-gray-400">远程克隆接口配置（预留）</summary>
                          <div className="mt-2 grid grid-cols-1 gap-2 text-xs">
                            <input
                              value={voiceGatewayConfig.endpoint}
                              onChange={(e) => {
                                setVoiceGatewayConfig((prev) => ({ ...prev, endpoint: e.target.value }));
                                setCustomizationSaved(false);
                              }}
                              placeholder="endpoint (future)"
                              className="rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-gray-300"
                            />
                            <input
                              value={voiceGatewayConfig.model}
                              onChange={(e) => {
                                setVoiceGatewayConfig((prev) => ({ ...prev, model: e.target.value }));
                                setCustomizationSaved(false);
                              }}
                              placeholder="model (future)"
                              className="rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-gray-300"
                            />
                          </div>
                        </details>

                        {audioNowPlaying?.kind === "VOICE" ? (
                          <p className="mt-1 text-[11px] text-indigo-300">当前试听：{shorten(audioNowPlaying.name, 30)}</p>
                        ) : null}
                      </div>

                      <div className="space-y-3 rounded border border-gray-800 bg-gray-950 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500">角色数值与背包</p>
                          <button
                            onClick={() => {
                              if (!isCustomCharacter) {
                                return;
                              }
                              setGameState((prev) => {
                                const nextPlayer = ensurePlayerEntity(prev);
                                return {
                                  ...prev,
                                  player_entity: {
                                    ...nextPlayer,
                                    core_attributes: buildCoreAttributesByTemplate(
                                      rpgGlobalAttributes,
                                      customRecommendedStats,
                                      nextPlayer.core_attributes ?? {}
                                    )
                                  }
                                };
                              });
                              appendFeed("system", "已应用 LLM 推荐的自定义角色初始属性。");
                            }}
                            disabled={!isCustomCharacter}
                            className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-300 disabled:opacity-50"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            AI 推荐属性
                          </button>
                        </div>

                        <div className="space-y-3">
                          {rpgGlobalAttributes.map((attribute) => {
                            const attr = playerAttributes[attribute.key] ?? {
                              value: customRecommendedStats[attribute.key] ?? 50,
                              min: 0,
                              max: 100,
                              description: attribute.name
                            };
                            return (
                              <div key={attribute.key} className="grid grid-cols-[84px_1fr_64px] items-center gap-2">
                                <span className="text-xs text-blue-300">{attribute.name || attr.description}</span>
                                <input
                                  type="range"
                                  min={attr.min}
                                  max={attr.max}
                                  value={attr.value}
                                  onChange={(e) => updateAttribute(attribute.key, Number(e.target.value))}
                                  className="h-2 appearance-none rounded-full bg-gray-800 accent-blue-400"
                                />
                                <input
                                  type="number"
                                  value={attr.value}
                                  min={attr.min}
                                  max={attr.max}
                                  onChange={(e) => updateAttribute(attribute.key, Number(e.target.value))}
                                  className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-right text-xs text-blue-300"
                                />
                              </div>
                            );
                          })}
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">背包</p>
                            <button
                              onClick={addInventoryItem}
                              className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300"
                            >
                              + 新道具
                            </button>
                          </div>
                          <div className="mt-2 space-y-2 text-xs">
                            {playerInventory.length === 0 ? (
                              <p className="text-gray-500">暂无道具</p>
                            ) : (
                              playerInventory.map((item, idx) => (
                                <div key={item.item_id} className="grid grid-cols-[1fr_76px_62px] gap-2">
                                  <input
                                    value={item.name}
                                    onChange={(e) => updateInventory(idx, "name", e.target.value)}
                                    className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-gray-300"
                                  />
                                  <input
                                    value={item.category}
                                    onChange={(e) => updateInventory(idx, "category", e.target.value)}
                                    className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-gray-300"
                                  />
                                  <input
                                    type="number"
                                    value={item.quantity}
                                    onChange={(e) => updateInventory(idx, "quantity", Number(e.target.value) || 0)}
                                    className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-gray-300"
                                  />
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <aside className="rounded border border-gray-800 bg-gray-950 p-3">
                      <p className="text-[11px] text-gray-500">当前角色立绘预览（竖版）</p>
                      <div className="mt-2 h-[560px] overflow-hidden rounded border border-gray-800 bg-gray-900">
                        {selectedPortraitPreview?.status === "ready" && selectedPortraitPreview.imageUrl ? (
                          <img src={selectedPortraitPreview.imageUrl} alt="character portrait preview" className="h-full w-full object-cover" />
                        ) : selectedPortraitReferenceImage ? (
                          <img src={selectedPortraitReferenceImage} alt="character reference" className="h-full w-full object-cover opacity-75" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-gray-500">
                            先上传角色参考图，或直接生成角色立绘。
                          </div>
                        )}
                      </div>
                      {selectedPortraitPreview?.error ? (
                        <p className="mt-2 text-[11px] text-red-400">{selectedPortraitPreview.error}</p>
                      ) : null}
                    </aside>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[11px] text-gray-500">
                      {customizationSaved ? (
                        <span className="text-green-400">定制已保存，可直接生成游戏卡。</span>
                      ) : (
                        <span className="text-yellow-500">建议先应用当前修改，再生成游戏卡。</span>
                      )}
                      {gameCardGenerating ? (
                        <p className="mt-1 text-indigo-300">{GAME_CARD_LOADING_TIPS[gameCardLoadingTipIndex]}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onApplyCreativeCustomization}
                        className="rounded border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300"
                      >
                        应用当前修改
                      </button>
                      <button
                        onClick={() => void onGenerateGameCard({ allowAutoApply: true })}
                        disabled={gameCardGenerating || !reduceResult?.global_state_tree}
                        className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300 disabled:opacity-50"
                      >
                        {gameCardGenerating ? "正在生成..." : "生成游戏卡并进入步骤4"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {rightTab === "card" ? (
              <div className="border border-gray-800 bg-gray-900 p-4">
                <div className="border-b border-gray-800 pb-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">04_TERMINAL</p>
                  <h2 className="text-sm text-gray-200">生成、编辑、下载与锚点推演 `.md` 游戏卡</h2>
                </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void onGenerateGameCard()}
                      disabled={gameCardGenerating || !reduceResult?.global_state_tree}
                      className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300 disabled:opacity-50"
                    >
                      {gameCardGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                      生成游戏卡
                    </button>
                    <button
                      onClick={() => void onGenerateGameCard()}
                      disabled={gameCardGenerating || !reduceResult?.global_state_tree}
                      className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300 disabled:opacity-50"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      重新生成
                    </button>
                    <button
                      onClick={onDownloadGameCard}
                      disabled={!gameCardMarkdown.trim()}
                      className="inline-flex items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载 .md
                    </button>
                    <div className="inline-flex rounded border border-gray-800 bg-gray-950 p-0.5">
                      <button
                        onClick={() => setCardStartMode("BEGINNING")}
                        className={`rounded px-2 py-1 text-[11px] ${
                          cardStartMode === "BEGINNING" ? "bg-green-500/20 text-green-300" : "text-gray-500"
                        }`}
                      >
                        从故事开头
                      </button>
                      <button
                        onClick={() => setCardStartMode("ANCHOR")}
                        className={`rounded px-2 py-1 text-[11px] ${
                          cardStartMode === "ANCHOR" ? "bg-indigo-500/20 text-indigo-300" : "text-gray-500"
                        }`}
                      >
                        从锚点场景
                      </button>
                    </div>
                    <button
                      onClick={onStartSimulationFromCard}
                      disabled={!gameCardMarkdown.trim()}
                      className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-300 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      开始推演
                    </button>
                    <button
                      onClick={onToggleMita}
                      disabled={!gameCardMarkdown.trim() && !gameCardReferenceMarkdown.trim()}
                      className={`inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-50 ${
                        mitaEnabled
                          ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                          : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {mitaEnabled ? "关闭秘塔AI" : "秘塔AI"}
                    </button>
                    <input
                      ref={cardMaterialInputRef}
                      type="file"
                      multiple
                      accept="audio/*,video/*,image/*,.mp3,.wav,.ogg,.flac,.m4a,.mp4,.mov,.webm,.mkv,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                      onChange={onUploadMaterials}
                      className="hidden"
                    />
                    <button
                      onClick={() => cardMaterialInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 hover:border-indigo-400/40"
                    >
                      <FileUp className="h-3.5 w-3.5" />
                      上传素材
                    </button>
                  </div>
                  {gameCardGenerating ? (
                    <div className="mt-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
                      {GAME_CARD_LOADING_TIPS[gameCardLoadingTipIndex]}
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[1.2fr_1fr] gap-3">
                      <label className="block text-xs text-gray-500">
                        Markdown 编辑区
                        <textarea
                          value={gameCardMarkdown}
                          onChange={(e) => setGameCardMarkdown(e.target.value)}
                          className="mt-1 h-[520px] w-full resize-none rounded border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-[11px] text-gray-300"
                          placeholder="点击“生成游戏卡”后，会在此填入可编辑的 .md 内容。"
                        />
                      </label>

                      <div className="space-y-3">
                        <div className="rounded border border-gray-800 bg-gray-950 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">素材库</p>
                            <p className="text-[11px] text-gray-500">{materialLibrary.length} 个素材</p>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(["ALL", "BGM", "SFX", "VOICE", "IMAGE", "VIDEO", "CG"] as const).map((kind) => (
                              <button
                                key={`material-filter-${kind}`}
                                onClick={() => setMaterialFilter(kind)}
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  materialFilter === kind
                                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                                    : "border-gray-800 bg-gray-900 text-gray-400"
                                }`}
                              >
                                {kind}
                              </button>
                            ))}
                          </div>

                          <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                            {filteredMaterials.length === 0 ? (
                              <p className="rounded border border-dashed border-gray-800 bg-gray-900/60 px-2 py-2 text-xs text-gray-500">
                                当前筛选下暂无素材。点击“上传素材”可添加 BGM/SFX/VOICE/图片/视频。
                              </p>
                            ) : (
                              filteredMaterials.map((item) => (
                                <div key={item.id} className="rounded border border-gray-800 bg-gray-900 px-2 py-2 text-[11px]">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-gray-200" title={item.name}>
                                      {item.kind === "BGM" || item.kind === "SFX" ? (
                                        <Music2 className="mr-1 inline h-3.5 w-3.5 text-indigo-300" />
                                      ) : item.kind === "VOICE" ? (
                                        <Mic className="mr-1 inline h-3.5 w-3.5 text-green-300" />
                                      ) : item.kind === "VIDEO" ? (
                                        <Video className="mr-1 inline h-3.5 w-3.5 text-blue-300" />
                                      ) : (
                                        <BookOpen className="mr-1 inline h-3.5 w-3.5 text-gray-400" />
                                      )}
                                      {item.name}
                                    </p>
                                    <div className="flex items-center gap-1">
                                      {(item.kind === "BGM" || item.kind === "SFX" || item.kind === "VOICE") && (
                                        <button
                                          onClick={() => void onPreviewMaterialAudio(item)}
                                          className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300"
                                        >
                                          <Play className="h-3 w-3" />
                                          {audioNowPlaying?.materialId === item.id ? "停止" : "试听"}
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onRemoveMaterial(item.id)}
                                        className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                        移除
                                      </button>
                                    </div>
                                  </div>
                                  <p className="mt-1 text-gray-500">
                                    {item.kind} · {formatBytes(item.size)}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded border border-gray-800 bg-gray-950 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500">主线剧情锚点（读取编辑区 Markdown）</p>
                          <p className="text-[11px] text-gray-500">{parsedCardActs.length} 幕</p>
                        </div>
                        {parsedCardActs.length === 0 ? (
                          <p className="mt-2 text-xs text-gray-500">未识别到 Act 结构。请按“Act + 关键事件/场景锁定”格式补充。</p>
                        ) : (
                          <div className="mt-2 rounded border border-gray-800 bg-gray-950 h-[340px] overflow-hidden">
                            <div className="grid h-full grid-cols-[180px_220px_1fr] gap-2 p-2">
                              <div className="min-h-0 rounded border border-gray-800 bg-gray-900 p-2 flex flex-col">
                                <p className="text-[11px] text-indigo-300">Act 列表</p>
                                <div className="mt-2 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                                  <div className="space-y-1">
                                    {parsedCardActs.map((act) => (
                                      <button
                                        key={`act-col-${act.id}`}
                                        onClick={() => {
                                          const firstEvent = act.events[0] ?? null;
                                          setSelectedCardActId(act.id);
                                          setSelectedCardEventId(firstEvent?.id ?? "");
                                          setSelectedCardScene(firstEvent?.keyScenes[0] ?? act.keyScenes[0] ?? "");
                                        }}
                                        className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                                          selectedCardAct?.id === act.id
                                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                                            : "border-gray-800 bg-gray-950 text-gray-400"
                                        }`}
                                      >
                                        {shorten(act.title, 24)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="min-h-0 rounded border border-gray-800 bg-gray-900 p-2 flex flex-col">
                                <p className="text-[11px] text-green-300">关键事件</p>
                                <div className="mt-2 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                                  <div className="space-y-1">
                                    {(selectedCardAct?.events ?? []).map((event) => (
                                      <button
                                        key={`event-col-${event.id}`}
                                        onClick={() => {
                                          setSelectedCardEventId(event.id);
                                          setSelectedCardScene(event.keyScenes[0] ?? selectedCardAct?.keyScenes[0] ?? "");
                                        }}
                                        className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                                          selectedCardEvent?.id === event.id
                                            ? "border-green-500/50 bg-green-500/10 text-green-200"
                                            : "border-gray-800 bg-gray-950 text-gray-400"
                                        }`}
                                      >
                                        {shorten(event.title, 30)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="min-h-0 rounded border border-gray-800 bg-gray-900 p-2 flex flex-col">
                                <p className="text-[11px] text-blue-300">关键场景</p>
                                <div className="mt-2 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                                  <div className="space-y-1">
                                    {selectedCardEventScenes.map((scene, idx) => (
                                      <button
                                        key={`${selectedCardEvent?.id ?? "scene"}-${idx + 1}`}
                                        onClick={() => setSelectedCardScene(scene)}
                                        className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                                          selectedCardScene === scene
                                            ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                                            : "border-gray-800 bg-gray-950 text-gray-400"
                                        }`}
                                      >
                                        场景 {idx + 1} · {shorten(scene, 60)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="mt-2 rounded border border-gray-800 bg-gray-950 px-2 py-2 text-[11px] text-gray-400 min-h-[52px]">
                                  {selectedCardScene ? `当前场景：${shorten(selectedCardScene, 96)}` : "请选择一个场景作为推演起点。"}
                                </div>
                                <button
                                  onClick={() => {
                                    if (!selectedCardAct) {
                                      return;
                                    }
                                    onApplyCardActAsAnchor(selectedCardAct, selectedCardScene, selectedCardEvent, {
                                      fromBeginning: cardStartMode === "BEGINNING"
                                    });
                                  }}
                                  className="mt-2 rounded border border-green-500/30 bg-green-500/10 px-2 py-2 text-xs text-green-300"
                                >
                                  设为推演起点
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] text-gray-500">
                    当前策略：保留原有左侧渲染逻辑作为唯一运行时引擎。游戏卡作为“策划层文档”，用于开局前锁定设定与审阅，不替换状态机核心渲染链路。
                  </p>
                </div>
            ) : null}

            {false ? (
              <div className="space-y-4">
                <div className="rounded-md border border-gray-800 bg-gray-900 p-4">
                  <p className="text-xs text-gray-500">专家功能：Prompt 约束与禁忌词库</p>
                  <label className="mt-2 block text-xs text-gray-500">
                    负向禁忌词（逗号分隔）
                    <input
                      value={negativeWordsText}
                      onChange={(e) => setNegativeWordsText(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-300"
                    />
                  </label>
                  <label className="mt-3 block text-xs text-gray-500">
                    系统 Prompt 草稿
                    <textarea
                      value={systemPromptDraft}
                      onChange={(e) => setSystemPromptDraft(e.target.value)}
                      className="mt-1 h-28 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 font-mono text-xs text-purple-300"
                    />
                  </label>
                </div>

                <div className="rounded-md border border-gray-800 bg-gray-900 p-4">
                  <p className="text-xs text-gray-500">专家功能：Raw JSON Schema 编辑（additionalProperties 可扩展）</p>
                  <textarea
                    value={jsonDraft}
                    onChange={(e) => setJsonDraft(e.target.value)}
                    className="mt-2 h-72 w-full resize-none rounded border border-gray-800 bg-gray-950 px-3 py-3 font-mono text-xs text-green-300"
                  />
                  {jsonError ? <p className="mt-2 text-xs text-red-400">{jsonError}</p> : null}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={onApplyJsonDraft}
                      className="rounded border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-300"
                    >
                      应用 JSON
                    </button>
                    <button
                      onClick={() => {
                        setJsonDraft(JSON.stringify(gameState, null, 2));
                        setJsonError(null);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-gray-800 bg-gray-950 px-3 py-1.5 text-xs text-gray-300"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />重置草稿
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-gray-800 bg-gray-900 p-4">
                  <p className="text-xs text-gray-500">后端返回体实时查看</p>
                  <div className="mt-2 space-y-2">
                    <textarea
                      readOnly
                      value={JSON.stringify(selectedGraph ?? {}, null, 2)}
                      className="h-32 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 font-mono text-[11px] text-blue-300"
                    />
                    <textarea
                      readOnly
                      value={JSON.stringify(reduceResult ?? {}, null, 2)}
                      className="h-32 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 font-mono text-[11px] text-green-300"
                    />
                    <textarea
                      readOnly
                      value={JSON.stringify(lastTurnResult ?? {}, null, 2)}
                      className="h-32 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 font-mono text-[11px] text-yellow-300"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
        </div>
      </main>

      {resolutionDrawerOpen ? (
        <div className="fixed inset-0 z-40 bg-black/45" onClick={() => setResolutionDrawerOpen(false)}>
          <aside
            onClick={(event) => event.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-gray-800 bg-[#0a0a0c] p-4 shadow-2xl shadow-black/60"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Conflict Resolution Details</p>
                <p className="text-sm text-gray-200">
                  {activeResolutionStatus === "DENSITY_FILTERED"
                    ? "密度过滤详情"
                    : activeResolutionStatus === "TEMPORAL_OVERRIDE"
                      ? "时序覆写详情"
                      : activeResolutionStatus === "CRA_PATCHED"
                        ? "CRA 补丁详情"
                        : "平行分叉详情"}
                </p>
              </div>
              <button
                onClick={() => setResolutionDrawerOpen(false)}
                className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-400"
              >
                关闭
              </button>
            </div>

            <div className="mb-3 rounded border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-500">
              <p>当前模块日志：{activeResolutionItems.length} 条</p>
              <p className="mt-1 text-[11px] text-gray-400">{RESOLUTION_MODULE_HELP[activeResolutionStatus].desc}</p>
            </div>

            <div className="h-[calc(100vh-130px)] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
              {activeResolutionItems.length === 0 ? (
                <div className="rounded border border-dashed border-gray-800 bg-gray-950 px-3 py-4 text-xs text-gray-500">
                  当前模块暂无可展示日志。
                </div>
              ) : (
                activeResolutionItems.map((item) => {
                  const overriddenValue = resolutionOverrides[item.id];
                  const effectiveSelectedValue = overriddenValue ?? item.selectedValue;
                  const selectedCandidate =
                    item.candidates.find((candidate) => candidate.value === effectiveSelectedValue) ??
                    item.candidates[item.candidates.length - 1] ??
                    null;
                  const oldCandidate =
                    [...item.candidates].reverse().find((candidate) => candidate.value !== selectedCandidate?.value) ??
                    item.candidates[0] ??
                    null;

                  const branchOptions = unique(
                    [item.selectedValue ?? "", ...item.discardedValues, ...item.candidates.map((candidate) => candidate.value)].filter(Boolean)
                  ).slice(0, 4);

                  return (
                    <div key={item.id} className="rounded border border-gray-800 bg-gray-950 px-3 py-3 text-xs">
                      <p className="text-gray-300">
                        <span className="text-gray-500">冲突键：</span>
                        {item.entityId}.{item.attributeKey}
                      </p>
                      {item.reason ? <p className="mt-1 text-gray-500">{item.reason}</p> : null}
                      {overriddenValue ? (
                        <p className="mt-1 rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-500">
                          已人工覆盖：当前生效值为 {overriddenValue}
                        </p>
                      ) : null}

                      {item.status === "TEMPORAL_OVERRIDE" ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded border border-red-500/30 bg-red-500/10 p-2">
                            <p className="text-[11px] text-red-400">旧设定（已覆写）</p>
                            <p className="mt-1 line-through text-red-300">{oldCandidate?.value ?? "无"}</p>
                            <p className="mt-1 text-[10px] text-red-300/80">source: {oldCandidate?.chunkId ?? "-"}</p>
                          </div>
                          <div className="rounded border border-green-500/30 bg-green-500/10 p-2">
                            <p className="text-[11px] text-green-400">新设定（生效）</p>
                            <p className="mt-1 text-green-300">{selectedCandidate?.value ?? effectiveSelectedValue ?? "无"}</p>
                            <p className="mt-1 text-[10px] text-green-300/80">source: {selectedCandidate?.chunkId ?? "-"}</p>
                          </div>
                        </div>
                      ) : null}

                      {item.status === "BIFURCATED" ? (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            {branchOptions.map((optionValue, idx) => {
                              const sourceChunks = unique(
                                item.candidates
                                  .filter((candidate) => candidate.value === optionValue)
                                  .map((candidate) => candidate.chunkId)
                              );
                              const selected = (worldlineSelections[item.id] ?? []).includes(optionValue);
                              return (
                                <div
                                  key={`${item.id}-branch-${idx + 1}`}
                                  className={`rounded border p-2 ${
                                    selected ? "border-indigo-500/50 bg-indigo-500/10" : "border-gray-800 bg-gray-900"
                                  }`}
                                >
                                  <p className="text-[11px] text-gray-500">世界线 {String.fromCharCode(65 + idx)}</p>
                                  <p className="mt-1 text-gray-200">{optionValue}</p>
                                  <p className="mt-1 text-[10px] text-gray-500">source: {sourceChunks.join(", ") || "-"}</p>
                                  <button
                                    onClick={() => toggleWorldline(item, optionValue)}
                                    className="mt-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-300"
                                  >
                                    {selected ? "取消合并" : "合并该世界线"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          {(worldlineSelections[item.id] ?? []).length > 0 ? (
                            <p className="text-[11px] text-green-400">
                              当前合并基调：{(worldlineSelections[item.id] ?? []).join(" + ")}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {item.status !== "TEMPORAL_OVERRIDE" && item.status !== "BIFURCATED" ? (
                        <div className="mt-2 space-y-1">
                          {effectiveSelectedValue ? (
                            <p className="text-gray-300">
                              <span className="text-gray-500">保留：</span>
                              {effectiveSelectedValue}
                            </p>
                          ) : null}
                          {item.discardedValues.length > 0 ? (
                            <p className="text-gray-400">
                              <span className="text-gray-500">淘汰：</span>
                              {item.discardedValues.join(" ｜ ")}
                            </p>
                          ) : null}
                          {item.patchNarrative ? (
                            <p className="rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-purple-300">
                              CRA: {item.patchNarrative}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] text-gray-500">人工修正（可撤销）</p>
                        <div className="flex flex-wrap gap-1.5">
                          {unique(item.candidates.map((candidate) => candidate.value)).map((candidateValue) => (
                            <button
                              key={`${item.id}-override-${candidateValue}`}
                              onClick={() => applyResolutionOverride(item, candidateValue)}
                              className={`rounded border px-2 py-1 text-[11px] ${
                                effectiveSelectedValue === candidateValue
                                  ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                                  : "border-gray-800 bg-gray-900 text-gray-300"
                              }`}
                            >
                              设为：{shorten(candidateValue, 22)}
                            </button>
                          ))}
                        </div>
                        {item.selectedValue || overriddenValue ? (
                          <button
                            onClick={() => clearResolutionOverride(item)}
                            className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-500"
                          >
                            撤销人工干预（恢复系统仲裁）
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {chunkBrowserOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="h-[82vh] w-full max-w-6xl overflow-hidden rounded-lg border border-gray-800 bg-[#0a0a0c]">
            <div className="flex h-full">
              <aside className="w-72 shrink-0 border-r border-gray-800 bg-gray-900/40 p-3 h-full min-h-0 flex flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">切片剧情类目</p>
                    <p className="text-sm text-gray-200">{chunkClusters.length} 个类目</p>
                  </div>
                  <button
                    onClick={() => setChunkBrowserOpen(false)}
                    className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-400"
                  >
                    关闭
                  </button>
                </div>

                <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                  {chunkClusters.map((cluster) => (
                    <button
                      key={cluster.id}
                      onClick={() => setSelectedClusterId(cluster.id)}
                      className={`w-full rounded border px-3 py-2 text-left text-xs ${
                        selectedCluster?.id === cluster.id
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                          : "border-gray-800 bg-gray-950 text-gray-400"
                      }`}
                    >
                      <p className="text-sm">{cluster.label}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {cluster.chunkIndexes.length} 个切片 · {cluster.resolved ? "已 AI 归类" : "待 AI 归类"}
                      </p>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="flex-1 overflow-hidden p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-500">当前类目</p>
                    <p className="text-sm text-gray-200">{selectedCluster?.label ?? "未选择"}</p>
                    <p className="mt-1 text-xs text-gray-500">{selectedCluster?.summary ?? "请先上传小说并切片。"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onMapBatch}
                      disabled={
                        loading.mapBatch ||
                        !workflowGateState.step1Ready ||
                        allChunks.length === 0 ||
                        fullParseJob?.status === "RUNNING" ||
                        fullParseJob?.status === "PAUSED"
                      }
                      className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300 disabled:opacity-50"
                    >
                      {loading.mapBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                      一键全局解析
                    </button>
                    {fullParseJob?.status === "RUNNING" ? (
                      <button
                        onClick={onPauseMapBatch}
                        className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-500"
                      >
                        暂停
                      </button>
                    ) : null}
                    {fullParseJob?.status === "PAUSED" ? (
                      <button
                        onClick={onResumeMapBatch}
                        className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-400"
                      >
                        恢复
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="h-[calc(82vh-112px)] overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-gray-900">
                  <div className="space-y-2">
                    {(selectedCluster?.chunkIndexes ?? []).map((chunkIdx) => {
                      const preview = allChunks[chunkIdx] ?? "";
                      const isActive = chunkIdx === selectedChunkIndex;
                      const chunkGraph = localGraphs.find((graph) => graph.chapter_index - 1 === chunkIdx);
                      const hasGlobalTree = !!reduceResult?.global_state_tree;
                      return (
                        <div
                          key={`cluster-chunk-${chunkIdx}`}
                          className={`rounded border px-3 py-2 ${
                            isActive ? "border-blue-500/40 bg-blue-500/10" : "border-gray-800 bg-gray-950"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm text-gray-200">切片 {chunkIdx + 1}</p>
                              <p className="text-[11px] text-gray-500">
                                {localGraphs.some((graph) => graph.chapter_index - 1 === chunkIdx) ? "已解析" : "未解析"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (!hasGlobalTree) {
                                    setApiError("请先点击“一键全局解析”，生成全局状态树后再设为起点。");
                                    return;
                                  }

                                  const summaryFromMeta =
                                    typeof chunkGraph?.metadata?.brief_summary === "string" ? chunkGraph.metadata.brief_summary : "";
                                  const summary = summaryFromMeta.trim() || shorten(preview, 180);
                                  const facts = (chunkGraph?.assertions ?? [])
                                    .filter((item) => item.category === "FACT")
                                    .slice(0, 3)
                                    .map((item) => `${item.attribute_key}: ${item.value}`);
                                  const anchorNarrative = [
                                    `【起始节点：切片 ${chunkIdx + 1}】`,
                                    summary,
                                    facts.length > 0 ? `关键事实：${facts.join("；")}` : ""
                                  ]
                                    .filter(Boolean)
                                    .join("\n");

                                  setSelectedChunkIndex(chunkIdx);
                                  setTimelineAnchor(chunkIdx + 1);
                                  setApiError(null);
                                  setHistoryStack([]);
                                  setNarrativeArchive([]);
                                  setLastTurnResult(null);
                                  setTurnActionId("wait");
                                  setCustomActionText("");
                                  setWaitingCardStart(false);
                                  setCardRuntimeEnabled(false);
                                  setCardRuntimeCursor(null);
                                  setLeftPanelMode("play");
                                  setGameState((prev) => ({
                                    ...prev,
                                    current_phase: "MAIN_LOOP",
                                    world_state: {
                                      ...prev.world_state,
                                      current_turn: chunkIdx,
                                      timeline_anchor: chunkIdx + 1,
                                      current_phase: "MAIN_LOOP",
                                      global_state_tree: reduceResult?.global_state_tree ?? prev.world_state.global_state_tree
                                    },
                                    event_engine: {
                                      ...prev.event_engine,
                                      narrative_log: anchorNarrative,
                                      observation_data: "",
                                      available_actions: [
                                        {
                                          action_id: "wait",
                                          prompt_text: "继续观察",
                                          required_stats: {}
                                        }
                                      ],
                                      narrative_feed: [
                                        {
                                          id: `system-anchor-${Date.now()}-${chunkIdx}`,
                                          turn: chunkIdx,
                                          role: "system",
                                          content: `已将切片 ${chunkIdx + 1} 设为起始节点。`
                                        },
                                        {
                                          id: `ai-anchor-${Date.now()}-${chunkIdx}`,
                                          turn: chunkIdx,
                                          role: "ai",
                                          content: anchorNarrative
                                        }
                                      ]
                                    }
                                  }));
                                }}
                                disabled={!hasGlobalTree}
                                className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                设为起点
                              </button>
                              <button
                                onClick={() => onMapByIndex(chunkIdx)}
                                disabled={loading.mapCurrent}
                                className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-300 disabled:opacity-50"
                              >
                                {loading.mapCurrent ? "提取中..." : "解析该切片"}
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-xs text-gray-400">{shorten(preview, 420)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {wizardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-gray-800 bg-[#0a0a0c] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">残稿设定补全向导</p>
                <h3 className="text-sm text-gray-200">检测到设定盲区，请补全关键问题</h3>
              </div>
              <button
                onClick={() => setWizardOpen(false)}
                className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-400"
              >
                关闭
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block text-gray-500">
                1. 世界铁律
                <textarea
                  value={wizardAnswers.world_rule}
                  onChange={(e) => setWizardAnswers((prev) => ({ ...prev, world_rule: e.target.value }))}
                  className="mt-1 h-20 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-300"
                />
              </label>
              <label className="block text-gray-500">
                2. 能力代价
                <textarea
                  value={wizardAnswers.power_cost}
                  onChange={(e) => setWizardAnswers((prev) => ({ ...prev, power_cost: e.target.value }))}
                  className="mt-1 h-20 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-300"
                />
              </label>
              <label className="block text-gray-500">
                3. 势力冲突
                <textarea
                  value={wizardAnswers.faction_tension}
                  onChange={(e) => setWizardAnswers((prev) => ({ ...prev, faction_tension: e.target.value }))}
                  className="mt-1 h-20 w-full resize-none rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-300"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={onWizardAutoFill}
                disabled={loading.wizardAi}
                className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-300"
              >
                {loading.wizardAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI 随机补全
              </button>
              <button
                onClick={onApplyWizard}
                className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />应用设定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="h-8 shrink-0 border-t border-gray-800 bg-[#0a0a0c] px-4 text-[11px] text-gray-500 flex items-center justify-between">
        <span className="inline-flex items-center gap-1">
          <Settings2 className="h-3 w-3" />Play-and-Debug 双向绑定已启用
        </span>
        <span>
          Rule-Probing: social {ruleCount.social} / ability {ruleCount.ability} / causal {ruleCount.causal}
        </span>
      </footer>
    </div>
  );
}
