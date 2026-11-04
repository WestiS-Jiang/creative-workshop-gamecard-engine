import { Router } from "express";
import type { GameState } from "../contracts/game-state";
import { TurnExecuteService } from "../services/turn-execute-service";

const router = Router();
const service = new TurnExecuteService();

router.post("/execute", async (req, res, next) => {
  try {
    const validation = validateTurnBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        error: validation.error
      });
      return;
    }

    const executed = await service.execute(validation.value);
    res.json({
      ok: true,
      ...executed
    });
  } catch (error) {
    next(error);
  }
});

function validateTurnBody(body: unknown):
  | {
      ok: true;
      value: {
        game_instance_id: string;
        player_entity: GameState["player_entity"];
        world_state: Pick<GameState["world_state"], "current_turn"> &
          Partial<GameState["world_state"]> & { current_phase?: GameState["current_phase"] };
        action_id: string;
        genre?: string;
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be an object." };
  }

  if (typeof body.game_instance_id !== "string" || body.game_instance_id.trim() === "") {
    return { ok: false, error: "game_instance_id is required." };
  }
  if (typeof body.action_id !== "string" || body.action_id.trim() === "") {
    return { ok: false, error: "action_id is required." };
  }
  if (!isRecord(body.player_entity)) {
    return { ok: false, error: "player_entity must be an object." };
  }
  if (!isRecord(body.world_state) || typeof body.world_state.current_turn !== "number") {
    return { ok: false, error: "world_state.current_turn must be provided." };
  }

  return {
    ok: true,
    value: {
      game_instance_id: body.game_instance_id,
      player_entity: body.player_entity as GameState["player_entity"],
      world_state: body.world_state as Pick<GameState["world_state"], "current_turn"> &
        Partial<GameState["world_state"]> & { current_phase?: GameState["current_phase"] },
      action_id: body.action_id,
      genre: typeof body.genre === "string" ? body.genre : undefined
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export default router;

