import { useState } from 'react'
import { useDecisionStore } from '../../store/decision-store'
import type { DecisionPhase } from '../../engine/types'

const phaseColors: Record<DecisionPhase, string> = {
  topoGetSystem: 'text-neon-cyan',
  computePaths: 'text-neon-magenta',
  trimSystem: 'text-neon-yellow',
  searchInit: 'text-neon-green',
  ringSearch: 'text-neon-orange',
  treeSearch: 'text-blue-400',
  channelSetup: 'text-purple-400',
  romeModelMatch: 'text-neon-red',
}

const phaseLabels: Record<DecisionPhase, string> = {
  topoGetSystem: 'TOPO',
  computePaths: 'PATH',
  trimSystem: 'TRIM',
  searchInit: 'INIT',
  ringSearch: 'RING',
  treeSearch: 'TREE',
  channelSetup: 'CHAN',
  romeModelMatch: 'ROME',
}

export function DecisionLog() {
  const entries = useDecisionStore((s) => s.entries)
  const [filter, setFilter] = useState<DecisionPhase | 'all'>('all')
  const [search, setSearch] = useState('')

  const filteredEntries = entries.filter((e) => {
    if (filter !== 'all' && e.phase !== filter) return false
    if (search) {
      const lower = search.toLowerCase()
      return (
        e.action.toLowerCase().includes(lower) ||
        e.reason.toLowerCase().includes(lower) ||
        e.sourceRef.toLowerCase().includes(lower)
      )
    }
    return true
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Decision Log
        </h3>
        <span className="text-[9px] text-gray-600">{entries.length} entries</span>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search decisions..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input w-full text-[10px] py-1"
      />

      {/* Phase filter */}
      <div className="flex flex-wrap gap-0.5">
        <FilterBtn label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        {(Object.keys(phaseLabels) as DecisionPhase[]).map((phase) => (
          <FilterBtn
            key={phase}
            label={phaseLabels[phase]}
            active={filter === phase}
            onClick={() => setFilter(phase)}
            color={phaseColors[phase]}
          />
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <p className="text-[10px] text-gray-600 py-4 text-center">
            {entries.length === 0
              ? 'Generate a topology to see decisions'
              : 'No matching entries'}
          </p>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.step}
              className="p-2 rounded border border-surface-600 hover:border-surface-600/80 transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] text-gray-600 w-5 text-right">
                  {entry.step}
                </span>
                <span
                  className={`text-[9px] font-bold px-1 rounded ${phaseColors[entry.phase]} bg-current/10`}
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  {phaseLabels[entry.phase]}
                </span>
                <span className="text-[10px] text-gray-200 flex-1 truncate">
                  {entry.action}
                </span>
              </div>
              <p className="text-[9px] text-gray-500 pl-7">{entry.reason}</p>
              <div className="flex items-center gap-2 pl-7 mt-0.5">
                <span className="text-[8px] text-gray-600 font-mono">
                  {entry.sourceRef}
                </span>
                {entry.alternatives.length > 0 && (
                  <span className="text-[8px] text-gray-700">
                    alt: {entry.alternatives.join(', ')}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function FilterBtn({
  label,
  active,
  onClick,
  color = 'text-gray-300',
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
        active
          ? `${color} bg-current/10`
          : 'text-gray-600 hover:text-gray-400'
      }`}
      style={active ? { backgroundColor: 'rgba(255,255,255,0.05)' } : undefined}
    >
      {label}
    </button>
  )
}
