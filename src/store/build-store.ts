import { create } from 'zustand'
import type { RingBuildTrace } from '../engine/ring-build-trace'

/** Transport state for the ring-construction walkthrough (Build view). */
interface BuildState {
  trace: RingBuildTrace | null
  idx: number // events applied: 0..events.length
  playing: boolean
  msPerEvent: number

  setTrace: (trace: RingBuildTrace | null) => void
  playPause: () => void
  advance: () => void
  seek: (idx: number) => void
  reset: () => void
}

export const useBuildStore = create<BuildState>((set, get) => ({
  trace: null,
  idx: 0,
  playing: false,
  msPerEvent: 850,

  setTrace: (trace) => set({ trace, idx: 0, playing: false }),

  playPause: () => {
    const { trace, idx, playing } = get()
    if (!trace) return
    if (!playing && idx >= trace.events.length) set({ idx: 0, playing: true })
    else set({ playing: !playing })
  },

  advance: () => {
    const { trace, idx } = get()
    if (!trace) return
    const next = Math.min(idx + 1, trace.events.length)
    set({ idx: next, playing: next < trace.events.length ? get().playing : false })
  },

  seek: (idx) => {
    const { trace } = get()
    if (!trace) return
    set({ idx: Math.max(0, Math.min(idx, trace.events.length)), playing: false })
  },

  reset: () => set({ idx: 0, playing: false }),
}))
