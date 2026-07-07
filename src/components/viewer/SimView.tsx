// =============================================================================
// SimView — the value-level ring AllReduce player, scoreboard-row layout
//
// GPUs sit in a flat left-to-right row of live buffer panels (4×4 int16 cells
// = the "16 lanes"). The two ring channels are horizontal CONVEYOR LANES:
// channel 0 above the row flowing right, channel 1 below flowing left —
// counter-rotation made literal. Wrap-around hops ride an explicit loop at
// the row's edge, closing the ring visually. Frames travel along their lane
// carrying payload + LL128 origin flag; on arrival, receiving cells flash and
// update (ADD during reduce-scatter, copy during all-gather).
//
// Scaling story: 8 GPUs is the same row; 64 GPUs becomes 8 server-groups of
// 8 in the same grammar, with inter-group hops riding the cluster rail lanes.
// =============================================================================

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, Edges, Line } from '@react-three/drei'
import * as THREE from 'three'
import { DoubleSide } from 'three'
import { useSimStore } from '../../store/sim-store'
import { buffersAtStep, originsOf } from '../../sim/allreduce'
import type { AllReduceFrame } from '../../sim/allreduce'
import { channelColors } from '../../utils/colors'

const SPACING = 3.1
const PANEL_W = 2.3
const PANEL_H = 2.9
const CELL = 0.46
const PANEL_Y = 1.75 // panel center; top edge 3.2, bottom edge 0.3
const LANE_TOP_Y = 3.85 // channel 0 lane (flows right)
const LANE_BOT_Y = -0.55 // channel 1 lane (flows left)
const WRAP_PAD = 1.5 // horizontal overshoot past the row ends
const WRAP_LIFT = 0.95 // wrap loop's vertical offset away from the row

type Vec3 = [number, number, number]

function xOf(rank: number, n: number): number {
  return (rank - (n - 1) / 2) * SPACING
}

function laneY(channel: number): number {
  return channel === 0 ? LANE_TOP_Y : LANE_BOT_Y
}

/** +1 = flows right (ch0), -1 = flows left (ch1). */
function flowDir(channel: number): number {
  return channel === 0 ? 1 : -1
}

function fmtFlag(mask: bigint, nRanks: number): string {
  return `{${originsOf(mask, nRanks).join(',')}}`
}

/** Lerp a point along a polyline by arc length, t ∈ [0,1]. */
function pointAlong(pts: Vec3[], t: number): THREE.Vector3 {
  const vs = pts.map((p) => new THREE.Vector3(...p))
  let total = 0
  const lens: number[] = []
  for (let i = 1; i < vs.length; i++) {
    const l = vs[i].distanceTo(vs[i - 1])
    lens.push(l)
    total += l
  }
  let d = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < vs.length; i++) {
    if (d <= lens[i - 1] || i === vs.length - 1) {
      return vs[i - 1].clone().lerp(vs[i], lens[i - 1] === 0 ? 0 : d / lens[i - 1])
    }
    d -= lens[i - 1]
  }
  return vs[vs.length - 1]
}

/** The travel path for one frame: along its lane; wraps ride the edge loop. */
function framePath(frame: AllReduceFrame, nRanks: number): Vec3[] {
  const y = laneY(frame.channel)
  const dir = flowDir(frame.channel)
  const x0 = xOf(frame.fromRank, nRanks)
  const x1 = xOf(frame.toRank, nRanks)
  const wrap = dir > 0 ? x1 < x0 : x1 > x0
  if (!wrap) return [[x0, y, 0], [x1, y, 0]]

  const lift = frame.channel === 0 ? y + WRAP_LIFT : y - WRAP_LIFT
  const outEdge = dir > 0 ? xOf(nRanks - 1, nRanks) + WRAP_PAD : xOf(0, nRanks) - WRAP_PAD
  const inEdge = dir > 0 ? xOf(0, nRanks) - WRAP_PAD : xOf(nRanks - 1, nRanks) + WRAP_PAD
  return [
    [x0, y, 0],
    [outEdge, y, 0],
    [outEdge, lift, 0],
    [inEdge, lift, 0],
    [inEdge, y, 0],
    [x1, y, 0],
  ]
}

// ─── One GPU panel: title, 4×4 live cells, last-received lines ──────────────

interface GpuPanelProps {
  rank: number
  nRanks: number
  buffer: number[]
  landed: AllReduceFrame[]
  phase: 'reduce-scatter' | 'all-gather' | null
}

function GpuPanel({ rank, nRanks, buffer, landed, phase }: GpuPanelProps) {
  const changed = useMemo(() => {
    const set = new Set<number>()
    for (const f of landed) {
      for (let e = 0; e < f.elemCount; e++) set.add(f.elemOffset + e)
    }
    return set
  }, [landed])

  return (
    <group position={[xOf(rank, nRanks), PANEL_Y, 0]}>
      <Billboard>
        <mesh>
          <planeGeometry args={[PANEL_W, PANEL_H]} />
          <meshStandardMaterial color="#0d0d14" side={DoubleSide} />
          <Edges color="#00ffff" threshold={15} />
        </mesh>

        <Text position={[0, PANEL_H / 2 - 0.24, 0.01]} fontSize={0.24} color="#00ffff" anchorX="center">
          {`GPU ${rank}`}
        </Text>

        {/* 4×4 cell grid — 16 lanes, borders tinted by owning channel */}
        {buffer.map((v, e) => {
          const row = Math.floor(e / 4)
          const col = e % 4
          const x = (col - 1.5) * CELL
          const y = PANEL_H / 2 - 0.78 - row * CELL
          const channel = e < buffer.length / 2 ? 0 : 1
          const hot = changed.has(e)
          const hotColor = phase === 'all-gather' ? '#00ff88' : '#ffcc00'
          return (
            <group key={e} position={[x, y, 0.01]}>
              <mesh>
                <planeGeometry args={[CELL - 0.06, CELL - 0.06]} />
                <meshStandardMaterial
                  color={hot ? '#1c1c10' : '#12121a'}
                  emissive={hot ? hotColor : channelColors[channel]}
                  emissiveIntensity={hot ? 0.32 : 0.05}
                  side={DoubleSide}
                />
                <Edges color={hot ? hotColor : channelColors[channel]} threshold={15} />
              </mesh>
              <Text position={[0, 0, 0.01]} fontSize={0.15} color={hot ? hotColor : '#d0d0e0'} anchorX="center" anchorY="middle">
                {String(v)}
              </Text>
            </group>
          )
        })}

        {/* Last-received lines (the per-GPU "tcpdump") */}
        {landed.map((f, i) => (
          <Text
            key={i}
            position={[0, -PANEL_H / 2 + 0.42 - i * 0.22, 0.01]}
            fontSize={0.13}
            color={channelColors[f.channel]}
            anchorX="center"
          >
            {`ch${f.channel} ←G${f.fromRank}  [${f.payload.join(',')}] ${fmtFlag(f.origins, nRanks)} ${f.phase === 'reduce-scatter' ? '+ADD' : 'copy'}`}
          </Text>
        ))}
      </Billboard>
    </group>
  )
}

// ─── Conveyor lane: main line, wrap loop, taps, flow arrows, label ───────────

function Lane({ channel, nRanks }: { channel: number; nRanks: number }) {
  const y = laneY(channel)
  const dir = flowDir(channel)
  const color = channelColors[channel]
  const xL = xOf(0, nRanks) - WRAP_PAD
  const xR = xOf(nRanks - 1, nRanks) + WRAP_PAD
  const lift = channel === 0 ? y + WRAP_LIFT : y - WRAP_LIFT

  // Wrap loop: downstream edge → lifted return leg → upstream edge.
  const wrapPts: Vec3[] =
    dir > 0
      ? [[xR, y, 0], [xR, lift, 0], [xL, lift, 0], [xL, y, 0]]
      : [[xL, y, 0], [xL, lift, 0], [xR, lift, 0], [xR, y, 0]]

  // Taps: each GPU connects to its lane (rail-lane grammar).
  const panelEdgeY = channel === 0 ? PANEL_Y + PANEL_H / 2 : PANEL_Y - PANEL_H / 2
  const arrowXs = [-SPACING * 1.5 + SPACING * 0.5, SPACING * 0.5] // between panels

  return (
    <group>
      <Line points={[[xL, y, 0] as Vec3, [xR, y, 0] as Vec3]} color={color} lineWidth={2.2} transparent opacity={0.75} toneMapped={false} />
      <Line points={wrapPts} color={color} lineWidth={1.4} transparent opacity={0.45} dashed dashSize={0.18} gapSize={0.1} toneMapped={false} />
      {Array.from({ length: nRanks }, (_, r) => (
        <Line
          key={r}
          points={[[xOf(r, nRanks), panelEdgeY, 0] as Vec3, [xOf(r, nRanks), y, 0] as Vec3]}
          color={color}
          lineWidth={1}
          transparent
          opacity={0.3}
          toneMapped={false}
        />
      ))}
      {arrowXs.map((x, i) => (
        <mesh key={i} position={[x, y, 0]} rotation={[0, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2]}>
          <coneGeometry args={[0.09, 0.26, 8]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
      <Text position={[dir > 0 ? xL - 0.25 : xR + 0.25, y, 0]} fontSize={0.2} color={color} anchorX={dir > 0 ? 'right' : 'left'} anchorY="middle">
        {`ch${channel} ${dir > 0 ? '→' : '←'}`}
      </Text>
    </group>
  )
}

// ─── A frame in flight along its lane ────────────────────────────────────────

interface PulseProps {
  frame: AllReduceFrame
  nRanks: number
  progressRef: React.MutableRefObject<number>
}

function Pulse({ frame, nRanks, progressRef }: PulseProps) {
  const group = useRef<THREE.Group>(null)
  const path = useMemo(() => framePath(frame, nRanks), [frame, nRanks])
  const labelAbove = frame.channel === 0

  useFrame(() => {
    if (!group.current) return
    group.current.position.copy(pointAlong(path, progressRef.current))
  })

  const color = channelColors[frame.channel]
  return (
    <group ref={group}>
      <mesh>
        <planeGeometry args={[0.34, 0.2]} />
        <meshStandardMaterial color="#0a0a0f" emissive={color} emissiveIntensity={0.9} side={DoubleSide} />
      </mesh>
      <Billboard position={[0, labelAbove ? 0.42 : -0.42, 0]}>
        <Text position={[0, 0.08, 0]} fontSize={0.16} color={color} anchorX="center">
          {`[${frame.payload.join(',')}]`}
        </Text>
        <Text position={[0, -0.12, 0]} fontSize={0.11} color="#99a" anchorX="center">
          {`flag ${fmtFlag(frame.origins, nRanks)}`}
        </Text>
      </Billboard>
    </group>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function SimView() {
  const trace = useSimStore((s) => s.trace)
  const step = useSimStore((s) => s.step)
  const playing = useSimStore((s) => s.playing)
  const msPerStep = useSimStore((s) => s.msPerStep)
  const advance = useSimStore((s) => s.advance)
  const loadToy = useSimStore((s) => s.loadToy)

  useEffect(() => {
    if (!trace) loadToy()
  }, [trace, loadToy])

  // Playback driver: animate pending frames 0→1, then land them.
  const progressRef = useRef(0)
  useFrame((_, delta) => {
    if (!playing) {
      progressRef.current = 0.45 // paused: pending frames hover mid-lane
      return
    }
    progressRef.current += (delta * 1000) / msPerStep
    if (progressRef.current >= 1) {
      progressRef.current = 0
      advance()
    }
  })

  const buffers = useMemo(() => (trace ? buffersAtStep(trace, step) : []), [trace, step])

  if (!trace) return null

  const pending = step < trace.totalSteps ? trace.framesByGlobalStep[step] : []
  const applied = step > 0 ? trace.framesByGlobalStep[step - 1] : []
  const phase = pending[0]?.phase ?? applied[0]?.phase ?? null
  const phaseStep = pending[0]?.step ?? applied[0]?.step ?? 0
  const phaseSteps = trace.nRanks - 1
  const done = step >= trace.totalSteps

  return (
    <group>
      {/* Phase banner — above the ch0 wrap loop and its pulse labels */}
      <Billboard position={[0, 6.5, 0]}>
        <Text fontSize={0.4} color={done ? '#00ff88' : phase === 'reduce-scatter' ? '#ffcc00' : '#00ff88'} anchorX="center">
          {done
            ? 'ALLREDUCE COMPLETE — all GPUs hold identical sums'
            : phase === 'reduce-scatter'
              ? `REDUCE-SCATTER · step ${phaseStep + 1}/${phaseSteps} · receivers ADD`
              : `ALL-GATHER · step ${phaseStep + 1}/${phaseSteps} · receivers copy`}
        </Text>
        <Text position={[0, -0.4, 0]} fontSize={0.16} color="#667" anchorX="center">
          {`sum check: lane e = 100 + 4·e  ·  flag = LL128 origin bitmask (full at 64 GPUs)`}
        </Text>
      </Billboard>

      {/* Conveyor lanes — counter-rotation as two visible belts */}
      <Lane channel={0} nRanks={trace.nRanks} />
      <Lane channel={1} nRanks={trace.nRanks} />

      {/* GPU scoreboard row */}
      {buffers.map((buf, rank) => (
        <GpuPanel
          key={rank}
          rank={rank}
          nRanks={trace.nRanks}
          buffer={buf}
          landed={applied.filter((f) => f.toRank === rank)}
          phase={phase}
        />
      ))}

      {/* Frames in flight */}
      {pending.map((f, i) => (
        <Pulse key={`${step}-${i}`} frame={f} nRanks={trace.nRanks} progressRef={progressRef} />
      ))}
    </group>
  )
}
