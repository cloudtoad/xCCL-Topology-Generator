import { create } from 'zustand'
import type { AllReduceTrace } from '../sim/allreduce'
import { toyAllReduce } from '../sim/allreduce'
import type { AllGatherTrace } from '../sim/allgather'

// =============================================================================
// Sim player state.
//
// `step` counts APPLIED global steps: 0 = initial seeds, totalSteps = final
// sums. While playing, the sim view animates the in-flight frames of step
// `step` over `msPerStep`, then calls advance() — buffers update on arrival.
//
// Two modes share the transport: the single-server value-level AllReduce
// (`trace`) and the cluster-scale origin AllGather (`clusterTrace`). Cluster
// mode takes precedence when set (the views keep them mutually exclusive).
// =============================================================================

interface SimState {
  trace: AllReduceTrace | null
  clusterTrace: AllGatherTrace | null
  step: number
  playing: boolean
  msPerStep: number

  loadToy: () => void
  setClusterTrace: (trace: AllGatherTrace | null) => void
  playPause: () => void
  advance: () => void
  seek: (step: number) => void
  reset: () => void
}

function totalSteps(s: { trace: AllReduceTrace | null; clusterTrace: AllGatherTrace | null }): number {
  if (s.clusterTrace) return s.clusterTrace.nSteps
  if (s.trace) return s.trace.totalSteps
  return 0
}

export const useSimStore = create<SimState>((set, get) => ({
  trace: null,
  clusterTrace: null,
  step: 0,
  playing: false,
  msPerStep: 1600,

  loadToy: () => set({ trace: toyAllReduce(), step: 0, playing: false }),

  setClusterTrace: (clusterTrace) => set({ clusterTrace, step: 0, playing: false }),

  playPause: () => {
    const s = get()
    const total = totalSteps(s)
    if (total === 0) return
    if (!s.playing && s.step >= total) {
      set({ step: 0, playing: true }) // play from the end restarts
    } else {
      set({ playing: !s.playing })
    }
  },

  advance: () => {
    const s = get()
    const total = totalSteps(s)
    if (total === 0) return
    const next = Math.min(s.step + 1, total)
    set({ step: next, playing: next < total ? s.playing : false })
  },

  seek: (step) => {
    const s = get()
    const total = totalSteps(s)
    if (total === 0) return
    set({ step: Math.max(0, Math.min(step, total)), playing: false })
  },

  reset: () => set({ step: 0, playing: false }),
}))
