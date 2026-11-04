import React from "react";
import type { FrontendGameState } from "../types";
import { JsonDebugger } from "./JsonDebugger";

interface Props {
  state: FrontendGameState;
  onActionSelect: (actionId: string) => void;
  onStatePatch: (nextState: FrontendGameState) => void;
}

export function MainLoopSplitPanel({ state, onActionSelect, onStatePatch }: Props) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        alignItems: "start"
      }}
    >
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
        <h2>Play Renderer</h2>
        <p>Turn: {state.world_state.current_turn}</p>
        <article style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {state.event_engine.narrative_log || "No narrative generated yet."}
        </article>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {state.event_engine.available_actions.map((a) => (
            <button key={a.action_id} onClick={() => onActionSelect(a.action_id)}>
              {a.prompt_text}
            </button>
          ))}
        </div>
      </div>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
        <JsonDebugger state={state} onStatePatch={onStatePatch} />
      </div>
    </section>
  );
}

