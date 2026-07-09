// =============================================================================
// NcclInitFig — NCCL init on the same 2×2 box grammar as PreInitFig.
//
// Picks up exactly where PreInitFig's final frame left off: sixteen ranks,
// GPUs bound, id chips everywhere, root listening on box 0. Two phases:
//
//   'ring'   (bootstrap-ring beat): ranks check in (shuffled order), the root
//            forwards successor addresses, and the TCP ring materializes —
//            threading the boxes in RANK ORDER, adjacency by arithmetic.
//   'gather' (allgather1 beat): ncclPeerInfo circulates the ring; per-box
//            peer counters fill in lockstep; hostHash groups emerge and
//            nNodes is discovered; handoff to topology detection.
//
// Geometry constants mirror PreInitFig v2 so the story reads as one film.
// =============================================================================
import { useStepper, stepperLabel } from '../useStepper'

const BW = 218
const BPOS = [
  { x: 16, y: 90 },
  { x: 298, y: 90 },
  { x: 16, y: 400 },
  { x: 298, y: 400 },
]
const SLOT_X = [10, 60, 110, 160]
const SLOT_W = 46
const PROC_Y = 52
const ID_Y = 126
const NIC_Y = 172
const NIC_H = 18
const GPU_Y = 198
const GPU_H = 36

const HOST_COLORS = ['#00ffff', '#ff00ff', '#00ff41', '#ffff00']
const HOST_HASH = ['9c41f0aa', '3e88b1c5', 'd102e7f4', '6b5a09cc']

/** Center of rank r's process square. */
function procC(r: number): { x: number; y: number } {
  const b = BPOS[Math.floor(r / 4)]
  const s = r % 4
  return { x: b.x + SLOT_X[s] + SLOT_W / 2, y: b.y + PROC_Y + 17 }
}

/** Ring edge path r → r+1 (mod 16): intra-box arc or cross-box curve. */
function edgePath(r: number): string {
  const a = procC(r)
  const b = procC((r + 1) % 16)
  if (Math.floor(r / 4) === Math.floor(((r + 1) % 16) / 4)) {
    // intra-box: small arc above the squares
    const my = a.y - 30
    return `M ${a.x} ${a.y - 17} Q ${(a.x + b.x) / 2} ${my} ${b.x} ${b.y - 17}`
  }
  // cross-box transitions: 3→4, 7→8, 11→12, 15→0
  const CTRL: Record<number, [number, number]> = {
    3: [266, 108],   // box0 → box1, over the top gap
    7: [206, 318],   // box1 → box2, diagonal bent left of center
    11: [266, 418],  // box2 → box3, over the bottom gap
    15: [330, 318],  // box3 → box0, diagonal bent right of center
  }
  const [cx, cy] = CTRL[r]
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

// Shuffled check-in batches so "successor unknown — saved for later" happens.
const CHECKIN_BATCHES = [
  [0, 5, 3, 9, 14, 7],
  [1, 2, 11, 8, 15, 4],
  [6, 10, 12, 13],
]

const RING_CAPS = [
  'Where pre-init ended: sixteen ranks hold the same 128 bytes; the root listens on box 0. Every rank dials in.',
  'Check-ins arrive in no particular order. The root forwards each rank its SUCCESSOR’s listen address the moment that successor is known — otherwise it saves the slot for later (bootstrap.cc:361-368).',
  'More check-ins; more edges. An edge r→r+1 lights when rank r has learned where r+1 listens.',
  'All sixteen in: the TCP ring is complete — the first ring NCCL builds, before it knows anything about the hardware.',
  'The root’s job is done; it exits and is never heard from again. Look at the shape: the ring threads the boxes in RANK ORDER — twelve hops stay inside a box, four cross between them. Adjacency is arithmetic, not measured.',
]

const GATHER_CAPS = [
  'Each rank stages its ncclPeerInfo — busId, hostHash, cudaCompCap — and the ring begins to circulate (bootstrapAllGather).',
  'Step 1: every rank forwards to its successor simultaneously. Every rank now knows 2 of 16 peers.',
  'Step 2: forwarded again — the relay. 3 of 16. Nobody talks to the root; nobody dials strangers; slices just walk the ring.',
  '…thirteen more steps… 16 of 16. Version check passes on every rank (init.cc:1042) — the homogeneity assumption, verified after the fact.',
  'hostHash groups emerge: four distinct hashes → nNodes = 4. “My node” is everyone who shares my hash (init.cc:1048) — nobody configured the cluster shape; it was discovered.',
  'AllGather1 complete: every rank knows every peer. Now each rank turns INWARD — ncclTopoGetSystem walks its own silicon. The next module happens sixteen times, independently, in parallel.',
]

function ServerBox({ bi, hostTint, peersKnown, inward }: {
  bi: number
  hostTint: string | null
  peersKnown: number | null
  inward: boolean
}) {
  const { x, y } = BPOS[bi]
  return (
    <g>
      <rect x={x} y={y} width={BW} height={260} rx={8}
        fill="#0e0e16"
        stroke={inward ? '#00ffff' : hostTint ?? '#333344'}
        strokeWidth={hostTint || inward ? 1.5 : 1.2}
      />
      <text x={x + 9} y={y + 15} fill="#555566" fontSize={9}>box {bi}</text>
      {hostTint && (
        <text x={x + BW - 8} y={y + 15} textAnchor="end" fill={hostTint} fontSize={8}>
          hostHash {HOST_HASH[bi]} · node {bi}
        </text>
      )}

      {/* mgmt port — the ring rides it; always glowing in this figure */}
      <circle cx={x + 14} cy={y + 260 + 6} r={4.5} fill="#00ffff" stroke="#00ffff" strokeWidth={0.8} />

      {/* rank process squares */}
      {SLOT_X.map((sx, si) => (
        <g key={si}>
          <rect x={x + sx} y={y + PROC_Y} width={SLOT_W} height={34} rx={3}
            fill="#0d1a12" stroke={hostTint ?? '#00ff88'} strokeWidth={hostTint ? 1.2 : 0.9} />
          <text x={x + sx + SLOT_W / 2} y={y + PROC_Y + 21} textAnchor="middle"
            fill="#557755" fontSize={8}>r{bi * 4 + si}</text>
        </g>
      ))}
      {peersKnown !== null && (
        <text x={x + 9} y={y + PROC_Y + 47} fill="#8899aa" fontSize={7.5}>
          peers known: {peersKnown}/16
        </text>
      )}

      {/* uniqueId chip (inherited from pre-init) */}
      <rect x={x + 8} y={y + ID_Y} width={56} height={14} rx={3}
        fill="#221f00" stroke="#ffff00" strokeWidth={0.9} opacity={0.7} />
      <text x={x + 36} y={y + ID_Y + 10} textAnchor="middle" fill="#ffff00" fontSize={7.5} opacity={0.8}>
        id · 128 B
      </text>

      {/* hardware: NIC/GPU pairs — GPUs bound (lit), backend NICs STILL dark */}
      <line x1={x + 8} y1={y + 163} x2={x + BW - 8} y2={y + 163} stroke="#1e1e2a" strokeWidth={0.7} />
      <text x={x + BW / 2} y={y + 160} textAnchor="middle" fill="#332211" fontSize={6.5}>
        backend NICs — still dark
      </text>
      {SLOT_X.map((sx, si) => (
        <g key={`hw-${si}`}>
          <rect x={x + sx + 2} y={y + NIC_Y} width={SLOT_W - 4} height={NIC_H} rx={2}
            fill="#0c0c14" stroke="#553311" strokeWidth={0.8} />
          <text x={x + sx + SLOT_W / 2} y={y + NIC_Y + 12} textAnchor="middle"
            fill="#553311" fontSize={6.5}>nic{si}</text>
          <line x1={x + sx + SLOT_W / 2} y1={y + NIC_Y + NIC_H} x2={x + sx + SLOT_W / 2} y2={y + GPU_Y}
            stroke={inward ? '#1a4444' : '#14232a'} strokeWidth={0.7} />
          <rect x={x + sx} y={y + GPU_Y} width={SLOT_W} height={GPU_H} rx={3}
            fill={inward ? '#043a3a' : '#032a2a'} stroke="#00ffff" strokeWidth={inward ? 1.4 : 1} />
          <text x={x + sx + SLOT_W / 2} y={y + GPU_Y + GPU_H / 2 + 3} textAnchor="middle"
            fill="#00ffff" fontSize={8.5}>g{si}</text>
        </g>
      ))}
    </g>
  )
}

export function NcclInitFig({ phase }: { phase: 'ring' | 'gather' }) {
  const caps = phase === 'ring' ? RING_CAPS : GATHER_CAPS
  const { step, reset } = useStepper(caps.length - 1, 2100)
  const done = step >= caps.length - 1

  // ring phase state
  const checkedIn = new Set<number>()
  if (phase === 'gather') {
    for (let r = 0; r < 16; r++) checkedIn.add(r)
  } else {
    for (let b = 0; b < Math.min(step, CHECKIN_BATCHES.length); b++) {
      for (const r of CHECKIN_BATCHES[b]) checkedIn.add(r)
    }
  }
  const ringComplete = phase === 'gather' || step >= 3
  const rootGone = phase === 'gather' || step >= 4

  // gather phase state
  const pulsing = phase === 'gather' && step >= 1 && step <= 3 && !done
  const peersKnown =
    phase === 'gather' ? (step === 0 ? 1 : step === 1 ? 2 : step === 2 ? 3 : 16) : null
  const hostTinted = phase === 'gather' && step >= 4
  const inward = phase === 'gather' && step >= 5

  return (
    <div className="font-mono text-[11px]">
      <svg viewBox="0 0 532 690" className="w-full">
        {/* dial-in arrows (ring phase step 0 only) */}
        {phase === 'ring' && step === 0 && [1, 2, 3].map((bi) => {
          const sx = BPOS[bi].x + BW / 2
          const sy = BPOS[bi].y + PROC_Y + 17
          const rx = BPOS[0].x + BW + 2
          const ry = BPOS[0].y + 58
          return (
            <path key={bi}
              d={`M ${sx} ${sy} Q ${(sx + rx) / 2} ${Math.min(sy, ry) - 26} ${rx + 4} ${ry + 4}`}
              fill="none" stroke="#00ff41" strokeWidth={1.2} opacity={0.6} strokeDasharray="5 3" />
          )
        })}

        {/* ring edges */}
        {Array.from({ length: 16 }, (_, r) => {
          const next = (r + 1) % 16
          const lit = checkedIn.has(r) && checkedIn.has(next)
          if (!lit) return null
          return (
            <path key={r} d={edgePath(r)} fill="none"
              stroke="#00ffff"
              strokeWidth={pulsing ? 2 : 1.3}
              opacity={pulsing ? 0.95 : ringComplete ? 0.6 : 0.75}
            />
          )
        })}

        {/* boxes */}
        {[0, 1, 2, 3].map((bi) => (
          <ServerBox key={bi} bi={bi}
            hostTint={hostTinted ? HOST_COLORS[bi] : null}
            peersKnown={peersKnown}
            inward={inward}
          />
        ))}

        {/* check-in state dots (ring phase): a rank glows when it has checked in */}
        {phase === 'ring' && !rootGone && Array.from({ length: 16 }, (_, r) => {
          if (!checkedIn.has(r)) return null
          const p = procC(r)
          return <circle key={r} cx={p.x} cy={p.y - 21} r={2.4} fill="#00ff41" />
        })}

        {/* root listener on box 0 */}
        {!rootGone && (
          <g>
            <circle cx={BPOS[0].x + BW + 2} cy={BPOS[0].y + 58} r={5.5}
              fill="#221400" stroke="#ff6600" strokeWidth={1.5} />
            <text x={BPOS[0].x + BW + 11} y={BPOS[0].y + 54} fill="#ff6600" fontSize={7.5}>root</text>
            <text x={BPOS[0].x + BW + 11} y={BPOS[0].y + 64} fill="#885533" fontSize={7}>:29500</text>
          </g>
        )}

        {/* labels in the top band */}
        <text x={266} y={30} textAnchor="middle" fill="#445566" fontSize={9}>
          {phase === 'ring'
            ? 'bootstrap ring formation — management network only'
            : 'AllGather1 — ncclPeerInfo circulates the socket ring'}
        </text>
        {ringComplete && (
          <text x={266} y={44} textAnchor="middle" fill="#2a3a4a" fontSize={7.5}>
            ring order = rank order: r0→r1→…→r15→r0 · 12 intra-box hops, 4 cross-box
          </text>
        )}
      </svg>

      <div className="flex items-center gap-3 mt-1">
        <button onClick={reset} title={`replay-${phase === 'ring' ? 'bootstrapring' : 'allgather1'}`}
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40">
          ↻ replay
        </button>
        <span className="text-gray-500">step {stepperLabel(step, caps.length - 1)}</span>
      </div>
      <div className={`mt-2 min-h-[3.2em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {caps[Math.min(step, caps.length - 1)]}
      </div>
    </div>
  )
}

export function BootstrapRingBoxFig() {
  return <NcclInitFig phase="ring" />
}

export function AllGather1BoxFig() {
  return <NcclInitFig phase="gather" />
}
