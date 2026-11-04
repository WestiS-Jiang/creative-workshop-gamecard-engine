import React from "react";
import type { MediaAsset } from "../../types";

interface Props {
  introAsset: MediaAsset | null;
  onSkip: () => void;
}

export function IntroCinematicView({ introAsset, onSkip }: Props) {
  if (!introAsset) {
    return (
      <section>
        <p>No intro cinematic configured.</p>
        <button onClick={onSkip}>Continue</button>
      </section>
    );
  }

  return (
    <section>
      <h2>Intro Cinematic</h2>
      <video controls autoPlay src={introAsset.url} style={{ width: "100%", maxHeight: 420 }} />
      <button onClick={onSkip}>Skip</button>
    </section>
  );
}

