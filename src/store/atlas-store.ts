import { create } from 'zustand'

export type AtlasGraphKind = 'l0-dfd' | 'l2-cfg' | 'l2-dfd' | 'lineage'

interface AtlasState {
  graph: AtlasGraphKind
  /** Selected atlas/lineage node id (registry id, not mermaid-sanitized). */
  selected: string | null
  /** When set, the lineage map renders only this node's ancestry. */
  lineageFocus: string | null

  setGraph: (graph: AtlasGraphKind) => void
  select: (id: string | null) => void
  focusLineage: (id: string | null) => void
}

export const useAtlasStore = create<AtlasState>((set) => ({
  graph: 'l0-dfd',
  selected: null,
  lineageFocus: null,

  setGraph: (graph) => set({ graph, selected: null }),
  select: (selected) => set({ selected }),
  focusLineage: (lineageFocus) =>
    set({ graph: 'lineage', lineageFocus, selected: lineageFocus }),
}))
