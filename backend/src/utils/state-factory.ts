import { randomUUID } from "node:crypto";
import type { GameState } from "../contracts/game-state";
import { resolveTimeStep } from "../config/timestep-policy";

export function createDefaultGameState(input: {
  game_instance_id?: string;
  genre?: string;
  theme_style?: string;
}): GameState {
  const genre = input.genre ?? "通用题材";
  const timeStep = resolveTimeStep({ genre });

  return {
    game_instance_id: input.game_instance_id ?? randomUUID(),
    genre_metadata: {
      genre,
      theme_style: input.theme_style ?? "default"
    },
    current_phase: "INIT",
    time_step_config: timeStep,
    media_assets: {
      bgm_tracks: [],
      intro_cinematic: null,
      ending_cinematic: null,
      character_portraits: {}
    },
    world_state: {
      current_turn: 0,
      time_cycle: {
        season: "spring",
        weather: "clear",
        time_of_day: "morning"
      },
      global_factions: [],
      world_events: []
    },
    player_entity: {
      biography: {
        name: "玩家",
        age: 18,
        gender: "未知",
        origin_background: "未设定",
        appearance: ""
      },
      core_attributes: {},
      status_effects: [],
      inventory_system: [],
      equipped_gear: {}
    },
    dynamic_npc_network: [],
    event_engine: {
      narrative_log: "",
      observation_data: "",
      available_actions: []
    }
  };
}
