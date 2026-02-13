import { create } from 'zustand'
import { createDefaultEnvConfig, type EnvConfig, type EnvVarDef, type EnvCategory } from '../engine/env'

interface EnvState {
  config: EnvConfig

  // Get a single var
  getVar: (name: string) => EnvVarDef | undefined
  // Set a var value
  setVar: (name: string, value: number | string | null) => void
  // Reset a single var to default
  resetVar: (name: string) => void
  // Reset all vars to defaults
  resetAll: () => void
  // Get all vars in a category
  getByCategory: (category: EnvCategory) => EnvVarDef[]
  // Get all overridden vars
  getOverridden: () => EnvVarDef[]
  // Search vars by name or description
  search: (query: string) => EnvVarDef[]
}

export const useEnvStore = create<EnvState>((set, get) => ({
  config: createDefaultEnvConfig(),

  getVar: (name) => get().config.get(name),

  setVar: (name, value) =>
    set((state) => {
      const newConfig = new Map(state.config)
      const v = newConfig.get(name)
      if (v) {
        newConfig.set(name, { ...v, value })
      }
      return { config: newConfig }
    }),

  resetVar: (name) =>
    set((state) => {
      const newConfig = new Map(state.config)
      const v = newConfig.get(name)
      if (v) {
        newConfig.set(name, { ...v, value: null })
      }
      return { config: newConfig }
    }),

  resetAll: () => set({ config: createDefaultEnvConfig() }),

  getByCategory: (category) => {
    const vars: EnvVarDef[] = []
    for (const v of get().config.values()) {
      if (v.category === category) vars.push(v)
    }
    return vars
  },

  getOverridden: () => {
    const vars: EnvVarDef[] = []
    for (const v of get().config.values()) {
      if (v.value !== null) vars.push(v)
    }
    return vars
  },

  search: (query) => {
    const lower = query.toLowerCase()
    const vars: EnvVarDef[] = []
    for (const v of get().config.values()) {
      if (
        v.name.toLowerCase().includes(lower) ||
        v.description.toLowerCase().includes(lower)
      ) {
        vars.push(v)
      }
    }
    return vars
  },
}))
