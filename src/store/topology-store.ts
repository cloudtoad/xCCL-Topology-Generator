import { create } from 'zustand'
import type { TopoSystem, TopoGraph, HardwareConfig, SUConfig } from '../engine/types'

interface TopologyState {
  // Hardware configuration
  hardwareConfig: HardwareConfig | null
  suConfig: SUConfig

  // Computed topology
  system: TopoSystem | null
  ringGraph: TopoGraph | null
  treeGraph: TopoGraph | null

  // State
  isGenerating: boolean
  generationError: string | null

  // Actions
  setHardwareConfig: (config: HardwareConfig) => void
  setSUConfig: (config: Partial<SUConfig>) => void
  setSystem: (system: TopoSystem | null) => void
  setRingGraph: (graph: TopoGraph | null) => void
  setTreeGraph: (graph: TopoGraph | null) => void
  setGenerating: (generating: boolean) => void
  setGenerationError: (error: string | null) => void
  reset: () => void
}

const defaultSUConfig: SUConfig = {
  serverCount: 1,
  railCount: 8,
  networkType: 'rail-optimized',
}

export const useTopologyStore = create<TopologyState>((set) => ({
  hardwareConfig: null,
  suConfig: defaultSUConfig,
  system: null,
  ringGraph: null,
  treeGraph: null,
  isGenerating: false,
  generationError: null,

  setHardwareConfig: (config) => set({ hardwareConfig: config }),
  setSUConfig: (config) => set((s) => ({ suConfig: { ...s.suConfig, ...config } })),
  setSystem: (system) => set({ system }),
  setRingGraph: (graph) => set({ ringGraph: graph }),
  setTreeGraph: (graph) => set({ treeGraph: graph }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  setGenerationError: (error) => set({ generationError: error }),
  reset: () =>
    set({
      system: null,
      ringGraph: null,
      treeGraph: null,
      isGenerating: false,
      generationError: null,
    }),
}))
