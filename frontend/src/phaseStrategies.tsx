import React from "react";
import { EndingCinematicView } from "./components/phases/EndingCinematicView";
import { InitPhaseView } from "./components/phases/InitPhaseView";
import { IntroCinematicView } from "./components/phases/IntroCinematicView";
import { MainLoopSplitPanel } from "./components/MainLoopSplitPanel";
import type { FrontendGameState, GamePhase } from "./types";

export interface PhaseRendererContext {
  state: FrontendGameState;
  setState: React.Dispatch<React.SetStateAction<FrontendGameState>>;
  onActionSelect: (actionId: string) => void;
}

type PhaseRenderer = (ctx: PhaseRendererContext) => React.ReactElement;

export const PHASE_RENDERERS: Record<GamePhase, PhaseRenderer> = {
  INIT: ({ setState, state }) => (
    <InitPhaseView
      onStart={() => {
        setState({
          ...state,
          current_phase: state.media_assets.intro_cinematic ? "INTRO_CINEMATIC" : "MAIN_LOOP"
        });
      }}
    />
  ),
  INTRO_CINEMATIC: ({ setState, state }) => (
    <IntroCinematicView
      introAsset={state.media_assets.intro_cinematic}
      onSkip={() => setState((prev) => ({ ...prev, current_phase: "MAIN_LOOP" }))}
    />
  ),
  MAIN_LOOP: ({ state, setState, onActionSelect }) => (
    <MainLoopSplitPanel
      state={state}
      onActionSelect={onActionSelect}
      onStatePatch={(nextState) => setState(nextState)}
    />
  ),
  ENDING_CINEMATIC: ({ state }) => <EndingCinematicView endingAsset={state.media_assets.ending_cinematic} />
};

