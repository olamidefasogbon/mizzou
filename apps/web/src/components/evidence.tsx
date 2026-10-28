'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

// Selected "Where I found this" evidence, shared between the conversation
// cards and the right-hand rail (1100px+). No data fetching here.

export interface SelectedEvidence {
  title: string;
  quote: string;
  sourceUrl: string | null;
}

const EvidenceContext = createContext<{
  selected: SelectedEvidence | null;
  select: (e: SelectedEvidence) => void;
}>({ selected: null, select: () => {} });

export function useEvidence(): {
  selected: SelectedEvidence | null;
  select: (e: SelectedEvidence) => void;
} {
  return useContext(EvidenceContext);
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  return <EvidenceContext.Provider value={{ selected, select: setSelected }}>{children}</EvidenceContext.Provider>;
}
