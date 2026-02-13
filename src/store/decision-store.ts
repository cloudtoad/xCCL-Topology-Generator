import { create } from 'zustand'
import type { DecisionEntry } from '../engine/types'

interface DecisionState {
  entries: DecisionEntry[]
  addEntry: (entry: DecisionEntry) => void
  addEntries: (entries: DecisionEntry[]) => void
  clear: () => void
}

export const useDecisionStore = create<DecisionState>((set) => ({
  entries: [],
  addEntry: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
  addEntries: (entries) => set((s) => ({ entries: [...s.entries, ...entries] })),
  clear: () => set({ entries: [] }),
}))
