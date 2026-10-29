'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// Selected "Where I found this" evidence, shared between the conversation
// cards and the per-device overlay (docs/design/UI_CORRECTIONS.md 4).
// No data fetching here.

export interface SelectedEvidence {
  title: string;
  quote: string;
  sourceUrl: string | null;
}

const EvidenceContext = createContext<{
  selected: SelectedEvidence | null;
  select: (e: SelectedEvidence) => void;
  clear: () => void;
}>({ selected: null, select: () => {}, clear: () => {} });

export function useEvidence(): {
  selected: SelectedEvidence | null;
  select: (e: SelectedEvidence) => void;
  clear: () => void;
} {
  return useContext(EvidenceContext);
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  const clear = useCallback(() => setSelected(null), []);
  return <EvidenceContext.Provider value={{ selected, select: setSelected, clear }}>{children}</EvidenceContext.Provider>;
}
