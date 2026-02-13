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
import { Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import { palette } from '../../utils/colors'
import { useUIStore } from '../../store/ui-store'
import type { TopoNode } from '../../engine/types'
import { InstancedClusterView } from './InstancedClusterView'
import type { TopoLink } from '../../engine/types'

export function PhysicalView() {
  const system = useTopologyStore((s) => s.system)
  const scaleView = useUIStore((s) => s.scaleView)

  // Detect multi-node
  const isMultiNode = useMemo(() => {
    if (!system) return false
    return system.nodes.some(n => n.id.startsWith('s0-') || n.id.startsWith('s1-'))
  }, [system])

  if (!system) return null

  // Multi-node cluster view → instanced renderer for performance
  if (isMultiNode && scaleView === 'cluster') {
    return <InstancedClusterView />
  }

  // Single server or node view → detailed renderer
  return <DetailedView />
}

/** Detailed per-node renderer — used for single server and node view */
function DetailedView() {
  const system = useTopologyStore((s) => s.system)
  const layout = useLayout(system)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const showCPUs = useUIStore((s) => s.showCPUs)

  const isMultiNode = useMemo(() => {
    if (!system) return false
    return system.nodes.some(n => n.id.startsWith('s0-') || n.id.startsWith('s1-'))
  }, [system])

  // Deduplicate bidirectional links
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

  // In node view, filter to only the selected server's nodes and links
  const visibleNodes = useMemo(() => {
    if (!system) return []
    if (!isMultiNode) return system.nodes
    const serverIdx = selectedServer ?? 0
    const prefix = `s${serverIdx}-`
    return system.nodes.filter(n => n.id.startsWith(prefix))
  }, [system, isMultiNode, selectedServer])

  const visibleLinks = useMemo(() => {
    if (!isMultiNode) return dedupedLinks
    const visibleIds = new Set(visibleNodes.map(n => n.id))
    return dedupedLinks.filter(l => visibleIds.has(l.fromId) && visibleIds.has(l.toId))
  }, [dedupedLinks, isMultiNode, visibleNodes])

  if (!system) return null

  return (
    <group>
      {visibleNodes.map((node) => {
        const pos = layout.nodePositions.get(node.id)
        if (!pos) return null
        const rotY = layout.nodeRotations.get(node.id) ?? 0

        switch (node.type) {
          case NodeType.GPU:
            return <GPUNode key={node.id} node={node} position={pos} rotationY={rotY} />
          case NodeType.CPU:
            if (!showCPUs) return null
            return <CPUNode key={node.id} node={node} position={pos} rotationY={rotY} />
          case NodeType.NIC:
            return <NICNode key={node.id} node={node} position={pos} rotationY={rotY} />
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
      {visibleLinks.map((link, i) => {
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
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.4, 24]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={palette.green}
          emissiveIntensity={0.1}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
        <Edges color={palette.green} threshold={15} />
      </mesh>
    </group>
  )
}
