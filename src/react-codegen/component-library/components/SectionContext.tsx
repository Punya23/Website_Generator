"use client";

import { createContext, useContext, type ReactNode } from "react";

const SectionIdContext = createContext<string | undefined>(undefined);

export function SectionIdProvider({ id, children }: { id?: string; children: ReactNode }) {
  return <SectionIdContext.Provider value={id}>{children}</SectionIdContext.Provider>;
}

export function useCurrentSectionId(): string | undefined {
  return useContext(SectionIdContext);
}
