// =============================================================================
// Cluster rail-lane overlay (free-look)
//
// Rail-optimized traffic drawn as RAIL LANES: one straight lane per rail
// running along Z past every server, anchored on its NET switch (the layout
// places net-r beside the server stack; the lane passes through it). Each
// inter-node ring hop becomes a pair of Manhattan "jumper" taps: the exit GPU
// taps down onto its channel's lane, traffic runs along the lane, and rises
// into the next server's entry GPU (arrowhead shows direction).
//
// Tufte rationale: free-form arcs crossed mid-air (32 curves × 8 hues = 1+1=3
// noise). Lanes have zero crossings by construction, lane width ∝ channels
// riding the rail (proportional ink — load imbalance becomes visible weight),
// and each lane is directly labeled at its near end (no legend).
// =============================================================================

import { useMemo } from 'react'
import * as THREE from 'three'
import { Line, Text } from '@react-three/drei'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'

const TAP_Y = 0.35 // taps hop over the server row like a jumper cable

/** Distinct, saturated color per rail. */
function railColor(rail: number, railCount: number): string {
  const hue = (rail / Math.max(1, railCount)) * 360
  return `hsl(${hue}, 90%, 60%)`
}

type Vec3 = [number, number, number]

interface LaneSpec {
  rail: number
  x: number
  zMin: number
  zMax: number
  color: string
  width: number
  channels: number
}

interface TapSpec {
  key: string
  points: Vec3[] // polyline GPU → over the row → down onto the lane (or reverse)
  color: string
  /** Entry taps get an arrowhead pointing into the GPU. */
  arrowAt?: { pos: THREE.Vector3; dir: THREE.Vector3 }
}

export function ClusterRailOverlay() {
  const system = useTopologyStore((s) => s.system)
  const clusterTopo = useTopologyStore((s) => s.clusterTopo)
  const showRails = useUIStore((s) => s.showRails)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const layout = useLayout(system)

  const { lanes, taps } = useMemo(() => {
    const lanes: LaneSpec[] = []
    const taps: TapSpec[] = []
    if (!clusterTopo) return { lanes, taps }

    // Lane width ∝ channels riding the rail (e.g. 12ch over 8 rails → rails
    // 0-3 carry 2 channels and read visibly heavier than rails 4-7 with 1).
    const channelsPerRail = new Map<number, number>()
    for (const ch of clusterTopo.channels) {
      channelsPerRail.set(ch.rail, (channelsPerRail.get(ch.rail) ?? 0) + 1)
    }

    // Z extent: span every server row, and cap each lane at its NET switch —
    // the switch is the lane's terminal, not a floating ornament.
    let zMin = Infinity
    let zMax = -Infinity
    for (const [id, pos] of layout.nodePositions) {
      if (!id.includes('gpu-')) continue
      if (pos[2] < zMin) zMin = pos[2]
      if (pos[2] > zMax) zMax = pos[2]
    }
    if (!Number.isFinite(zMin)) return { lanes, taps }
    zMin -= 1.2

    // One lane per rail, anchored at its NET switch's X, ending AT the switch.
    for (const [rail, channels] of channelsPerRail) {
      const netPos = layout.nodePositions.get(`net-${rail}`)
      if (!netPos) continue
      lanes.push({
        rail,
        x: netPos[0],
        zMin,
        zMax: Math.max(zMax + 1.2, netPos[2]),
        color: railColor(rail, clusterTopo.railCount),
        width: 1 + 1.1 * channels,
        channels,
      })
    }

    // Taps: one exit + one entry stub per (deduped) hop.
    const laneX = new Map(lanes.map((l) => [l.rail, l.x]))
    const seen = new Set<string>()
    for (const ch of clusterTopo.channels) {
      const color = railColor(ch.rail, clusterTopo.railCount)
      const lx = laneX.get(ch.rail)
      if (lx === undefined) continue
      for (const hop of ch.hops) {
        const key = `${hop.fromId}>${hop.toId}|${hop.rail}`
        if (seen.has(key)) continue
        seen.add(key)

        const from = layout.nodePositions.get(hop.fromId)
        const to = layout.nodePositions.get(hop.toId)
        if (!from || !to) continue
        if (selectedServer !== null) {
          const touches =
            hop.fromId.startsWith(`s${selectedServer}-`) || hop.toId.startsWith(`s${selectedServer}-`)
          if (!touches) continue
        }

        // Stagger each rail's jumpers slightly in Z so overlapping taps at the
        // same row separate into distinct threads (a comb, not a blob).
        const dz = (ch.rail - (clusterTopo.railCount - 1) / 2) * 0.09

        // Exit jumper: GPU rises, runs over the row to the lane, drops on.
        taps.push({
          key: `${key}|out`,
          color,
          points: [
            [from[0], 0.05, from[2]],
            [from[0], TAP_Y, from[2] + dz],
            [lx, TAP_Y, from[2] + dz],
            [lx, 0.05, from[2] + dz],
          ],
        })

        // Entry jumper: lane rises, runs to the entry GPU, drops in (arrow).
        taps.push({
          key: `${key}|in`,
          color,
          points: [
            [lx, 0.05, to[2] + dz],
            [lx, TAP_Y, to[2] + dz],
            [to[0], TAP_Y, to[2] + dz],
            [to[0], 0.12, to[2]],
          ],
          arrowAt: {
            pos: new THREE.Vector3(to[0], 0.28, to[2]),
            dir: new THREE.Vector3(0, -1, 0), // drops into the GPU
          },
        })
      }
    }

    return { lanes, taps }
  }, [clusterTopo, layout, selectedServer])

  if (!showRails || !clusterTopo || lanes.length === 0) return null

  return (
    <group>
      {lanes.map((lane) => (
        <group key={lane.rail}>
          <Line
            points={[
              [lane.x, 0.02, lane.zMin] as Vec3,
              [lane.x, 0.02, lane.zMax] as Vec3,
            ]}
            color={lane.color}
            lineWidth={lane.width}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
          {/* Direct label at the near (camera-side) end — no legend needed. */}
          <Text
            position={[lane.x + 0.12, 0.02, lane.zMax + 0.35]}
            rotation={[-Math.PI / 2, 0, Math.PI / 2]}
            fontSize={0.32}
            color={lane.color}
            anchorX="left"
            anchorY="middle"
          >
            {`rail ${lane.rail} · ${lane.channels}ch`}
          </Text>
        </group>
      ))}

      {taps.map((tap) => (
        <group key={tap.key}>
          <Line
            points={tap.points}
            color={tap.color}
            lineWidth={1.2}
            transparent
            opacity={0.6}
            toneMapped={false}
          />
          {tap.arrowAt && (
            <mesh
              position={tap.arrowAt.pos}
              quaternion={new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                tap.arrowAt.dir,
              )}
            >
              <coneGeometry args={[0.08, 0.2, 8]} />
              <meshBasicMaterial color={tap.color} toneMapped={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}
