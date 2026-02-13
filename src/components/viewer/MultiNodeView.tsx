import { useMemo } from 'react'
import { useTopologyStore } from '../../store/topology-store'
import { useLayout } from '../../hooks/useLayout'
import { NodeType } from '../../engine/types'
import { GPUNode } from './nodes/GPUNode'
import { CPUNode } from './nodes/CPUNode'
import { NICNode } from './nodes/NICNode'
import { NVSwitchNode } from './nodes/NVSwitchNode'
import { PCINode } from './nodes/PCINode'
import { LinkLine } from './LinkLine'
import { palette } from '../../utils/colors'
import type { TopoNode } from '../../engine/types'

/**
 * Multi-node topology view — renders multiple server clusters connected
 * by network switches with inter-node links.
 */
export function MultiNodeView() {
  const system = useTopologyStore((s) => s.system)
  const layout = useLayout(system)

  // Identify server clusters from node ID prefixes (s0-, s1-, etc.)
  const serverBounds = useMemo(() => {
    if (!system) return []

    const servers = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>()

    for (const node of system.nodes) {
      const match = node.id.match(/^(s\d+)-/)
      if (!match) continue

      const serverId = match[1]
      const pos = layout.nodePositions.get(node.id)
      if (!pos) continue

      const bounds = servers.get(serverId) ?? { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
      bounds.minX = Math.min(bounds.minX, pos[0])
      bounds.maxX = Math.max(bounds.maxX, pos[0])
      bounds.minZ = Math.min(bounds.minZ, pos[2])
      bounds.maxZ = Math.max(bounds.maxZ, pos[2])
      servers.set(serverId, bounds)
    }

    return Array.from(servers.entries()).map(([id, b]) => ({
      id,
      center: [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2] as [number, number, number],
      size: [b.maxX - b.minX + 3, 0.1, b.maxZ - b.minZ + 3] as [number, number, number],
    }))
  }, [system, layout])

  if (!system) return null

  return (
    <group>
      {/* Server boundary boxes */}
      {serverBounds.map((server) => (
        <group key={server.id} position={server.center}>
          <mesh position={[0, -0.5, 0]}>
            <boxGeometry args={server.size} />
            <meshBasicMaterial color={palette.border} transparent opacity={0.15} wireframe />
          </mesh>
        </group>
      ))}

      {/* Nodes */}
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

      {/* Links */}
      {system.links.map((link, i) => {
        const fromPos = layout.nodePositions.get(link.fromId)
        const toPos = layout.nodePositions.get(link.toId)
        if (!fromPos || !toPos) return null

        return (
          <LinkLine
            key={`${link.fromId}-${link.toId}-${i}`}
            link={link}
            from={fromPos}
            to={toPos}
          />
        )
      })}
    </group>
  )
}

/**
 * Network switch node — rendered as a larger sphere to represent
 * inter-node network connectivity.
 */
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
      <sprite position={[0, 0.7, 0]} scale={[2, 0.4, 1]}>
        <spriteMaterial color={palette.green} opacity={0.8} transparent />
      </sprite>
    </group>
  )
}
