// =============================================================================
// BuildView — watch the ring search construct the rings, hop by hop
//
// Replays the RingBuildTrace on the physical single-server layout: rings grow
// arc by arc as the search hops, candidate GPUs are haloed with their L3
// tiebreaker rank when the search is choosing, dead ends retract on
// backtrack, and each closure snaps a ring shut. Completed rings dim into
// context; DupChannels doubles them at the end.
//
// RING-SLOT REORDERING: as the search claims a GPU, its tile SLIDES into the
// next slot of the row — the row incrementally becomes the ring order, and at
// closure the "weird" sequence reads as a clean left-to-right chain with one
// wrap arc. Each new channel reshuffles from the previous ring's order. This
// is the answer to "why is the ring order weird?" — you watch it happen, and
// then the row itself becomes the answer.
// =============================================================================

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, Edges, Line } from '@react-three/drei'
import * as THREE from 'three'
import { DoubleSide } from 'three'
import { useBuildStore } from '../../store/build-store'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useLayout } from '../../hooks/useLayout'
import { buildStateAt } from '../../engine/ring-build-trace'
import { NodeType } from '../../engine/types'
import { channelColors } from '../../utils/colors'

type Vec3 = [number, number, number]

/** Quadratic arc between two ground positions, arched in Y, staggered per channel. */
function arc(from: Vec3, to: Vec3, lift: number, segments = 20): Vec3[] {
  const mx = (from[0] + to[0]) / 2
  const mz = (from[2] + to[2]) / 2
  const pts: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const it = 1 - t
    pts.push([
      it * it * from[0] + 2 * it * t * mx + t * t * to[0],
      Math.sin(t * Math.PI) * lift + 0.03,
      it * it * from[2] + 2 * it * t * mz + t * t * to[2],
    ])
  }
  return pts
}

const SLOT_SPACING = 1.35
const SLIDE_SPEED = 6 // lerp factor per second

/** One GPU tile that slides toward its current ring slot. */
function GpuTile({
  label,
  target,
  isCurrent,
  isChosen,
  rank,
}: {
  label: string
  target: Vec3
  isCurrent: boolean
  isChosen: boolean
  rank: number | undefined
}) {
  const group = useRef<THREE.Group>(null)
  const pos = useRef(new THREE.Vector3(...target))

  useFrame((_, delta) => {
    if (!group.current) return
    pos.current.lerp(new THREE.Vector3(...target), Math.min(1, SLIDE_SPEED * delta))
    group.current.position.copy(pos.current)
  })

  return (
    <group ref={group} position={target}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.6, 0.6]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={isCurrent ? '#ffcc00' : isChosen ? '#00ff88' : '#00ffff'}
          emissiveIntensity={isCurrent ? 0.5 : isChosen ? 0.35 : 0.08}
          side={DoubleSide}
        />
        <Edges color={isCurrent ? '#ffcc00' : isChosen ? '#00ff88' : '#00ffff'} threshold={15} />
      </mesh>
      <Text position={[0, 0.42, 0]} fontSize={0.16} color="#9fd" anchorX="center">
        {label}
      </Text>
      {rank !== undefined && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[0.42, 0.5, 24]} />
            <meshBasicMaterial color={rank === 0 ? '#00ff88' : '#8888aa'} transparent opacity={0.8} />
          </mesh>
          <Billboard position={[0.45, 0.5, 0]}>
            <Text fontSize={0.14} color={rank === 0 ? '#00ff88' : '#8888aa'} anchorX="center">
              {`#${rank + 1}`}
            </Text>
          </Billboard>
        </>
      )}
    </group>
  )
}

export function BuildView() {
  const system = useTopologyStore((s) => s.system)
  const ringBuildTrace = useTopologyStore((s) => s.ringBuildTrace)
  const trace = useBuildStore((s) => s.trace)
  const idx = useBuildStore((s) => s.idx)
  const playing = useBuildStore((s) => s.playing)
  const msPerEvent = useBuildStore((s) => s.msPerEvent)
  const advance = useBuildStore((s) => s.advance)
  const setTrace = useBuildStore((s) => s.setTrace)
  const layout = useLayout(system)

  // Adopt the topology's trace when it changes (fresh Generate).
  useEffect(() => {
    if (ringBuildTrace !== trace) setTrace(ringBuildTrace)
  }, [ringBuildTrace]) // eslint-disable-line react-hooks/exhaustive-deps

  // Playback driver.
  const accum = useRef(0)
  useFrame((_, delta) => {
    if (!playing) return
    accum.current += delta * 1000
    if (accum.current >= msPerEvent) {
      accum.current = 0
      advance()
    }
  })

  const state = useMemo(
    () => (trace ? buildStateAt(trace, idx) : null),
    [trace, idx],
  )

  const gpus = useMemo(() => system?.nodesByType.get(NodeType.GPU) ?? [], [system])
  const nvs = useMemo(() => system?.nodesByType.get(NodeType.NVS) ?? [], [system])

  if (!system || !trace || !state) {
    return (
      <Text position={[0, 1, 0]} fontSize={0.3} color="#888899" anchorX="center" maxWidth={10}>
        No build trace — select a template and click Generate Topology.
      </Text>
    )
  }

  const candidateRank = new Map<string, number>()
  if (state.lastConsider) {
    for (const c of state.lastConsider.candidates) candidateRank.set(c.id, c.rank)
  }

  // ── Ring-slot display order ────────────────────────────────────────────────
  // The current channel's partial ring occupies the left slots (in ring
  // order); everyone else keeps the previous ordering (the last closed ring,
  // else the physical layout order). Tiles slide as membership changes, so by
  // closure the row *is* the ring order.
  // Baseline row = numeric order (GPU0..GPU7) — the viewer's mental model.
  // Every departure from it is then visibly the SEARCH's doing. (The physical
  // PCIe grouping belongs to the Physical view, which actually draws it.)
  const physical = [...gpus].sort((a, b) => a.index - b.index).map((g) => g.id)
  let lastClosed = -1
  for (const ch of state.closed) if (ch > lastClosed) lastClosed = ch
  const partial =
    state.currentChannel !== null
      ? state.rings.get(state.currentChannel) ?? []
      : lastClosed >= 0
        ? state.rings.get(lastClosed) ?? []
        : []
  const baseOrder =
    lastClosed >= 0 && lastClosed !== state.currentChannel
      ? state.rings.get(lastClosed) ?? physical
      : physical
  const inPartial = new Set(partial)
  const rest = baseOrder.filter((id) => !inPartial.has(id))
  const missing = physical.filter((id) => !inPartial.has(id) && !rest.includes(id))
  const displayOrder = [...partial, ...rest, ...missing]

  const rowZ = layout.nodePositions.get(gpus[0]?.id ?? '')?.[2] ?? 0
  const slotPos = (i: number): Vec3 => [
    (i - (displayOrder.length - 1) / 2) * SLOT_SPACING,
    0.02,
    rowZ,
  ]
  const posOf = new Map<string, Vec3>()
  displayOrder.forEach((id, i) => posOf.set(id, slotPos(i)))

  return (
    <group>
      {/* GPUs — tiles slide into their ring slots */}
      {gpus.map((gpu) => (
        <GpuTile
          key={gpu.id}
          label={gpu.label ?? gpu.id}
          target={posOf.get(gpu.id) ?? [0, 0.02, rowZ]}
          isCurrent={state.currentGpu === gpu.id}
          isChosen={state.lastConsider?.chosen === gpu.id}
          rank={candidateRank.get(gpu.id)}
        />
      ))}

      {/* NVS (context) */}
      {nvs.map((n) => {
        const pos = layout.nodePositions.get(n.id)
        if (!pos) return null
        return (
          <group key={n.id} position={[pos[0], 0.02, pos[2]]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.4, 24]} />
              <meshStandardMaterial color="#0a0a0f" emissive="#665500" emissiveIntensity={0.2} side={DoubleSide} />
              <Edges color="#aa8800" threshold={15} />
            </mesh>
            <Text position={[0, 0.35, 0]} fontSize={0.14} color="#aa8800" anchorX="center">
              {n.label ?? n.id}
            </Text>
          </group>
        )
      })}

      {/* Rings: in-progress bold, completed dimmed into context */}
      {[...state.rings.entries()].map(([channel, order]) => {
        const color = channelColors[channel % channelColors.length]
        const isCurrent = channel === state.currentChannel && !state.closed.has(channel)
        const lift = 0.55 + (channel % 6) * 0.22
        const segs: { key: string; pts: Vec3[] }[] = []
        for (let i = 0; i < order.length - 1; i++) {
          const a = posOf.get(order[i])
          const b = posOf.get(order[i + 1])
          if (a && b) segs.push({ key: `${channel}-${i}`, pts: arc(a, b, lift) })
        }
        if (state.closed.has(channel) && order.length > 1) {
          const a = posOf.get(order[order.length - 1])
          const b = posOf.get(order[0])
          if (a && b) segs.push({ key: `${channel}-close`, pts: arc(a, b, lift + 0.35) })
        }
        return (
          <group key={channel}>
            {segs.map((s) => (
              <Line
                key={s.key}
                points={s.pts}
                color={color}
                lineWidth={isCurrent ? 2.6 : 1.2}
                transparent
                opacity={isCurrent ? 0.95 : state.closed.has(channel) ? 0.16 : 0.6}
                toneMapped={false}
              />
            ))}
          </group>
        )
      })}
    </group>
  )
}
