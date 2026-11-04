import React from "react";

interface Props {
  onStart: () => void;
}

export function InitPhaseView({ onStart }: Props) {
  return (
    <section>
      <h1>Creative Workshop</h1>
      <p>Upload source novel and initialize turn-0 state snapshot.</p>
      <button onClick={onStart}>Start</button>
    </section>
  );
}

