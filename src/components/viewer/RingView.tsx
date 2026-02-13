import { useMemo } from 'react'
import { Text, Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { NodeType } from '../../engine/types'
import { channelColors } from '../../utils/colors'
import type { TopoNode, GraphChannel } from '../../engine/types'

const RING_RADIUS = 4
const GPU_SIZE = 0.5
const ICON_INNER = 0.09
const ICON_OUTER = 0.14

/** Build a lookup from GPU id to TopoNode for rank access */
function buildGpuMap(nodes: TopoNode[]): Map<string, TopoNode> {
  const map = new Map<string, TopoNode>()
  for (const n of nodes) {
    if (n.type === NodeType.GPU) map.set(n.id, n)
  }
  return map
}

/** Octagonal ring icon — outline only, flat on XZ */
function RingIconMesh({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[ICON_INNER, ICON_OUTER, 8]} />
      <meshBasicMaterial visible={false} />
      <Edges color={color} transparent opacity={opacity} />
    </mesh>
  )
}

interface RingPageProps {
  channel: GraphChannel
  channelIndex: number
  totalChannels: number
  gpuMap: Map<string, TopoNode>
  color: string
}

/** Single ring "page" — one channel's ring shown as a circle with GPU icons */
function RingPage({ channel, channelIndex, totalChannels, gpuMap, color }: RingPageProps) {
  const n = channel.ringOrder.length
  if (n === 0) return null

  const y = 0.01

  // GPU positions evenly around the circle, clockwise from top
  const gpuPositions = useMemo(() =>
    channel.ringOrder.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      return {
        x: RING_RADIUS * Math.cos(angle),
        z: RING_RADIUS * Math.sin(angle),
      }
    }),
    [channel.ringOrder, n],
  )

  // Smooth ring circle
  const ringPoints = useMemo(() => {
    const segments = 128
    const pts = new Float32Array((segments + 1) * 3)
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2 - Math.PI / 2
      pts[i * 3] = RING_RADIUS * Math.cos(angle)
      pts[i * 3 + 1] = y
      pts[i * 3 + 2] = RING_RADIUS * Math.sin(angle)
    }
    return pts
  }, [y])

  return (
    <group>
      {/* Ring circle */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[ringPoints, 3]} />
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
      {channel.ringOrder.map((gpuId, i) => {
        const pos = gpuPositions[i]
        const gpu = gpuMap.get(gpuId)
        const rank = gpu?.gpu?.rank ?? '?'
        const label = gpu?.label ?? gpuId
        const isHead = i === 0

        return (
          <group key={gpuId} position={[pos.x, y, pos.z]}>
            {/* GPU square */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[GPU_SIZE, GPU_SIZE]} />
              <meshStandardMaterial
                color="#0a0a0f"
                emissive={color}
                emissiveIntensity={isHead ? 0.25 : 0.08}
                side={DoubleSide}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
              <Edges color={color} threshold={15} />
            </mesh>

            {/* Thicker edge outline for head */}
            {isHead && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[GPU_SIZE + 0.06, GPU_SIZE + 0.06]} />
                <meshBasicMaterial color={color} transparent opacity={0.35} side={DoubleSide} />
              </mesh>
            )}

            {/* Ring icon on the square */}
            <RingIconMesh color={color} opacity={isHead ? 0.9 : 0.5} />

            {/* (head) label above GPU name */}
            {isHead && (
              <Text
                position={[0, 0.65, 0]}
                fontSize={0.11}
                color={color}
                anchorX="center"
                anchorY="bottom"
                font={undefined}
              >
                (head)
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

            {/* Global rank below GPU name */}
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

      {/* Channel info in center */}
      <Text
        position={[0, 0.5, 0]}
        fontSize={0.22}
        color={color}
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {`Channel ${channelIndex}`}
      </Text>
      <Text
        position={[0, 0.2, 0]}
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

export function RingView() {
  const system = useTopologyStore((s) => s.system)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const selectedChannel = useUIStore((s) => s.selectedChannel)

  const gpuMap = useMemo(() => {
    if (!system) return new Map<string, TopoNode>()
    return buildGpuMap(system.nodes)
  }, [system])

  if (!system || !ringGraph || ringGraph.nChannels === 0) return null

  // Show selected channel, or default to channel 0
  const ch = selectedChannel ?? 0
  const channel = ringGraph.channels[ch]
  if (!channel) return null

  return (
    <group>
      <RingPage
        channel={channel}
        channelIndex={ch}
        totalChannels={ringGraph.nChannels}
        gpuMap={gpuMap}
        color={channelColors[ch % channelColors.length]}
      />
    </group>
  )
}
