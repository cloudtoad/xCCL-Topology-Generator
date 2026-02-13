import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { pathColors } from '../../utils/colors'
import { PathType } from '../../engine/types'

const pathTypeNames: Record<number, string> = {
  [PathType.LOC]: 'LOC (Local)',
  [PathType.NVL]: 'NVL (NVLink)',
  [PathType.NVB]: 'NVB (NVLink Bounce)',
  [PathType.C2C]: 'C2C (Chip-to-Chip)',
  [PathType.PIX]: 'PIX (PCIe Switch)',
  [PathType.PXB]: 'PXB (Cross PCIe)',
  [PathType.P2C]: 'P2C (C2C+PCIe)',
  [PathType.PXN]: 'PXN (PCIe via NUMA)',
  [PathType.PHB]: 'PHB (PCIe Host Bridge)',
  [PathType.SYS]: 'SYS (Cross-Socket)',
  [PathType.NET]: 'NET (Network)',
  [PathType.DIS]: 'DIS (Disconnected)',
}

const pathTypeKeys: Record<number, keyof typeof pathColors> = {
  [PathType.LOC]: 'LOC',
  [PathType.NVL]: 'NVL',
  [PathType.NVB]: 'NVB',
  [PathType.PIX]: 'PIX',
  [PathType.PXB]: 'PXB',
  [PathType.PXN]: 'PXN',
  [PathType.PHB]: 'PHB',
  [PathType.SYS]: 'SYS',
  [PathType.NET]: 'NET',
}

export function PathInspector() {
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const system = useTopologyStore((s) => s.system)

  if (selectedNodes.length < 2 || !system) {
    return (
      <div className="text-xs text-gray-600 p-2">
        {selectedNodes.length === 0
          ? 'Click two nodes to inspect path'
          : `Selected: ${selectedNodes[0]} — click another node`}
      </div>
    )
  }

  const [fromId, toId] = selectedNodes
  const pathKey = `${fromId}->${toId}`
  const path = system.paths.get(pathKey)

  if (!path) {
    return (
      <div className="text-xs text-gray-500 p-2">
        <p>No path found: {fromId} → {toId}</p>
        <button onClick={clearSelection} className="text-neon-cyan text-[10px] mt-1">
          Clear selection
        </button>
      </div>
    )
  }

  const colorKey = pathTypeKeys[path.type] ?? 'LOC'
  const color = pathColors[colorKey]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-300">Path Inspector</h4>
        <button onClick={clearSelection} className="text-[9px] text-gray-500 hover:text-neon-cyan">
          Clear
        </button>
      </div>

      <div className="p-2 rounded border border-surface-600">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-neon-cyan">{fromId}</span>
          <span className="text-[10px] text-gray-600">→</span>
          <span className="text-[10px] text-neon-cyan">{toId}</span>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-[10px] text-gray-500">Type</span>
            <span className="text-[10px] font-medium" style={{ color }}>
              {pathTypeNames[path.type] ?? 'Unknown'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-gray-500">Bandwidth</span>
            <span className="text-[10px] text-gray-200">{path.bandwidth.toFixed(1)} GB/s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-gray-500">Hops</span>
            <span className="text-[10px] text-gray-200">{path.count}</span>
          </div>
        </div>

        {path.hops.length > 0 && (
          <div className="mt-2 pt-2 border-t border-surface-600">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Hop Details</span>
            <div className="space-y-0.5 mt-1">
              {path.hops.map((hop, i) => (
                <div key={i} className="flex items-center gap-1 text-[9px]">
                  <span className="text-gray-600 w-3">{i + 1}</span>
                  <span className="text-gray-400">{hop.nodeId}</span>
                  <span className="text-gray-600 flex-1 text-right">
                    {hop.bandwidth.toFixed(1)} GB/s
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
