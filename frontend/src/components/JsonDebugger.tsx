import React, { useMemo, useState } from "react";

interface Props<T extends object> {
  state: T;
  onStatePatch: (nextState: T) => void;
}

export function JsonDebugger<T extends object>({ state, onStatePatch }: Props<T>) {
  const initialText = useMemo(() => JSON.stringify(state, null, 2), [state]);
  const [draft, setDraft] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setDraft(initialText);
  }, [initialText]);

  const applyPatch = () => {
    try {
      const parsed = JSON.parse(draft) as T;
      setError(null);
      onStatePatch(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <h3>JSON State Debugger (God Mode)</h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: "100%", minHeight: 460, fontFamily: "monospace" }}
      />
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      <button onClick={applyPatch}>Apply State Patch</button>
    </aside>
  );
}

