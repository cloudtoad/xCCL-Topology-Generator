import { useMemo } from 'react'
import { Text, Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { NodeType } from '../../engine/types'
import { channelColors } from '../../utils/colors'
import type { TopoNode, GraphChannel } from '../../engine/types'

const GPU_SIZE = 0.5
const GPU_GAP = 1.5

// Chain icon dimensions (two interlocking links on XZ plane)
const LINK_W = 0.07
const LINK_H = 0.04
const LINK_R = 0.012
const LINK_GAP = 0.03

/** Build a lookup from GPU id to TopoNode for rank access */
function buildGpuMap(nodes: TopoNode[]): Map<string, TopoNode> {
  const map = new Map<string, TopoNode>()
  for (const n of nodes) {
    if (n.type === NodeType.GPU) map.set(n.id, n)
  }
  return map
}

/** Tiny chain icon — two overlapping rounded rectangles, flat on XZ */
function ChainIconMesh({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <group>
      {/* Left link */}
      <mesh position={[-LINK_GAP, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(LINK_W, LINK_H) * 0.3, Math.min(LINK_W, LINK_H) * 0.7, 4]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={DoubleSide} />
      </mesh>
      {/* Right link */}
      <mesh position={[LINK_GAP, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(LINK_W, LINK_H) * 0.3, Math.min(LINK_W, LINK_H) * 0.7, 4]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={DoubleSide} />
      </mesh>
    </group>
  )
}

/** Walk the chain from root to tail using treeLinks array */
function getChainOrder(channel: GraphChannel): string[] {
  const links = channel.treeLinks ?? []
  if (links.length === 0) return []

  // Build parent→child and child→parent from the flat links array
  const childOf = new Map<string, string>()
  const hasParent = new Set<string>()
  for (const link of links) {
    childOf.set(link.parentId, link.childId)
    hasParent.add(link.childId)
  }

  // Root = a parentId that never appears as a childId
  let root: string | null = null
  for (const link of links) {
    if (!hasParent.has(link.parentId)) {
      root = link.parentId
      break
    }
  }
  if (!root) return []

  // Walk from root to tail
  const order = [root]
  let current = root
  while (childOf.has(current)) {
    current = childOf.get(current)!
    order.push(current)
  }

  return order
}

interface ChainPageProps {
  channel: GraphChannel
  channelIndex: number
  totalChannels: number
  gpuMap: Map<string, TopoNode>
  color: string
}

/** Single chain "page" — one channel's linear pipeline */
function ChainPage({ channel, channelIndex, totalChannels, gpuMap, color }: ChainPageProps) {
  const chainOrder = useMemo(() => getChainOrder(channel), [channel])
  const n = chainOrder.length
  if (n === 0) return null

  const y = 0.01

  // Position GPUs in a horizontal line, centered
  const positions = useMemo(() => {
    const totalWidth = (n - 1) * GPU_GAP
    return chainOrder.map((_, i) => ({
      x: i * GPU_GAP - totalWidth / 2,
      z: 0,
    }))
  }, [chainOrder, n])

  // Connecting line through all GPUs
  const linePts = useMemo(() => {
    const pts = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pts[i * 3] = positions[i].x
      pts[i * 3 + 1] = y
      pts[i * 3 + 2] = 0
    }
    return pts
  }, [positions, n, y])

  return (
    <group>
      {/* Chain line */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.25}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </line>

      {/* GPU nodes */}
      {chainOrder.map((gpuId, i) => {
        const pos = positions[i]
        const gpu = gpuMap.get(gpuId)
        const rank = gpu?.gpu?.rank ?? '?'
        const label = gpu?.label ?? gpuId
        const isRoot = i === 0

        return (
          <group key={gpuId} position={[pos.x, y, pos.z]}>
            {/* GPU square */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[GPU_SIZE, GPU_SIZE]} />
              <meshStandardMaterial
                color="#0a0a0f"
                emissive={color}
                emissiveIntensity={isRoot ? 0.25 : 0.08}
                side={DoubleSide}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
              <Edges color={color} threshold={15} />
            </mesh>

            {/* Root highlight border */}
            {isRoot && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[GPU_SIZE + 0.06, GPU_SIZE + 0.06]} />
                <meshBasicMaterial color={color} transparent opacity={0.35} side={DoubleSide} />
              </mesh>
            )}

            {/* Chain icon */}
            <ChainIconMesh color={color} opacity={isRoot ? 0.9 : 0.5} />

            {/* (root) label */}
            {isRoot && (
              <Text
                position={[0, 0.65, 0]}
                fontSize={0.11}
                color={color}
                anchorX="center"
                anchorY="bottom"
                font={undefined}
              >
                (root)
              </Text>
            )}

            {/* GPU name */}
            <Text
              position={[0, 0.4, 0]}
              fontSize={0.14}
              color={color}
              anchorX="center"
              anchorY="bottom"
              font={undefined}
            >
              {label}
            </Text>

            {/* Global rank */}
            <Text
              position={[0, 0.34, 0]}
              fontSize={0.1}
              color={color}
              anchorX="center"
              anchorY="top"
              font={undefined}
            >
              {`RANK${rank}`}
            </Text>
          </group>
        )
      })}

      {/* Channel info below the chain */}
      <Text
        position={[0, 0.5, 2]}
        fontSize={0.22}
        color={color}
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {`Channel ${channelIndex}`}
      </Text>
      <Text
        position={[0, 0.2, 2]}
        fontSize={0.12}
        color="#666677"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {`${channelIndex + 1} of ${totalChannels}  ·  ${channel.bandwidth} GB/s`}
      </Text>
    </group>
  )
}

export function TreeView() {
  const system = useTopologyStore((s) => s.system)
  const treeGraph = useTopologyStore((s) => s.treeGraph)
  const selectedChannel = useUIStore((s) => s.selectedChannel)

  const gpuMap = useMemo(() => {
    if (!system) return new Map<string, TopoNode>()
    return buildGpuMap(system.nodes)
  }, [system])

  if (!system || !treeGraph || treeGraph.nChannels === 0) return null

  const ch = selectedChannel ?? 0
  const channel = treeGraph.channels[ch]
  if (!channel) return null

  return (
    <group>
      <ChainPage
        channel={channel}
        channelIndex={ch}
        totalChannels={treeGraph.nChannels}
        gpuMap={gpuMap}
        color={channelColors[ch % channelColors.length]}
      />
    </group>
  )
}
