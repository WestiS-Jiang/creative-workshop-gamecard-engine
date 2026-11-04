import type { GamePhase } from "../contracts/game-state";

const TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  INIT: ["INTRO_CINEMATIC", "MAIN_LOOP"],
  INTRO_CINEMATIC: ["MAIN_LOOP"],
  MAIN_LOOP: ["ENDING_CINEMATIC"],
  ENDING_CINEMATIC: []
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextDefaultPhase(current: GamePhase): GamePhase {
  const next = TRANSITIONS[current][0];
  return next ?? current;
}
