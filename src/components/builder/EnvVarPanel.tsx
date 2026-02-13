import { useState } from 'react'
import { useEnvStore } from '../../store/env-store'
import { useUIStore } from '../../store/ui-store'
import type { EnvCategory, EnvVarDef } from '../../engine/env'

const categories: { value: EnvCategory; label: string }[] = [
  { value: 'topology', label: 'Topology' },
  { value: 'channels', label: 'Channels' },
  { value: 'transport', label: 'Transport' },
  { value: 'network', label: 'Network' },
  { value: 'tuning', label: 'Tuning' },
  { value: 'debug', label: 'Debug' },
  { value: 'rccl', label: 'RCCL' },
]

export function EnvVarPanel() {
  const mode = useUIStore((s) => s.mode)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<EnvCategory>('topology')
  const config = useEnvStore((s) => s.config)
  const setVar = useEnvStore((s) => s.setVar)
  const resetVar = useEnvStore((s) => s.resetVar)
  const resetAll = useEnvStore((s) => s.resetAll)

  // Filter categories based on mode
  const visibleCategories = categories.filter(
    (c) => c.value !== 'rccl' || mode === 'rccl',
  )

  // Get vars for display
  let displayVars: EnvVarDef[] = []
  if (search) {
    const lower = search.toLowerCase()
    for (const v of config.values()) {
      if (
        v.name.toLowerCase().includes(lower) ||
        v.description.toLowerCase().includes(lower)
      ) {
        if (v.category !== 'rccl' || mode === 'rccl') {
          displayVars.push(v)
        }
      }
    }
  } else {
    for (const v of config.values()) {
      if (v.category === activeCategory) {
        displayVars.push(v)
      }
    }
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="flex gap-1">
        <input
          type="text"
          placeholder="Search env vars..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 text-[10px] py-1"
        />
        <button
          onClick={resetAll}
          className="text-[9px] text-gray-500 hover:text-neon-red px-1.5"
          title="Reset all to defaults"
        >
          Reset
        </button>
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex flex-wrap gap-0.5">
          {visibleCategories.map((c) => (
            <button
              key={c.value}
              onClick={() => setActiveCategory(c.value)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                activeCategory === c.value
                  ? 'bg-neon-cyan/10 text-neon-cyan'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Var list */}
      <div className="space-y-0.5 max-h-60 overflow-y-auto">
        {displayVars.map((v) => (
          <EnvVarRow
            key={v.name}
            varDef={v}
            onSet={(val) => setVar(v.name, val)}
            onReset={() => resetVar(v.name)}
          />
        ))}
        {displayVars.length === 0 && (
          <p className="text-[10px] text-gray-600 p-2">No matching vars</p>
        )}
      </div>
    </div>
  )
}

function EnvVarRow({
  varDef,
  onSet,
  onReset,
}: {
  varDef: EnvVarDef
  onSet: (val: number | string | null) => void
  onReset: () => void
}) {
  const isOverridden = varDef.value !== null
  const effectiveValue = varDef.value !== null ? varDef.value : varDef.default

  return (
    <div
      className={`p-1.5 rounded text-[10px] border transition-colors ${
        isOverridden
          ? 'border-neon-cyan/20 bg-neon-cyan/5'
          : 'border-transparent hover:bg-surface-700/30'
      }`}
      title={`${varDef.description}\nSource: ${varDef.sourceRef}\nDefault: ${varDef.default}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`font-medium truncate ${isOverridden ? 'text-neon-cyan' : 'text-gray-300'}`}>
          {varDef.name}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {varDef.type === 'string' ? (
            <input
              type="text"
              value={String(effectiveValue ?? '')}
              onChange={(e) => onSet(e.target.value || null)}
              placeholder="(not set)"
              className="input w-16 text-[9px] py-0"
            />
          ) : (
            <input
              type="number"
              value={effectiveValue !== null ? Number(effectiveValue) : ''}
              onChange={(e) => {
                const v = e.target.value
                onSet(v === '' ? null : Number(v))
              }}
              placeholder={String(varDef.default ?? 'auto')}
              className="input w-14 text-right text-[9px] py-0"
            />
          )}
          {isOverridden && (
            <button
              onClick={onReset}
              className="text-gray-500 hover:text-neon-red text-[9px] px-0.5"
              title="Reset to default"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="text-[9px] text-gray-600 truncate mt-0.5">
        {varDef.description}
        <span className="text-gray-700 ml-1">[{varDef.sourceRef}]</span>
      </div>
    </div>
  )
}
