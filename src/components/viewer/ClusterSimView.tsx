// =============================================================================
// ClusterSimView — origin-tagged AllGather frames at cluster scale.
//
// One channel at a time (the toolbar CH selector switches), rendered on the
// real cluster grid: intra hops arc between neighbors inside a server row,
// inter hops ride the channel's RAIL LANE (Manhattan route via the lane's x,
// matching the rail grammar of the Physical view). Every GPU carries a
// coverage ring that fills as origins arrive — the lockstep is the lesson:
// after step s, EVERY GPU holds exactly s+1 of the N origins.
//
// Pulses are colored by ORIGIN SERVER, so you can watch each server's
// contribution spread around the cluster while the flag word passes through
// every hop unaltered.
// =============================================================================

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, Edges, Line } from '@react-three/drei'
import * as THREE from 'three'
import { DoubleSide } from 'three'
import { useSimStore } from '../../store/sim-store'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'
import { simulateAllGather, clusterRankOf } from '../../sim/allgather'
import type { AllGatherFrame } from '../../sim/allgather'
import { channelColors } from '../../utils/colors'

type Vec3 = [number, number, number]

const SERVER_COLORS = ['#00ffff', '#ff00ff', '#00ff41', '#ffff00', '#ff6600', '#ff0040', '#88aaff', '#ffaacc']
const PULSE_Y = 0.55

/** Arc-length-parameterized point along a polyline. */
function pointAlong(pts: Vec3[], t: number): THREE.Vector3 {
  if (pts.length === 0) return new THREE.Vector3()
  if (pts.length === 1) return new THREE.Vector3(...pts[0])
  const lens: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dy = pts[i + 1][1] - pts[i][1]
    const dz = pts[i + 1][2] - pts[i][2]
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
    lens.push(l)
    total += l
  }
  let d = Math.max(0, Math.min(1, t)) * total
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const f = lens[i] > 0 ? d / lens[i] : 0
      return new THREE.Vector3(
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
        pts[i][2] + (pts[i + 1][2] - pts[i][2]) * f,
      )
    }
    d -= lens[i]
  }
  return new THREE.Vector3(...pts[pts.length - 1])
}

/** Low arc between two grid positions (intra-server hop). */
function intraArc(from: Vec3, to: Vec3, segments = 14): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    pts.push([
      from[0] + (to[0] - from[0]) * t,
      PULSE_Y + Math.sin(t * Math.PI) * 0.5,
      from[2] + (to[2] - from[2]) * t,
    ])
  }
  return pts
}

/** Manhattan route via the rail lane (inter-server hop). */
function railRoute(from: Vec3, to: Vec3, railX: number): Vec3[] {
  return [
    [from[0], PULSE_Y, from[2]],
    [railX, PULSE_Y, from[2]],
    [railX, PULSE_Y, to[2]],
    [to[0], PULSE_Y, to[2]],
  ]
}

function Pulse({ path, color, progressRef }: { path: Vec3[]; color: string; progressRef: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!group.current) return
    group.current.position.copy(pointAlong(path, progressRef.current))
  })
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.11, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function ClusterSimView() {
  const system = useTopologyStore((s) => s.system)
  const clusterTopo = useTopologyStore((s) => s.clusterTopo)
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const clusterTrace = useSimStore((s) => s.clusterTrace)
  const setClusterTrace = useSimStore((s) => s.setClusterTrace)
  const step = useSimStore((s) => s.step)
  const playing = useSimStore((s) => s.playing)
  const msPerStep = useSimStore((s) => s.msPerStep)
  const advance = useSimStore((s) => s.advance)
  const layout = useLayout(system)

  // Build the origin AllGather over the REAL cluster rings (one per channel).
  const built = useMemo(() => {
    if (!clusterTopo) return null
    const rankOf = clusterRankOf(clusterTopo.gpuPerServer)
    const ringOrders = clusterTopo.channels.map((ch) => ch.globalOrder.map(rankOf))
    return simulateAllGather(ringOrders, clusterTopo.serverCount * clusterTopo.gpuPerServer)
  }, [clusterTopo])

  useEffect(() => {
    if (built !== clusterTrace) setClusterTrace(built)
  }, [built]) // eslint-disable-line react-hooks/exhaustive-deps

  const progressRef = useRef(0)
  useFrame((_, delta) => {
    if (!playing) {
      progressRef.current = 0.45
      return
    }
    progressRef.current += (delta * 1000) / msPerStep
    if (progressRef.current >= 1) {
      progressRef.current = 0
      advance()
    }
  })

  if (!system || !clusterTopo || !clusterTrace) return null

  const gps = clusterTopo.gpuPerServer
  const nRanks = clusterTrace.nRanks
  const selCh = (selectedChannel ?? 0) % clusterTopo.nChannels
  const chan = clusterTopo.channels[selCh]
  const chanColor = channelColors[selCh % channelColors.length]

  const idOf = (r: number) => `s${Math.floor(r / gps)}-gpu-${r % gps}`
  const posOf = (r: number): Vec3 | undefined => layout.nodePositions.get(idOf(r)) as Vec3 | undefined
  const railX = (layout.nodePositions.get(`net-${chan.rail}`)?.[0] ?? 0) as number

  const done = step >= clusterTrace.nSteps
  const pending: AllGatherFrame[] = !done
    ? clusterTrace.framesByStep[step].filter((f) => f.channel === selCh)
    : []

  // Lockstep coverage: after `step` applied steps, every GPU holds step+1 origins.
  const held = Math.min(step + 1, nRanks)
  const heldFrac = held / nRanks

  // Rail lane extent (Z) across the server rows.
  let zMin = Infinity
  let zMax = -Infinity
  let xMin = Infinity
  for (let r = 0; r < nRanks; r++) {
    const p = posOf(r)
    if (!p) continue
    if (p[2] < zMin) zMin = p[2]
    if (p[2] > zMax) zMax = p[2]
    if (p[0] < xMin) xMin = p[0]
  }

  return (
    <group>
      {/* Banner — floats behind the far server row */}
      <Billboard position={[0, 8.2, zMin - 5]}>
        <Text fontSize={0.5} color={done ? '#00ff41' : '#e5e5e5'} anchorX="center">
          {done
            ? `AllGather complete — all ${nRanks} GPUs hold all ${nRanks} origins`
            : `AllGather step ${step + 1}/${clusterTrace.nSteps} · channel ${selCh} on rail ${chan.rail}`}
        </Text>
        <Text position={[0, -0.55, 0]} fontSize={0.26} color="#8899aa" anchorX="center">
          {done
            ? 'every flag word arrived exactly as it left its origin — copied, never altered'
            : 'every GPU forwards last step’s chunk to its ring successor; the origin flag passes through unaltered'}
        </Text>
      </Billboard>

      {/* Rail lane for the selected channel */}
      <Line
        points={[
          [railX, 0.04, zMin - 2.5],
          [railX, 0.04, zMax + 2.5],
        ]}
        color={chanColor}
        lineWidth={2}
        transparent
        opacity={0.5}
        toneMapped={false}
      />
      <Billboard position={[railX, 0.6, zMax + 3.1]}>
        <Text fontSize={0.28} color={chanColor} anchorX="center">
          {`rail ${chan.rail}`}
        </Text>
      </Billboard>

      {/* Server row labels */}
      {Array.from({ length: clusterTopo.serverCount }, (_, s) => {
        const p = posOf(s * gps)
        if (!p) return null
        return (
          <Billboard key={`srv-${s}`} position={[xMin - 1.8, 0.4, p[2]]}>
            <Text fontSize={0.3} color={SERVER_COLORS[s % SERVER_COLORS.length]} anchorX="center">
              {`node ${s}`}
            </Text>
          </Billboard>
        )
      })}

      {/* GPU tiles with coverage rings */}
      {Array.from({ length: nRanks }, (_, r) => {
        const p = posOf(r)
        if (!p) return null
        return (
          <group key={r} position={[p[0], 0.02, p[2]]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.55, 0.55]} />
              <meshStandardMaterial
                color="#0a0a0f"
                emissive={done ? '#00ff41' : '#00ffff'}
                emissiveIntensity={done ? 0.35 : 0.1}
                side={DoubleSide}
              />
              <Edges color={done ? '#00ff41' : '#00ffff'} threshold={15} />
            </mesh>
            {/* coverage ring: fraction of origins held */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
              <ringGeometry args={[0.34, 0.42, 32, 1, 0, Math.PI * 2 * heldFrac]} />
              <meshBasicMaterial
                color={done ? '#00ff41' : '#00ffff'}
                transparent
                opacity={0.75}
                side={DoubleSide}
                toneMapped={false}
              />
            </mesh>
            <Text position={[0, 0.34, 0]} fontSize={0.13} color="#9fd" anchorX="center">
              {`g${r % gps}`}
            </Text>
          </group>
        )
      })}

      {/* In-flight frames: intra arcs + rail routes, colored by origin server */}
      {pending.map((f, i) => {
        const from = posOf(f.fromRank)
        const to = posOf(f.toRank)
        if (!from || !to) return null
        const sameServer = Math.floor(f.fromRank / gps) === Math.floor(f.toRank / gps)
        const path = sameServer ? intraArc(from, to) : railRoute(from, to, railX)
        const color = SERVER_COLORS[Math.floor(f.origin / gps) % SERVER_COLORS.length]
        return (
          <group key={`${step}-${i}`}>
            <Line
              points={path}
              color={color}
              lineWidth={sameServer ? 1 : 1.6}
              transparent
              opacity={sameServer ? 0.22 : 0.4}
              toneMapped={false}
            />
            <Pulse path={path} color={color} progressRef={progressRef} />
          </group>
        )
      })}

      {/* Origin-server legend */}
      {Array.from({ length: clusterTopo.serverCount }, (_, s) => (
        <Billboard key={`leg-${s}`} position={[xMin - 3.2, 6.8 - s * 0.55, zMin - 5]}>
          <Text fontSize={0.24} color={SERVER_COLORS[s % SERVER_COLORS.length]} anchorX="left">
            {`● chunks from node ${s}`}
          </Text>
        </Billboard>
      ))}
    </group>
  )
}
