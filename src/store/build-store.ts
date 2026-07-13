import { create } from 'zustand'
import type { RingBuildTrace } from '../engine/ring-build-trace'
import { condenseTrace, type CondensedStop } from '../engine/trace-condense'

/** Transport state for the ring-construction walkthrough (Build view). */
interface BuildState {
  trace: RingBuildTrace | null
  idx: number // events applied: 0..events.length
  playing: boolean
  msPerEvent: number
  /** condensed playback: hop between pedagogically distinct stops (default on) */
  condensed: boolean
  stops: CondensedStop[]

  setTrace: (trace: RingBuildTrace | null) => void
  playPause: () => void
  advance: () => void
  retreat: () => void
  seek: (idx: number) => void
  toggleCondensed: () => void
  reset: () => void
}

export const useBuildStore = create<BuildState>((set, get) => ({
  trace: null,
  idx: 0,
  playing: false,
  msPerEvent: 850,
  condensed: true,
  stops: [],

  setTrace: (trace) =>
    set({ trace, idx: 0, playing: false, stops: trace ? condenseTrace(trace.events) : [] }),

  playPause: () => {
    const { trace, idx, playing } = get()
    if (!trace) return
    if (!playing && idx >= trace.events.length) set({ idx: 0, playing: true })
    else set({ playing: !playing })
  },

  advance: () => {
    const { trace, idx, condensed, stops } = get()
    if (!trace) return
    const next = condensed
      ? (stops.find((s) => s.idx > idx)?.idx ?? trace.events.length)
      : Math.min(idx + 1, trace.events.length)
    set({ idx: next, playing: next < trace.events.length ? get().playing : false })
  },

  retreat: () => {
    const { trace, idx, condensed, stops } = get()
    if (!trace) return
    const prev = condensed
      ? ([...stops].reverse().find((s) => s.idx < idx)?.idx ?? 0)
      : Math.max(0, idx - 1)
    set({ idx: prev, playing: false })
  },

  seek: (idx) => {
    const { trace } = get()
    if (!trace) return
    set({ idx: Math.max(0, Math.min(idx, trace.events.length)), playing: false })
  },

  toggleCondensed: () => set({ condensed: !get().condensed }),

  reset: () => set({ idx: 0, playing: false }),
}))
