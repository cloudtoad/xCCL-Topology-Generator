import { useMemo } from 'react'
import { useTopologyStore } from '../../store/topology-store'
import { useLayout } from '../../hooks/useLayout'
import { GPUNode } from './nodes/GPUNode'
import { CPUNode } from './nodes/CPUNode'
import { NICNode } from './nodes/NICNode'
import { NVSwitchNode } from './nodes/NVSwitchNode'
import { PCINode } from './nodes/PCINode'
import { LinkLine } from './LinkLine'
import { NodeType } from '../../engine/types'
import { palette } from '../../utils/colors'
import type { TopoNode, TopoLink } from '../../engine/types'

export function PhysicalView() {
  const system = useTopologyStore((s) => s.system)
  const layout = useLayout(system)

  // Deduplicate bidirectional links — only render one line per pair
  const dedupedLinks = useMemo(() => {
    if (!system) return []
    const seen = new Set<string>()
    const result: TopoLink[] = []
    for (const link of system.links) {
      const key = link.fromId < link.toId
        ? `${link.fromId}|${link.toId}|${link.type}`
        : `${link.toId}|${link.fromId}|${link.type}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(link)
      }
    }
    return result
  }, [system])

  if (!system) return null

  return (
    <group>
      {system.nodes.map((node) => {
        const pos = layout.nodePositions.get(node.id)
        if (!pos) return null

        switch (node.type) {
          case NodeType.GPU:
            return <GPUNode key={node.id} node={node} position={pos} />
          case NodeType.CPU:
            return <CPUNode key={node.id} node={node} position={pos} />
          case NodeType.NIC:
            return <NICNode key={node.id} node={node} position={pos} />
          case NodeType.NVS:
            return <NVSwitchNode key={node.id} node={node} position={pos} />
          case NodeType.PCI:
            return <PCINode key={node.id} node={node} position={pos} />
          case NodeType.NET:
            return <NetSwitchNode key={node.id} node={node} position={pos} />
          default:
            return null
        }
      })}
      {dedupedLinks.map((link, i) => {
        const fromPos = layout.nodePositions.get(link.fromId)
        const toPos = layout.nodePositions.get(link.toId)
        if (!fromPos || !toPos) return null
        return <LinkLine key={i} link={link} from={fromPos} to={toPos} />
      })}
    </group>
  )
}

function NetSwitchNode({
  node,
  position,
}: {
  node: TopoNode
  position: [number, number, number]
}) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshBasicMaterial color={palette.green} wireframe />
      </mesh>
    </group>
  )
}
