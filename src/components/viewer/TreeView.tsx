import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'
import { GPUNode } from './nodes/GPUNode'
import { NodeType } from '../../engine/types'
import { channelColors } from '../../utils/colors'
import { useMemo } from 'react'
import * as THREE from 'three'

export function TreeView() {
  const system = useTopologyStore((s) => s.system)
  const treeGraph = useTopologyStore((s) => s.treeGraph)
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const layout = useLayout(system)

  const treeLines = useMemo(() => {
    if (!treeGraph || !system || !layout) return []

    const lines: { from: [number, number, number]; to: [number, number, number]; color: string; channel: number }[] = []

    for (let ch = 0; ch < treeGraph.nChannels; ch++) {
      if (selectedChannel !== null && selectedChannel !== ch) continue
      const channel = treeGraph.channels[ch]
      if (!channel?.treeLinks) continue

      for (const link of channel.treeLinks) {
        const fromPos = layout.nodePositions.get(link.parentId)
        const toPos = layout.nodePositions.get(link.childId)
        if (fromPos && toPos) {
          lines.push({
            from: fromPos,
            to: toPos,
            color: channelColors[ch % channelColors.length],
            channel: ch,
          })
        }
      }
    }

    return lines
  }, [treeGraph, system, layout, selectedChannel])

  if (!system) return null

  return (
    <group>
      {/* GPU nodes */}
      {system.nodes
        .filter((n) => n.type === NodeType.GPU)
        .map((node) => {
          const pos = layout.nodePositions.get(node.id)
          if (!pos) return null
          return <GPUNode key={node.id} node={node} position={pos} />
        })}

      {/* Tree links */}
      {treeLines.map(({ from, to, color, channel }, i) => (
        <line key={`${channel}-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([...from, ...to]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={color}
            linewidth={2}
            transparent
            opacity={selectedChannel === null ? 0.5 : 1}
          />
        </line>
      ))}
    </group>
  )
}
