import { useUIStore, type ViewMode } from '../../store/ui-store'

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'physical', label: 'Physical' },
  { value: 'ring', label: 'Ring' },
  { value: 'tree', label: 'Tree' },
  { value: 'paths', label: 'Paths' },
]

export function ViewModeSelector() {
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-500 mr-1 uppercase">View</span>
      {viewModes.map((m) => (
        <button
          key={m.value}
          onClick={() => setViewMode(m.value)}
          className={`px-2 py-1 text-[10px] font-medium rounded transition-all duration-150 border ${
            viewMode === m.value
              ? 'text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10'
              : 'text-gray-500 border-transparent hover:text-gray-300'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
