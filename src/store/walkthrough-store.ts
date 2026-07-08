import { create } from 'zustand'
import { CURRICULUM } from '../walkthrough/curriculum'

interface WalkthroughState {
  moduleIdx: number
  beatIdx: number
  setBeat: (moduleIdx: number, beatIdx: number) => void
  next: () => void
  prev: () => void
}

export const useWalkthroughStore = create<WalkthroughState>((set, get) => ({
  moduleIdx: 0,
  beatIdx: 0,

  setBeat: (moduleIdx, beatIdx) => set({ moduleIdx, beatIdx }),

  next: () => {
    const { moduleIdx, beatIdx } = get()
    if (beatIdx + 1 < CURRICULUM[moduleIdx].beats.length) {
      set({ beatIdx: beatIdx + 1 })
    } else if (moduleIdx + 1 < CURRICULUM.length) {
      set({ moduleIdx: moduleIdx + 1, beatIdx: 0 })
    }
  },

  prev: () => {
    const { moduleIdx, beatIdx } = get()
    if (beatIdx > 0) {
      set({ beatIdx: beatIdx - 1 })
    } else if (moduleIdx > 0) {
      const m = moduleIdx - 1
      set({ moduleIdx: m, beatIdx: CURRICULUM[m].beats.length - 1 })
    }
  },
}))
