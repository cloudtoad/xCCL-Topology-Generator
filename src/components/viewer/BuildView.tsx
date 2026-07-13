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
import { NodeType, PathType } from '../../engine/types'
import { channelColors, linkInkWidth } from '../../utils/colors'
import { PATH_TYPE_STR } from '../../engine/log-replay'

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

// Path-class colors for the evaluation web (locality ladder, best → worst).
const PATH_COLORS: Record<number, string> = {
  [PathType.NVL]: '#00ffff',
  [PathType.NVB]: '#66d9ff',
  [PathType.PIX]: '#00ff41',
  [PathType.PXB]: '#aaff00',
  [PathType.PHB]: '#ff9900',
  [PathType.SYS]: '#ff0040',
  [PathType.NET]: '#ff6600',
}

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

/** Fixed NET chip above the GPU row (inter-node search entry/exit points). */
function NetTile({ label, position, active }: { label: string; position: Vec3; active: boolean }) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 0.34]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive="#ff6600"
          emissiveIntensity={active ? 0.55 : 0.1}
          side={DoubleSide}
        />
        <Edges color="#ff6600" threshold={15} />
      </mesh>
      <Text position={[0, 0.3, 0]} fontSize={0.13} color={active ? '#ffaa66' : '#885533'} anchorX="center">
        {label}
      </Text>
    </group>
  )
}

export function BuildView() {
  const displaySystem = useTopologyStore((s) => s.system)
  const buildSystem = useTopologyStore((s) => s.buildSystem)
  const system = buildSystem ?? displaySystem
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
  const nets = useMemo(() => system?.nodesByType.get(NodeType.NET) ?? [], [system])

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

  // NET chips: fixed row behind the GPU slots (inter-node search only).
  const netPosOf = new Map<string, Vec3>()
  nets.forEach((n, i) => {
    netPosOf.set(n.id, [(i - (nets.length - 1) / 2) * SLOT_SPACING, 0.02, rowZ - 3.0])
  })

  // NVS: below the GPU row, centered — the backplane the NVLink spokes
  // converge on (NICs above, GPUs middle, switch fabric beneath).
  const nvsPosOf = new Map<string, Vec3>()
  nvs.forEach((n, i) => {
    nvsPosOf.set(n.id, [(i - (nvs.length - 1) / 2) * 1.4, 0.02, rowZ + 2.2])
  })
  const currentNetIn =
    state.currentChannel !== null ? state.netIn.get(state.currentChannel) : undefined
  const currentNetOut =
    state.currentChannel !== null ? state.netOut.get(state.currentChannel) : undefined

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

      {/* NVS (context) — beneath the GPU row */}
      {nvs.map((n) => {
        const pos = nvsPosOf.get(n.id)
        if (!pos) return null
        return (
          <group key={n.id} position={pos}>
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

      {/* Evaluation web: while the ladder searches (no construction yet),
          show every path ELIGIBLE under the current attempt's constraints —
          color = path class, ink width = bandwidth. Each fired rung visibly
          grows the road network. */}
      {state.currentChannel === null && state.rings.size === 0 && state.lastAttempt && (() => {
        const a = state.lastAttempt
        // Waypoints may ONLY be nodes this view actually renders: GPU slots,
        // NET chips, and the NVS. PCI switches / NICs exist in the path hops
        // but have no tile here — routing through their physical-layout
        // coordinates would send lines to phantom positions off the stage.
        const nvsIds = new Set(nvs.map((x) => x.id))
        const wpPos = (id: string): Vec3 | undefined => {
          const slot = posOf.get(id) ?? netPosOf.get(id)
          if (slot) return slot
          if (nvsIds.has(id)) return nvsPosOf.get(id)
          return undefined
        }
        // One pair = ONE path (SPFA chose it at the paths stage). Route each
        // eligible pair's path through its real waypoints, then DEDUPE into
        // physical segments — 28 NVLink pairs collapse onto 8 GPU↔NVS spokes,
        // which is the physical truth of an NVSwitch fabric.
        const segs = new Map<string, { from: Vec3; to: Vec3; color: string; bw: number }>()
        let pairCount = 0
        const addPath = (fromId: string, toId: string, maxType: number) => {
          const path = system.paths.get(`${fromId}->${toId}`)
          if (!path || path.type > maxType || path.bandwidth < a.speed) return
          pairCount++
          const waypoints = [fromId, ...path.hops.map((h) => h.nodeId)]
            .filter((id, i, arr) => arr.indexOf(id) === i)
            .map((id) => ({ id, pos: wpPos(id) }))
            .filter((w): w is { id: string; pos: Vec3 } => !!w.pos)
          for (let k = 0; k < waypoints.length - 1; k++) {
            const [x, y] = [waypoints[k], waypoints[k + 1]]
            const key = [x.id, y.id].sort().join('>')
            if (!segs.has(key)) {
              segs.set(key, {
                from: x.pos, to: y.pos,
                color: PATH_COLORS[path.type] ?? '#8888aa', bw: path.bandwidth,
              })
            }
          }
        }
        for (let i = 0; i < gpus.length; i++) {
          for (let j = i + 1; j < gpus.length; j++) addPath(gpus[i].id, gpus[j].id, a.typeIntra)
        }
        if (system.inter) {
          for (const gpu of gpus) for (const net of nets) addPath(gpu.id, net.id, a.typeInter)
        }
        return (
          <group>
            {[...segs.entries()].map(([key, w]) => (
              <Line
                key={key}
                points={arc(w.from, w.to, 0.22)}
                color={w.color}
                lineWidth={linkInkWidth(w.bw) * 0.6}
                transparent
                opacity={0.32}
                toneMapped={false}
              />
            ))}
            <Billboard position={[1.2, 3.9, rowZ]}>
              <Text fontSize={0.24} color="#8899aa" anchorX="center">
                {`attempt ${a.n}: ${pairCount} eligible pairs over ${segs.size} physical segments (speed ≥ ${a.speed}, typeIntra ≤ ${PATH_TYPE_STR[a.typeIntra] ?? a.typeIntra}${system.inter ? `, typeInter ≤ ${PATH_TYPE_STR[a.typeInter] ?? a.typeInter}` : ''})`}
              </Text>
              <Text position={[0, -0.34, 0]} fontSize={0.17} color="#556677" anchorX="center">
                one pair = one path, fixed by SPFA at the paths stage — the search picks node ORDERS over these roads, never alternate routes between a pair
              </Text>
            </Billboard>
          </group>
        )
      })()}

      {/* NET chips (inter-node search entry/exit points) */}
      {nets.map((n) => (
        <NetTile
          key={n.id}
          label={n.label ?? n.id}
          position={netPosOf.get(n.id)!}
          active={n.id === currentNetIn || n.id === currentNetOut}
        />
      ))}

      {/* Candidate comparison: when the search is choosing the next hop,
          draw each candidate's (single, SPFA-fixed) path from the current
          GPU — green = winner, gray = losers — and say WHY it won. */}
      {state.lastConsider && (() => {
        const c = state.lastConsider
        const from = posOf.get(c.from)
        if (!from) return null
        const sorted = [...c.candidates].sort((x, y) => x.rank - y.rank)
        let why = 'only feasible candidate'
        if (sorted.length > 1) {
          const [c0, c1] = sorted
          why =
            c0.intraBw !== c1.intraBw
              ? `higher path bw (${c0.intraBw.toFixed(0)} vs ${c1.intraBw.toFixed(0)} GB/s)`
              : c0.intraNhops !== c1.intraNhops
                ? `fewer hops (${c0.intraNhops} vs ${c1.intraNhops})`
                : 'all tied on bw and hops → lowest index wins (search.cc:211)'
        }
        return (
          <group>
            {sorted.map((cand) => {
              const to = posOf.get(cand.id)
              if (!to) return null
              const isChosen = cand.id === c.chosen
              return (
                <Line
                  key={`cand-${cand.id}`}
                  points={arc(from, to, 0.45)}
                  color={isChosen ? '#00ff88' : '#667788'}
                  lineWidth={isChosen ? 2.2 : 1}
                  transparent
                  opacity={isChosen ? 0.9 : 0.35}
                  dashed={!isChosen}
                  dashSize={0.12}
                  gapSize={0.08}
                  toneMapped={false}
                />
              )
            })}
            <Billboard position={[0, 3.3, rowZ]}>
              <Text fontSize={0.2} color="#00ff88" anchorX="center">
                {`next hop from ${c.from.replace('gpu-', 'GPU ')}: ${sorted.length} candidate${sorted.length === 1 ? '' : 's'} — ${c.chosen.replace('gpu-', 'GPU ')} wins: ${why}`}
              </Text>
            </Billboard>
          </group>
        )
      })()}

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
        // Inter-node ring: entry arc NET → first GPU; exit arc last GPU → NET
        // at closure. Intra ring: wrap arc last → first at closure.
        const chNetIn = state.netIn.get(channel)
        const chNetOut = state.netOut.get(channel)
        if (chNetIn && order.length > 0) {
          const a = netPosOf.get(chNetIn)
          const b = posOf.get(order[0])
          if (a && b) segs.push({ key: `${channel}-netin`, pts: arc(a, b, lift * 0.7) })
        }
        if (state.closed.has(channel) && order.length > 1) {
          const last = posOf.get(order[order.length - 1])
          if (chNetOut) {
            const netP = netPosOf.get(chNetOut)
            if (last && netP) segs.push({ key: `${channel}-netout`, pts: arc(last, netP, lift * 0.7) })
          } else {
            const first = posOf.get(order[0])
            if (last && first) segs.push({ key: `${channel}-close`, pts: arc(last, first, lift + 0.35) })
          }
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
