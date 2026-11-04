import type { GameState } from "../contracts/game-state";

interface StoredGame {
  state: GameState;
  updated_at: string;
}

const memoryStore = new Map<string, StoredGame>();

export function getGameState(gameInstanceId: string): StoredGame | null {
  return memoryStore.get(gameInstanceId) ?? null;
}

export function upsertGameState(state: GameState): StoredGame {
  const record: StoredGame = {
    state,
    updated_at: new Date().toISOString()
  };
  memoryStore.set(state.game_instance_id, record);
  return record;
}

export function listGameInstanceIds(): string[] {
  return [...memoryStore.keys()];
}

