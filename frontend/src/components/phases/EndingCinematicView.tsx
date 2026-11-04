import React from "react";
import type { MediaAsset } from "../../types";

interface Props {
  endingAsset: MediaAsset | null;
}

export function EndingCinematicView({ endingAsset }: Props) {
  if (!endingAsset) {
    return (
      <section>
        <h2>Ending</h2>
        <p>No ending cinematic configured for this branch.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Ending Cinematic</h2>
      <video controls autoPlay src={endingAsset.url} style={{ width: "100%", maxHeight: 420 }} />
    </section>
  );
}

