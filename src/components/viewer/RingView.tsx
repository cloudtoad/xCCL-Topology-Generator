import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'
import { GPUNode } from './nodes/GPUNode'
import { LinkLine } from './LinkLine'
import { NodeType, LinkType } from '../../engine/types'
import { channelColors } from '../../utils/colors'
import { useMemo } from 'react'
import * as THREE from 'three'

export function RingView() {
  const system = useTopologyStore((s) => s.system)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const layout = useLayout(system)

  const ringLines = useMemo(() => {
    if (!ringGraph || !system || !layout) return []

    const lines: { points: THREE.Vector3[]; color: string; channel: number }[] = []

    for (let ch = 0; ch < ringGraph.nChannels; ch++) {
      if (selectedChannel !== null && selectedChannel !== ch) continue
      const channel = ringGraph.channels[ch]
      if (!channel) continue

      const points: THREE.Vector3[] = []
      for (const nodeId of channel.ringOrder) {
        const pos = layout.nodePositions.get(nodeId)
        if (pos) {
          points.push(new THREE.Vector3(pos[0], pos[1] + 0.3 + ch * 0.05, pos[2]))
        }
      }
      // Close the ring
      if (points.length > 0) {
        points.push(points[0].clone())
      }
      lines.push({ points, color: channelColors[ch % channelColors.length], channel: ch })
    }

    return lines
  }, [ringGraph, system, layout, selectedChannel])

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

      {/* Ring curves */}
      {ringLines.map(({ points, color, channel }) => (
        <group key={channel}>
          {points.length > 1 && (
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={color} linewidth={2} transparent opacity={selectedChannel === null ? 0.5 : 1} />
            </line>
          )}
        </group>
      ))}
    </group>
  )
}
