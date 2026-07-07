import { create } from 'zustand'
import type { AllReduceTrace } from '../sim/allreduce'
import { toyAllReduce } from '../sim/allreduce'

// =============================================================================
// Sim player state.
//
// `step` counts APPLIED global steps: 0 = initial seeds, totalSteps = final
// sums. While playing, SimView animates the in-flight frames of step `step`
// over `msPerStep`, then calls advance() — buffers update on arrival.
// =============================================================================

interface SimState {
  trace: AllReduceTrace | null
  step: number
  playing: boolean
  msPerStep: number

  loadToy: () => void
  playPause: () => void
  advance: () => void
  seek: (step: number) => void
  reset: () => void
}

export const useSimStore = create<SimState>((set, get) => ({
  trace: null,
  step: 0,
  playing: false,
  msPerStep: 1600,

  loadToy: () => set({ trace: toyAllReduce(), step: 0, playing: false }),

  playPause: () => {
    const { trace, step, playing } = get()
    if (!trace) return
    if (!playing && step >= trace.totalSteps) {
      // Play from the end restarts.
      set({ step: 0, playing: true })
    } else {
      set({ playing: !playing })
    }
  },

  advance: () => {
    const { trace, step } = get()
    if (!trace) return
    const next = Math.min(step + 1, trace.totalSteps)
    set({ step: next, playing: next < trace.totalSteps ? get().playing : false })
  },

  seek: (step) => {
    const { trace } = get()
    if (!trace) return
    set({ step: Math.max(0, Math.min(step, trace.totalSteps)), playing: false })
  },

  reset: () => set({ step: 0, playing: false }),
}))
