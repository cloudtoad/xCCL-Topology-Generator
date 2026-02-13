/**
 * High-performance instanced renderer for large multi-node cluster views.
 * Uses InstancedMesh (one draw call per node type) and a single lineSegments
 * geometry for all links. Handles 128+ servers without melting GPUs.
 */
import { useRef, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { useTopologyStore } from '../../store/topology-store'
import { useLayout } from '../../hooks/useLayout'
import { useUIStore } from '../../store/ui-store'
import { NodeType, LinkType } from '../../engine/types'
import { nodeColors, linkColors } from '../../utils/colors'
import { nodeRadius } from '../../utils/geometry'
import type { TopoNode, TopoLink } from '../../engine/types'

const DIM_NODE = new THREE.Color('#161620')
const DIM_LINK = new THREE.Color('#0c0c12')
const tempMatrix = new THREE.Matrix4()
const tempMatrix2 = new THREE.Matrix4()
const tempColor = new THREE.Color()

function getServerIdx(nodeId: string): number | null {
  const match = nodeId.match(/^s(\d+)-/)
  return match ? parseInt(match[1], 10) : null
}

const linkTypeColorMap: Record<number, string> = {
  [LinkType.LOC]: linkColors.LOC,
  [LinkType.NVL]: linkColors.NVL,
  [LinkType.C2C]: linkColors.NVB,
  [LinkType.PCI]: linkColors.PIX,
  [LinkType.SYS]: linkColors.SYS,
  [LinkType.NET]: linkColors.NET,
}

// ─── Per-type instanced node group ───────────────────────────────────────────

interface NodeGroupProps {
  nodes: TopoNode[]
  positions: Map<string, [number, number, number]>
  rotations: Map<string, number>
  selectedServer: number | null
  color: string
  size: number
  shape: 'box' | 'sphere'
  onClickInstance?: (nodeId: string) => void
}

function NodeGroup({ nodes, positions, rotations, selectedServer, color, size, shape, onClickInstance }: NodeGroupProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!meshRef.current || nodes.length === 0) return
    const mesh = meshRef.current

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const pos = positions.get(node.id)
      if (!pos) {
        tempMatrix.makeScale(0, 0, 0)
        mesh.setMatrixAt(i, tempMatrix)
        continue
      }

      const rot = rotations.get(node.id) ?? 0
      tempMatrix.makeRotationX(-Math.PI / 2)
      tempMatrix2.makeRotationY(rot)
      tempMatrix.premultiply(tempMatrix2)
      tempMatrix.setPosition(pos[0], pos[1], pos[2])
      mesh.setMatrixAt(i, tempMatrix)

      const serverIdx = getServerIdx(node.id)
      const isDimmed = selectedServer !== null && serverIdx !== null && serverIdx !== selectedServer
      tempColor.copy(isDimmed ? DIM_NODE : tempColor.set(color))
      mesh.setColorAt(i, tempColor)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [nodes, positions, rotations, selectedServer, color])

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId !== undefined && e.instanceId < nodes.length && onClickInstance) {
      onClickInstance(nodes[e.instanceId].id)
    }
  }

  if (nodes.length === 0) return null

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, nodes.length]} onClick={handleClick}>
      {shape === 'box'
        ? <planeGeometry args={[size, size]} />
        : <circleGeometry args={[size, 24]} />
      }
      <meshBasicMaterial
        toneMapped={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </instancedMesh>
  )
}

// ─── Batched link segments ───────────────────────────────────────────────────

interface LinkBatchProps {
  links: TopoLink[]
  positions: Map<string, [number, number, number]>
  selectedServer: number | null
}

function LinkBatch({ links, positions, selectedServer }: LinkBatchProps) {
  const { posArray, colArray, count } = useMemo(() => {
    const pos = new Float32Array(links.length * 6)
    const col = new Float32Array(links.length * 6)
    let validCount = 0

    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      const from = positions.get(link.fromId)
      const to = positions.get(link.toId)
      if (!from || !to) continue

      const offset = validCount * 6

      // Shorten endpoints so links stop at shape edges
      const dx = to[0] - from[0]
      const dz = to[2] - from[2]
      const len = Math.sqrt(dx * dx + dz * dz)
      if (len > 0) {
        const nx = dx / len, nz = dz / len
        const r0 = nodeRadius(link.fromId)
        const r1 = nodeRadius(link.toId)
        pos[offset]     = from[0] + nx * r0; pos[offset + 1] = from[1]; pos[offset + 2] = from[2] + nz * r0
        pos[offset + 3] = to[0]   - nx * r1; pos[offset + 4] = to[1];   pos[offset + 5] = to[2]   - nz * r1
      } else {
        pos[offset] = from[0]; pos[offset + 1] = from[1]; pos[offset + 2] = from[2]
        pos[offset + 3] = to[0]; pos[offset + 4] = to[1]; pos[offset + 5] = to[2]
      }

      const fromServer = getServerIdx(link.fromId)
      const toServer = getServerIdx(link.toId)
      const isDimmed = selectedServer !== null
        && ((fromServer !== null && fromServer !== selectedServer)
          || (toServer !== null && toServer !== selectedServer))

      if (isDimmed) {
        col[offset] = DIM_LINK.r; col[offset + 1] = DIM_LINK.g; col[offset + 2] = DIM_LINK.b
        col[offset + 3] = DIM_LINK.r; col[offset + 4] = DIM_LINK.g; col[offset + 5] = DIM_LINK.b
      } else {
        tempColor.set(linkTypeColorMap[link.type] ?? '#444466')
        col[offset] = tempColor.r; col[offset + 1] = tempColor.g; col[offset + 2] = tempColor.b
        col[offset + 3] = tempColor.r; col[offset + 4] = tempColor.g; col[offset + 5] = tempColor.b
      }

      validCount++
    }

    return {
      posArray: pos.subarray(0, validCount * 6),
      colArray: col.subarray(0, validCount * 6),
      count: validCount,
    }
  }, [links, positions, selectedServer])

  if (count === 0) return null

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
        <bufferAttribute attach="attributes-color" args={[colArray, 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.3} toneMapped={false} />
    </lineSegments>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function InstancedClusterView() {
  const system = useTopologyStore((s) => s.system)
  const layout = useLayout(system)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const selectServer = useUIStore((s) => s.selectServer)
  const showCPUs = useUIStore((s) => s.showCPUs)

  // Group nodes by type
  const nodeGroups = useMemo(() => {
    if (!system) return new Map<NodeType, TopoNode[]>()
    return system.nodesByType
  }, [system])

  // Deduplicate links
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

  const handleClickNode = (nodeId: string) => {
    const idx = getServerIdx(nodeId)
    if (idx !== null) selectServer(idx)
  }

  if (!system) return null

  const gpus = nodeGroups.get(NodeType.GPU) ?? []
  const cpus = nodeGroups.get(NodeType.CPU) ?? []
  const nics = nodeGroups.get(NodeType.NIC) ?? []
  const nvs = nodeGroups.get(NodeType.NVS) ?? []
  const pcis = nodeGroups.get(NodeType.PCI) ?? []
  const nets = nodeGroups.get(NodeType.NET) ?? []

  return (
    <group>
      <NodeGroup nodes={gpus} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={selectedServer} color={nodeColors.GPU} size={0.5} shape="box" onClickInstance={handleClickNode} />
      {showCPUs && <NodeGroup nodes={cpus} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={selectedServer} color={nodeColors.CPU} size={0.6} shape="box" onClickInstance={handleClickNode} />}
      <NodeGroup nodes={nics} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={selectedServer} color={nodeColors.NIC} size={0.35} shape="box" onClickInstance={handleClickNode} />
      <NodeGroup nodes={nvs} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={selectedServer} color={nodeColors.NVS} size={0.25} shape="sphere" onClickInstance={handleClickNode} />
      <NodeGroup nodes={pcis} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={selectedServer} color={nodeColors.PCI} size={0.2} shape="sphere" onClickInstance={handleClickNode} />
      <NodeGroup nodes={nets} positions={layout.nodePositions} rotations={layout.nodeRotations}
        selectedServer={null} color="#00ff88" size={0.4} shape="sphere" />

      <LinkBatch links={dedupedLinks} positions={layout.nodePositions} selectedServer={selectedServer} />
    </group>
  )
}
