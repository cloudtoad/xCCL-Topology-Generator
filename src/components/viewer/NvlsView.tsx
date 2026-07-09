import { useMemo } from 'react'
import { Text, Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { NodeType } from '../../engine/types'
import { nodeColors } from '../../utils/colors'
import type { TopoNode, GraphChannel } from '../../engine/types'

const RING_RADIUS = 4
const GPU_SIZE = 0.5
const SWITCH_SIZE = 0.9
const NVLS_COLOR = '#2dd4bf' // teal — the NVLS/SHARP accent
const SWITCH_COLOR = nodeColors.NVS // yellow

/** Build a lookup from node id to TopoNode. */
function buildNodeMap(nodes: TopoNode[]): Map<string, TopoNode> {
  const map = new Map<string, TopoNode>()
  for (const n of nodes) map.set(n.id, n)
  return map
}

/** A small inward-pointing arrowhead (two short line segments) at `at`, pointing toward `to`. */
function arrowHead(
  at: [number, number, number],
  to: [number, number, number],
  size = 0.18,
): Float32Array {
  const [ax, , az] = at
  const dx = to[0] - ax
  const dz = to[2] - az
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  // Two barbs rotated ±30° from the reverse direction.
  const barb = (angle: number): [number, number] => {
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    // reverse direction (-u) rotated by angle
    const rx = -ux * ca - -uz * sa
    const rz = -ux * sa + -uz * ca
    return [ax + rx * size, az + rz * size]
  }
  const [b1x, b1z] = barb(Math.PI / 6)
  const [b2x, b2z] = barb(-Math.PI / 6)
  const y = at[1]
  return new Float32Array([b1x, y, b1z, ax, y, az, b2x, y, b2z])
}

interface NvlsPageProps {
  channel: GraphChannel
  channelIndex: number
  totalChannels: number
  nodeMap: Map<string, TopoNode>
}

/** One NVLS channel: GPUs in a circle all feeding a central NVSwitch (SHARP). */
function NvlsPage({ channel, channelIndex, totalChannels, nodeMap }: NvlsPageProps) {
  const gpuIds = channel.nvlsGpus ?? channel.ringOrder
  const n = gpuIds.length
  const y = 0.02

  const switchNode = channel.nvlsSwitch ? nodeMap.get(channel.nvlsSwitch) : undefined
  const switchLabel = switchNode?.label ?? channel.nvlsSwitch ?? 'NVSwitch'

  const gpuPositions = useMemo(
    () =>
      gpuIds.map((_, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2
        return {
          x: RING_RADIUS * Math.cos(angle),
          z: RING_RADIUS * Math.sin(angle),
        }
      }),
    [gpuIds, n],
  )

  if (n === 0) return null

  const center: [number, number, number] = [0, y, 0]

  return (
    <group>
      {/* Spokes: GPU <-> central switch (NVLink) + reduce arrowheads */}
      {gpuPositions.map((pos, i) => {
        const gpuPt: [number, number, number] = [pos.x, y, pos.z]
        const linePts = new Float32Array([pos.x, y, pos.z, 0, y, 0])
        // Arrowhead ~40% along the spoke pointing inward (reduction toward switch).
        const midIn: [number, number, number] = [pos.x * 0.55, y, pos.z * 0.55]
        const head = arrowHead(midIn, center)
        return (
          <group key={gpuIds[i]}>
            <line>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[linePts, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={NVLS_COLOR} transparent opacity={0.5} />
            </line>
            <line>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[head, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={NVLS_COLOR} transparent opacity={0.85} />
            </line>
            {/* GPU node — the channel's head GPU is highlighted */}
            <group position={gpuPt}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[GPU_SIZE, GPU_SIZE]} />
                <meshStandardMaterial
                  color="#0a0a0f"
                  emissive={NVLS_COLOR}
                  emissiveIntensity={gpuIds[i] === channel.nvlsHead ? 0.3 : 0.12}
                  side={DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={1}
                  polygonOffsetUnits={1}
                />
                <Edges color={NVLS_COLOR} threshold={15} />
              </mesh>
              {gpuIds[i] === channel.nvlsHead && (
                <Text position={[0, 0.66, 0]} fontSize={0.1} color={NVLS_COLOR} anchorX="center" anchorY="bottom">
                  (head)
                </Text>
              )}
              <Text
                position={[0, 0.4, 0]}
                fontSize={0.14}
                color={NVLS_COLOR}
                anchorX="center"
                anchorY="bottom"
              >
                {nodeMap.get(gpuIds[i])?.label ?? gpuIds[i]}
              </Text>
              <Text
                position={[0, 0.34, 0]}
                fontSize={0.1}
                color={NVLS_COLOR}
                anchorX="center"
                anchorY="top"
              >
                {`RANK${nodeMap.get(gpuIds[i])?.gpu?.rank ?? '?'}`}
              </Text>
            </group>
          </group>
        )
      })}

      {/* Central NVSwitch (the SHARP reduction/multicast engine) */}
      <group position={center}>
        <mesh rotation={[-Math.PI / 2, Math.PI / 4, 0]}>
          <planeGeometry args={[SWITCH_SIZE, SWITCH_SIZE]} />
          <meshStandardMaterial
            color="#0a0a0f"
            emissive={SWITCH_COLOR}
            emissiveIntensity={0.35}
            side={DoubleSide}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
          <Edges color={SWITCH_COLOR} threshold={15} />
        </mesh>
        <Text position={[0, 0.55, 0]} fontSize={0.16} color={SWITCH_COLOR} anchorX="center" anchorY="bottom">
          {switchLabel}
        </Text>
        <Text position={[0, -0.5, 0]} fontSize={0.12} color={SWITCH_COLOR} anchorX="center" anchorY="top">
          SHARP reduce + multicast
        </Text>
      </group>

      {/* Header — NVLS graph channels are per-GPU "heads" */}
      <Text position={[0, 0, -RING_RADIUS - 1.2]} fontSize={0.24} color={NVLS_COLOR} anchorX="center" anchorY="middle">
        {`NVLS Head Channel ${channelIndex}`}
      </Text>
      <Text position={[0, 0, -RING_RADIUS - 0.85]} fontSize={0.12} color="#666677" anchorX="center" anchorY="middle">
        {`head ${channelIndex + 1} of ${totalChannels}  ·  ${channel.bandwidth} GB/s/head  ·  ${n} GPUs pull from switch`}
      </Text>
    </group>
  )
}

export function NvlsView() {
  const displaySystem = useTopologyStore((s) => s.system)
  const buildSystem = useTopologyStore((s) => s.buildSystem)
  // Two-node scenario: graphs were computed on the searched local view (+NETs),
  // whose node ids the channel orders reference — render on that system.
  const system = buildSystem ?? displaySystem
  const nvlsGraph = useTopologyStore((s) => s.nvlsGraph)
  const nvlsReason = useTopologyStore((s) => s.nvlsReason)
  const selectedChannel = useUIStore((s) => s.selectedChannel)

  const nodeMap = useMemo(() => {
    if (!system) return new Map<string, TopoNode>()
    return buildNodeMap(system.nodes)
  }, [system])

  // NVLS unsupported / not generated — show an explanatory placeholder.
  if (!system || !nvlsGraph || nvlsGraph.nChannels === 0) {
    return (
      <Text position={[0, 1, 0]} fontSize={0.3} color="#888899" anchorX="center" anchorY="middle" maxWidth={10}>
        {nvlsReason ? `NVLS unavailable — ${nvlsReason}` : 'No NVLS graph. Generate a Hopper+ NVSwitch topology.'}
      </Text>
    )
  }

  const ch = selectedChannel ?? 0
  const channel = nvlsGraph.channels[ch] ?? nvlsGraph.channels[0]
  if (!channel) return null

  return (
    <group>
      <NvlsPage
        channel={channel}
        channelIndex={nvlsGraph.channels.indexOf(channel)}
        totalChannels={nvlsGraph.nChannels}
        nodeMap={nodeMap}
      />
    </group>
  )
}
