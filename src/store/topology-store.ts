import { create } from 'zustand'
import type { TopoSystem, TopoGraph, HardwareConfig, SUConfig } from '../engine/types'
import type { TuningResult } from '../engine/tuning'
import type { ClusterTopology } from '../engine/cluster'
import type { RingBuildTrace } from '../engine/ring-build-trace'
import type { QPPlan } from '../engine/qp'

interface TopologyState {
  // Hardware configuration
  hardwareConfig: HardwareConfig | null
  suConfig: SUConfig

  // Computed topology
  system: TopoSystem | null
  ringGraph: TopoGraph | null
  treeGraph: TopoGraph | null
  nvlsGraph: TopoGraph | null
  nvlsSupported: boolean
  nvlsReason: string
  nvlsRuntimeChannels: number
  tuning: TuningResult | null
  ringBuildTrace: RingBuildTrace | null
  buildSystem: TopoSystem | null // searched system when ≠ display system (2-node local view + NETs)
  clusterTopo: ClusterTopology | null
  qpPlan: QPPlan | null

  // State
  isGenerating: boolean
  generationError: string | null

  // Actions
  setHardwareConfig: (config: HardwareConfig) => void
  setSUConfig: (config: Partial<SUConfig>) => void
  setSystem: (system: TopoSystem | null) => void
  setRingGraph: (graph: TopoGraph | null) => void
  setTreeGraph: (graph: TopoGraph | null) => void
  setNvls: (graph: TopoGraph | null, supported: boolean, reason: string, runtimeChannels: number) => void
  setTuning: (tuning: TuningResult | null) => void
  setRingBuildTrace: (trace: RingBuildTrace | null) => void
  setBuildSystem: (buildSystem: TopoSystem | null) => void
  setCluster: (clusterTopo: ClusterTopology | null, qpPlan: QPPlan | null) => void
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
  nvlsGraph: null,
  nvlsSupported: false,
  nvlsReason: '',
  nvlsRuntimeChannels: 0,
  tuning: null,
  ringBuildTrace: null,
  buildSystem: null,
  clusterTopo: null,
  qpPlan: null,
  isGenerating: false,
  generationError: null,

  setHardwareConfig: (config) => set({ hardwareConfig: config }),
  setSUConfig: (config) => set((s) => ({ suConfig: { ...s.suConfig, ...config } })),
  setSystem: (system) => set({ system }),
  setRingGraph: (graph) => set({ ringGraph: graph }),
  setTreeGraph: (graph) => set({ treeGraph: graph }),
  setNvls: (graph, supported, reason, runtimeChannels) =>
    set({ nvlsGraph: graph, nvlsSupported: supported, nvlsReason: reason, nvlsRuntimeChannels: runtimeChannels }),
  setTuning: (tuning) => set({ tuning }),
  setRingBuildTrace: (ringBuildTrace) => set({ ringBuildTrace }),
  setBuildSystem: (buildSystem) => set({ buildSystem }),
  setCluster: (clusterTopo, qpPlan) => set({ clusterTopo, qpPlan }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  setGenerationError: (error) => set({ generationError: error }),
  reset: () =>
    set({
      system: null,
      ringGraph: null,
      treeGraph: null,
      nvlsGraph: null,
      nvlsSupported: false,
      nvlsReason: '',
      nvlsRuntimeChannels: 0,
      tuning: null,
      ringBuildTrace: null,
      buildSystem: null,
      clusterTopo: null,
      qpPlan: null,
      isGenerating: false,
      generationError: null,
    }),
}))
