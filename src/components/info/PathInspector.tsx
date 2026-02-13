import { useMemo } from 'react'
import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { pathColors } from '../../utils/colors'
import { PathType, LinkType, NodeType } from '../../engine/types'
import type { TopoSystem } from '../../engine/types'

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

// NOTE: C2C (3) and P2C (6) don't have entries here — they fall back to 'LOC' color.
// This is acceptable since they're rare and share similar visual weight.

/** Classify a single hop into its NCCL path type — mirrors classifyHop in paths.ts */
function classifyHopType(
  fromId: string,
  toId: string,
  linkType: LinkType,
  system: TopoSystem,
  nodeMap: Map<string, { type: NodeType }>,
): { label: string; weight: number } {
  const from = nodeMap.get(fromId)
  const to = nodeMap.get(toId)
  if (!from || !to) return { label: '?', weight: -1 }

  if (linkType === LinkType.NVL) return { label: 'NVL', weight: PathType.NVL }
  if (linkType === LinkType.C2C) return { label: 'C2C', weight: PathType.C2C }
  if (linkType === LinkType.SYS) return { label: 'SYS', weight: PathType.SYS }
  if (linkType === LinkType.NET) return { label: 'NET', weight: PathType.NET }

  if (linkType === LinkType.PCI) {
    if (from.type === NodeType.PCI && to.type === NodeType.PCI)
      return { label: 'PXB', weight: PathType.PXB }
    if (from.type === NodeType.CPU || to.type === NodeType.CPU)
      return { label: 'PHB', weight: PathType.PHB }
    return { label: 'PIX', weight: PathType.PIX }
  }

  return { label: 'LOC', weight: PathType.LOC }
}

export function PathInspector() {
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const system = useTopologyStore((s) => s.system)

  const nodeMap = useMemo(() => {
    if (!system) return new Map<string, { type: NodeType }>()
    const map = new Map<string, { type: NodeType }>()
    for (const n of system.nodes) map.set(n.id, { type: n.type })
    return map
  }, [system])

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
            <span className="text-[10px] text-gray-500">Weight</span>
            <span className="text-[10px] text-gray-200">{path.type} <span className="text-gray-600">(lower = faster)</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-gray-500">Bottleneck BW</span>
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
            <div className="flex items-center gap-1 text-[8px] text-gray-600 mt-1 mb-0.5">
              <span className="w-3">#</span>
              <span className="flex-1">Node</span>
              <span className="w-14 text-center">Type</span>
              <span className="w-14 text-right">BW</span>
            </div>
            <div className="space-y-0.5">
              {path.hops.map((hop, i) => {
                const prevId = i === 0 ? path.fromId : path.hops[i - 1].nodeId
                const cls = classifyHopType(prevId, hop.nodeId, hop.linkType, system, nodeMap)
                const hopColorKey = pathTypeKeys[cls.weight]
                const hopColor = hopColorKey ? pathColors[hopColorKey] : '#666'
                return (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span className="text-gray-600 w-3">{i + 1}</span>
                    <span className="text-gray-400 flex-1">{hop.nodeId}</span>
                    <span className="w-14 text-center font-mono" style={{ color: hopColor }}>
                      {cls.label}<span className="text-gray-600">({cls.weight})</span>
                    </span>
                    <span className="text-gray-500 w-14 text-right">
                      {hop.bandwidth.toFixed(1)} GB/s
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
