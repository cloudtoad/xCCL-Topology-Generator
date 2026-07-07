import { useUIStore, type ViewMode } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'physical', label: 'Physical' },
  { value: 'build', label: 'Build' },
  { value: 'ring', label: 'Ring' },
  { value: 'tree', label: 'Tree' },
  { value: 'nvls', label: 'NVLS' },
  { value: 'sim', label: 'Sim' },
]

export function ViewModeSelector() {
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const nvlsSupported = useTopologyStore((s) => s.nvlsSupported)
  const ringBuildTrace = useTopologyStore((s) => s.ringBuildTrace)
  const nvlsReason = useTopologyStore((s) => s.nvlsReason)

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-500 mr-1 uppercase">View</span>
      {viewModes.map((m) => {
        // The NVLS view is only meaningful when NVLS is supported by the topology.
        const disabled =
          (m.value === 'nvls' && !nvlsSupported) ||
          (m.value === 'build' && !ringBuildTrace)
        const isActive = viewMode === m.value
        return (
          <button
            key={m.value}
            onClick={() => !disabled && setViewMode(m.value)}
            disabled={disabled}
            title={
              disabled
                ? m.value === 'build'
                  ? 'Build walkthrough needs a generated single-server topology'
                  : `NVLS unavailable — ${nvlsReason}`
                : undefined
            }
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all duration-150 border ${
              disabled
                ? 'text-gray-700 border-transparent cursor-not-allowed'
                : isActive
                  ? 'text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
