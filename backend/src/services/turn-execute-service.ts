import { MainLoopTurnGenerator } from "../engine/main-loop/turn-generator";
import type { GameState } from "../contracts/game-state";
import { deepMerge } from "../utils/deep-merge";
import { createDefaultGameState } from "../utils/state-factory";
import { getGameState, upsertGameState } from "../store/game-store";
import { validateGameState } from "../validation/game-state-validator";

export interface TurnExecuteRequest {
  game_instance_id: string;
  player_entity: GameState["player_entity"];
  world_state: Pick<GameState["world_state"], "current_turn"> & Partial<GameState["world_state"]> & {
    current_phase?: GameState["current_phase"];
  };
  action_id: string;
  genre?: string;
}

export interface TurnExecuteResult {
  game_state: GameState;
  integrity_report: {
    has_mismatch: boolean;
    diffs: string[];
    dev_override_accepted: true;
  };
}

export class TurnExecuteService {
  constructor(private readonly turnGenerator = new MainLoopTurnGenerator()) {}

  async execute(request: TurnExecuteRequest): Promise<TurnExecuteResult> {
    const existing = getGameState(request.game_instance_id);
    const base = existing?.state ?? createDefaultGameState({
      game_instance_id: request.game_instance_id,
      genre: request.genre
    });

    const incomingPhase = request.world_state.current_phase ?? base.current_phase;
    const incomingSnapshotPatch: Partial<GameState> = {
      player_entity: request.player_entity,
      world_state: {
        ...request.world_state,
        current_turn: request.world_state.current_turn
      } as GameState["world_state"],
      current_phase: incomingPhase
    };

    const diffs = detectDiff(base, incomingSnapshotPatch);
    const authoritativeSnapshot = deepMerge(base, incomingSnapshotPatch);

    const llmPayload = await this.turnGenerator.generate({
      stateSnapshot: authoritativeSnapshot,
      actionId: request.action_id
    });

    const llmTurnPatch = normalizeLlmTurnPayload(llmPayload, request.action_id);
    const llmPatched = deepMerge(authoritativeSnapshot, llmTurnPatch);
    const withAppliedStateChanges = applyStateChangesFromPatch(llmPatched);
    const ensured = ensureTurnAndEventPayload(withAppliedStateChanges, request.action_id, request.world_state.current_turn);

    const validation = validateGameState(ensured);
    if (!validation.valid) {
      throw new Error(`Turn output violates game-state schema: ${validation.errors.join("; ")}`);
    }

    upsertGameState(ensured);

    return {
      game_state: ensured,
      integrity_report: {
        has_mismatch: diffs.length > 0,
        diffs,
        dev_override_accepted: true
      }
    };
  }
}

function detectDiff(base: GameState, patch: Partial<GameState>): string[] {
  const diffs: string[] = [];
  if (patch.world_state?.current_turn !== undefined && patch.world_state.current_turn !== base.world_state.current_turn) {
    diffs.push(
      `world_state.current_turn mismatch: persisted=${base.world_state.current_turn}, incoming=${patch.world_state.current_turn}`
    );
  }
  if (patch.current_phase && patch.current_phase !== base.current_phase) {
    diffs.push(`current_phase mismatch: persisted=${base.current_phase}, incoming=${patch.current_phase}`);
  }
  return diffs;
}

function ensureTurnAndEventPayload(state: GameState, actionId: string, previousTurn: number): GameState {
  const nextTurn = Math.max(state.world_state.current_turn ?? previousTurn, previousTurn + 1);
  const currentActions = normalizeAvailableActions(state.event_engine?.available_actions);
  const observationData =
    toNonEmptyString(state.event_engine?.observation_data) ??
    `turn=${nextTurn}; action=${actionId}; source=llm_or_fallback`;

  return {
    ...state,
    player_entity: normalizePlayerEntity(state.player_entity),
    world_state: {
      ...state.world_state,
      current_turn: nextTurn
    },
    event_engine: {
      ...state.event_engine,
      narrative_log:
        toNonEmptyString(state.event_engine?.narrative_log) ||
        `Action ${actionId} executed. Narrative log missing from model output, fallback applied.`,
      observation_data: observationData,
      available_actions:
        currentActions.length > 0
          ? currentActions
          : [
              {
                action_id: "fallback_wait",
                prompt_text: "继续观察局势",
                required_stats: {}
              }
            ]
    }
  };
}

function normalizeLlmTurnPayload(llmPayload: Record<string, unknown>, actionId: string): Partial<GameState> {
  const plotText = toNonEmptyString(llmPayload.plot_text);
  const nextOptions = normalizeOptionTexts(llmPayload.next_options);
  const stateChanges = normalizeStateChanges(llmPayload.state_changes);

  if (!plotText && nextOptions.length === 0 && !isRecord(llmPayload.event_engine)) {
    return llmPayload as Partial<GameState>;
  }

  const available_actions =
    nextOptions.length > 0
      ? nextOptions.map((text, index) => ({
          action_id: `choice_${index + 1}`,
          prompt_text: text,
          required_stats: {}
        }))
      : [
          {
            action_id: "fallback_wait",
            prompt_text: "继续观察局势",
            required_stats: {}
          }
        ];

  const worldEvents = stateChanges.slice(0, 10).map((item) => `状态变化：${item}`);

  return {
    ...(llmPayload as Partial<GameState>),
    world_state: {
      ...((isRecord(llmPayload.world_state) ? llmPayload.world_state : {}) as Record<string, unknown>),
      ...(stateChanges.length > 0 ? { state_changes: stateChanges } : {}),
      ...(worldEvents.length > 0 ? { world_events: worldEvents } : {})
    } as Partial<GameState["world_state"]> as GameState["world_state"],
    event_engine: {
      ...((isRecord(llmPayload.event_engine) ? llmPayload.event_engine : {}) as Record<string, unknown>),
      ...(plotText ? { narrative_log: plotText } : {}),
      ...(stateChanges.length > 0 ? { observation_data: stateChanges.join(" | ") } : {}),
      available_actions
    } as Partial<GameState["event_engine"]> as GameState["event_engine"]
  };
}

function normalizePlayerEntity(rawPlayer: unknown): GameState["player_entity"] {
  const player = isRecord(rawPlayer) ? rawPlayer : {};

  const rawBiography = isRecord(player.biography) ? player.biography : {};
  const biography: GameState["player_entity"]["biography"] = {
    ...rawBiography,
    name: toNonEmptyString(rawBiography.name) ?? "玩家",
    age: toInteger(rawBiography.age, 18),
    gender: toNonEmptyString(rawBiography.gender) ?? "未知",
    origin_background: toNonEmptyString(rawBiography.origin_background) ?? "未设定"
  };

  return {
    ...(player as GameState["player_entity"]),
    biography,
    core_attributes: normalizeCoreAttributes(player.core_attributes),
    status_effects: normalizeStatusEffects(player.status_effects),
    inventory_system: normalizeInventorySystem(player.inventory_system),
    equipped_gear: normalizeEquippedGear(player.equipped_gear)
  };
}

function normalizeCoreAttributes(raw: unknown): GameState["player_entity"]["core_attributes"] {
  if (!isRecord(raw)) {
    return {};
  }

  const normalized: GameState["player_entity"]["core_attributes"] = {};
  Object.entries(raw).forEach(([attrKey, attrValue]) => {
    if (!isRecord(attrValue)) {
      return;
    }

    const value = toNumber(attrValue.value, 0);
    const min = toNumber(attrValue.min, 0);
    const max = toNumber(attrValue.max, Math.max(value, min, 100));

    normalized[attrKey] = {
      ...attrValue,
      value,
      min,
      max: Math.max(max, min),
      description: toNonEmptyString(attrValue.description) ?? attrKey
    };
  });

  return normalized;
}

function normalizeStatusEffects(raw: unknown): GameState["player_entity"]["status_effects"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (typeof item === "string") {
        const name = item.trim();
        if (!name) {
          return null;
        }
        return {
          effect_name: name,
          duration: 1,
          impact_formula: "no_effect"
        };
      }

      if (!isRecord(item)) {
        return null;
      }

      const effectName =
        toNonEmptyString(item.effect_name) ??
        toNonEmptyString(item.name) ??
        toNonEmptyString(item.title) ??
        toNonEmptyString(item.effect) ??
        `状态效果_${index + 1}`;

      const duration = toInteger(item.duration ?? item.turns ?? item.rounds ?? item.time, 1);
      const impactFormula =
        toNonEmptyString(item.impact_formula) ??
        toNonEmptyString(item.impact) ??
        toNonEmptyString(item.formula) ??
        toNonEmptyString(item.description) ??
        "no_effect";

      return {
        ...item,
        effect_name: effectName,
        duration,
        impact_formula: impactFormula
      };
    })
    .filter((item): item is GameState["player_entity"]["status_effects"][number] => !!item);
}

function normalizeInventorySystem(raw: unknown): GameState["player_entity"]["inventory_system"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (typeof item === "string") {
        const name = item.trim();
        if (!name) {
          return null;
        }
        return {
          item_id: `auto_item_${index + 1}`,
          name,
          category: "misc",
          quantity: 1
        };
      }

      if (!isRecord(item)) {
        return null;
      }

      const name = toNonEmptyString(item.name) ?? toNonEmptyString(item.title) ?? `物品_${index + 1}`;
      const itemId =
        toNonEmptyString(item.item_id) ??
        toNonEmptyString(item.itemId) ??
        toNonEmptyString(item.id) ??
        `auto_item_${index + 1}`;

      return {
        ...item,
        item_id: itemId,
        name,
        category: toNonEmptyString(item.category) ?? "misc",
        quantity: Math.max(0, toInteger(item.quantity ?? item.count ?? item.amount, 1))
      };
    })
    .filter((item): item is GameState["player_entity"]["inventory_system"][number] => !!item);
}

function normalizeEquippedGear(raw: unknown): GameState["player_entity"]["equipped_gear"] {
  if (!isRecord(raw)) {
    return {};
  }

  const normalized: GameState["player_entity"]["equipped_gear"] = {};
  Object.entries(raw).forEach(([slot, value]) => {
    const resolved = toNonEmptyString(value) ?? (typeof value === "number" ? String(value) : null);
    if (resolved) {
      normalized[slot] = resolved;
    }
  });
  return normalized;
}

function normalizeAvailableActions(rawActions: unknown): GameState["event_engine"]["available_actions"] {
  if (!Array.isArray(rawActions)) {
    return [];
  }

  const seenActionIds = new Set<string>();

  return rawActions
    .map((raw, index) => normalizeSingleAction(raw, index))
    .filter((item): item is GameState["event_engine"]["available_actions"][number] => !!item)
    .map((item) => {
      const baseId = item.action_id;
      if (!seenActionIds.has(baseId)) {
        seenActionIds.add(baseId);
        return item;
      }

      let suffix = 2;
      let deduped = `${baseId}_${suffix}`;
      while (seenActionIds.has(deduped)) {
        suffix += 1;
        deduped = `${baseId}_${suffix}`;
      }

      seenActionIds.add(deduped);
      return {
        ...item,
        action_id: deduped
      };
    });
}

function normalizeSingleAction(
  rawAction: unknown,
  index: number
): GameState["event_engine"]["available_actions"][number] | null {
  if (typeof rawAction === "string") {
    const text = rawAction.trim();
    if (!text) {
      return null;
    }
    return {
      action_id: `auto_action_${index + 1}`,
      prompt_text: text,
      required_stats: {}
    };
  }

  if (!isRecord(rawAction)) {
    return null;
  }

  const actionId =
    toNonEmptyString(rawAction.action_id) ??
    toNonEmptyString(rawAction.actionId) ??
    toNonEmptyString(rawAction.id) ??
    `auto_action_${index + 1}`;

  const promptText =
    toNonEmptyString(rawAction.prompt_text) ??
    toNonEmptyString(rawAction.prompt) ??
    toNonEmptyString(rawAction.text) ??
    toNonEmptyString(rawAction.label) ??
    toNonEmptyString(rawAction.title) ??
    toNonEmptyString(rawAction.description) ??
    `执行选项 ${index + 1}`;

  const requiredStats = normalizeRequiredStats(
    rawAction.required_stats ?? rawAction.requiredStats ?? rawAction.requirements ?? rawAction.cost
  );

  return {
    ...rawAction,
    action_id: actionId,
    prompt_text: promptText,
    required_stats: requiredStats
  };
}

function normalizeRequiredStats(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) {
    return {};
  }

  const output: Record<string, number> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
      return;
    }
    if (typeof value === "string") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        output[key] = numeric;
      }
    }
  });

  return output;
}

function normalizeOptionTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 4);
}

function normalizeStateChanges(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 16);
}

function applyStateChangesFromPatch(state: GameState): GameState {
  const changesRaw = (state.world_state as Record<string, unknown> | undefined)?.state_changes;
  const changes = normalizeStateChanges(changesRaw);
  if (changes.length === 0) {
    return state;
  }

  const next = state as unknown as Record<string, unknown>;
  changes.forEach((expr) => {
    applyStateChangeExpression(next, expr);
  });
  return next as unknown as GameState;
}

function applyStateChangeExpression(root: Record<string, unknown>, expr: string): void {
  const pushMatch = expr.match(/^\s*([a-zA-Z0-9_.]+)\.push\((.*)\)\s*$/);
  if (pushMatch) {
    const path = pushMatch[1];
    const value = parseExpressionValue(pushMatch[2]);
    const target = getByPath(root, path);
    if (Array.isArray(target)) {
      target.push(value);
      return;
    }
    setByPath(root, path, [value]);
    return;
  }

  const assignMatch = expr.match(/^\s*([a-zA-Z0-9_.]+)\s*(=|\+=|-=)\s*(.+)\s*$/);
  if (!assignMatch) {
    return;
  }

  const path = assignMatch[1];
  const op = assignMatch[2];
  const rhs = parseExpressionValue(assignMatch[3]);
  const current = getByPath(root, path);

  if (op === "=") {
    setByPath(root, path, rhs);
    return;
  }

  const currentNum = typeof current === "number" && Number.isFinite(current) ? current : Number(current ?? 0) || 0;
  const rhsNum = typeof rhs === "number" && Number.isFinite(rhs) ? rhs : Number(rhs ?? 0) || 0;
  if (op === "+=") {
    setByPath(root, path, currentNum + rhsNum);
    return;
  }
  setByPath(root, path, currentNum - rhsNum);
}

function parseExpressionValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (text === "null") {
    return null;
  }
  const num = Number(text);
  if (Number.isFinite(num)) {
    return num;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) {
    return;
  }

  let current: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = current[key];
    if (!isRecord(existing)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return fallback;
}

function toInteger(value: unknown, fallback: number): number {
  return Math.trunc(toNumber(value, fallback));
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
