// =============================================================================
// Cluster rail/QP overlay (free-look)
//
// Draws the inter-node edges of the TRUE channel rings: each channel is one
// ring over every GPU (intra chain per server via NVLink), and its network
// hops — exit GPU of server s → entry GPU of server s+1 — are drawn as arcs
// colored by the rail they ride. Each arc is a network connection carrying
// one or more Queue Pairs; arrowheads point the direction data flows.
// Identical hops from multiple channels on the same rail are drawn once.
// Physical NIC→switch links are drawn by InstancedClusterView underneath;
// this overlay is the *logical* transport view.
// =============================================================================

import { useMemo } from 'react'
import * as THREE from 'three'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'

const UP = new THREE.Vector3(0, 1, 0)

/** Distinct, saturated color per rail. */
function railColor(rail: number, railCount: number): string {
  const hue = (rail / Math.max(1, railCount)) * 360
  return `hsl(${hue}, 90%, 60%)`
}

/** Sample a quadratic bezier arc (raised in Y) between two ground points. */
function arcPoints(
  from: [number, number, number],
  to: [number, number, number],
  segments = 24,
): { line: Float32Array; tip: THREE.Vector3; dir: THREE.Vector3 } {
  const p0 = new THREE.Vector3(...from)
  const p1 = new THREE.Vector3(...to)
  const dist = p0.distanceTo(p1)
  const mid = p0.clone().add(p1).multiplyScalar(0.5)
  mid.y += Math.min(dist * 0.28, 3.2) // gentle arch, capped
  const c = mid

  const pts = new Float32Array((segments + 1) * 3)
  let prev = p0.clone()
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const it = 1 - t
    const x = it * it * p0.x + 2 * it * t * c.x + t * t * p1.x
    const y = it * it * p0.y + 2 * it * t * c.y + t * t * p1.y
    const z = it * it * p0.z + 2 * it * t * c.z + t * t * p1.z
    pts[i * 3] = x
    pts[i * 3 + 1] = y
    pts[i * 3 + 2] = z
    if (i === segments) prev = new THREE.Vector3(x, y, z)
  }
  // direction at the tip (from a point just before the end)
  const nearEndT = (segments - 1) / segments
  const et = 1 - nearEndT
  const near = new THREE.Vector3(
    et * et * p0.x + 2 * et * nearEndT * c.x + nearEndT * nearEndT * p1.x,
    et * et * p0.y + 2 * et * nearEndT * c.y + nearEndT * nearEndT * p1.y,
    et * et * p0.z + 2 * et * nearEndT * c.z + nearEndT * nearEndT * p1.z,
  )
  const dir = prev.clone().sub(near).normalize()
  return { line: pts, tip: prev, dir }
}

interface HopArcProps {
  from: [number, number, number]
  to: [number, number, number]
  color: string
}

function HopArc({ from, to, color }: HopArcProps) {
  const { line, tip, dir } = useMemo(() => arcPoints(from, to), [from, to])
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, dir), [dir])
  // Pull the cone back slightly along the arc so it sits at the GPU, not inside it.
  const conePos = useMemo(() => tip.clone().addScaledVector(dir, -0.15), [tip, dir])

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </line>
      <mesh position={conePos} quaternion={quat}>
        <coneGeometry args={[0.12, 0.32, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function ClusterRailOverlay() {
  const system = useTopologyStore((s) => s.system)
  const clusterTopo = useTopologyStore((s) => s.clusterTopo)
  const showRails = useUIStore((s) => s.showRails)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const layout = useLayout(system)

  const hops = useMemo(() => {
    if (!clusterTopo) return []
    const seen = new Set<string>()
    const out: { key: string; from: [number, number, number]; to: [number, number, number]; color: string }[] = []
    for (const ch of clusterTopo.channels) {
      const color = railColor(ch.rail, clusterTopo.railCount)
      for (const hop of ch.hops) {
        // Channels sharing a rail + intra order produce identical edges — draw once.
        const key = `${hop.fromId}>${hop.toId}|${hop.rail}`
        if (seen.has(key)) continue
        seen.add(key)

        const from = layout.nodePositions.get(hop.fromId)
        const to = layout.nodePositions.get(hop.toId)
        if (!from || !to) continue
        // When a server is selected, only show hops that touch it.
        if (selectedServer !== null) {
          const touches = hop.fromId.startsWith(`s${selectedServer}-`) || hop.toId.startsWith(`s${selectedServer}-`)
          if (!touches) continue
        }
        out.push({ key, from, to, color })
      }
    }
    return out
  }, [clusterTopo, layout, selectedServer])

  if (!showRails || !clusterTopo || hops.length === 0) return null

  return (
    <group>
      {hops.map((h) => (
        <HopArc key={h.key} from={h.from} to={h.to} color={h.color} />
      ))}
    </group>
  )
}
