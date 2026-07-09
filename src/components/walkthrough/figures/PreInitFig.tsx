// =============================================================================
// PreInitFig v2 — 2×2 cluster, explicit GPU↔NIC vertical pairing.
//
// Four boxes, four GPUs each; each GPU has its dedicated backend NIC shown
// directly above it with a connector stub. Steps add chips, processes, and env
// vars down one of three launcher tracks. Final frame is identical on every
// track — convergence, drawn.
//
// Deliberate: backend NICs never light. Nothing in pre-init touches the RDMA
// fabric; every byte rides the management network (mgmt port, bottom of box).
// =============================================================================
import { useState } from 'react'
import { useStepper, stepperLabel } from '../useStepper'

type Flag =
  | 'daemons' | 'ctl' | 'fs' | 'registry' | 'batch0' | 'ssh' | 'tree' | 'store'
  | 'procs' | 'identity' | 'gpus' | 'commid' | 'id0' | 'idAll' | 'root' | 'reach'

interface TrackStep { caption: string; adds: Flag[] }
interface Track {
  key: string; label: string; daemonName: string; ctlLabel: string
  identityLine: string
  /** Where the root's address lives in this track (shown once a box holds the id). */
  addrLine?: string
  /** Root listener port label — well-known (srun) vs ephemeral (mpirun/torchrun). */
  rootPort: string
  steps: TrackStep[]
}

const S0 = 'Four boxes, an OS each. GPUs and their dedicated backend NICs: dark silicon.'

const TRACKS: Track[] = [
  {
    key: 'slurm', label: 'srun · shared FS', daemonName: 'slurmd',
    ctlLabel: 'slurmctld', identityLine: 'SLURM_PROCID · LOCALID',
    rootPort: ':29500 well-known',
    steps: [
      { caption: S0, adds: [] },
      { caption: 'The management plane pre-exists the job: slurmd on every box, MUNGE-keyed, always up.', adds: ['daemons', 'ctl'] },
      { caption: 'Code placement: one shared filesystem mounted everywhere — sameness by mount, no copying.', adds: ['fs'] },
      { caption: 'sbatch: the script text travels to the controller; the batch step lands on box 0.', adds: ['batch0'] },
      { caption: 'srun sends step-launch RPCs to every slurmd; slurmstepd forks four tasks per box.', adds: ['procs'] },
      { caption: 'Identity was in the env before main(): SLURM_PROCID/LOCALID; cgroups bind each task to its GPU.', adds: ['identity', 'gpus'] },
      { caption: 'NCCL_COMM_ID was exported at submit — every rank rebuilds the identical handle locally; box 0 binds the well-known port. Zero bytes moved.', adds: ['commid', 'idAll', 'root'] },
      { caption: 'Sixteen ranks, four facts each, all identical. NCCL reaches out to the root — and note: the backend NICs never lit. Everything so far rode the management network.', adds: ['reach'] },
    ],
  },
  {
    key: 'mpirun', label: 'mpirun · ssh', daemonName: 'prted',
    ctlLabel: 'mpirun @ box 0', identityLine: 'MPI_COMM_WORLD rank',
    addrLine: 'id.addr = box0:41387 · ephemeral',
    rootPort: ':41387 ephemeral',
    steps: [
      { caption: S0, adds: [] },
      { caption: 'Code placement: one shared filesystem mounted everywhere.', adds: ['fs'] },
      { caption: 'mpirun starts on box 0 and sshes a helper daemon (orted/prted) onto every other box.', adds: ['ctl', 'ssh', 'daemons'] },
      { caption: "The daemons link into an out-of-band TCP tree — mpirun's private control plane, alive for one job.", adds: ['tree'] },
      { caption: 'The launch command propagates down the tree; each daemon forks four ranks.', adds: ['procs'] },
      { caption: 'MPI_Init assigns COMM_WORLD ranks; the app maps local rank → cudaSetDevice.', adds: ['identity', 'gpus'] },
      { caption: 'Rank 0 mints the 128-byte uniqueId and binds an ephemeral root port; MPI_Bcast copies the blob to every rank.', adds: ['id0', 'root', 'idAll'] },
      { caption: 'Every rank holds the same 128 bytes. NCCL reaches out to the root — backend NICs still dark; the blob rode MPI.', adds: ['reach'] },
    ],
  },
  {
    key: 'torchrun', label: 'torchrun · containers', daemonName: 'agent',
    ctlLabel: 'IaC / operator', identityLine: 'RANK · LOCAL_RANK · MASTER_ADDR',
    addrLine: 'id.addr = box0:36245 · ephemeral',
    rootPort: ':36245 ephemeral',
    steps: [
      { caption: S0, adds: [] },
      { caption: 'Terraform/Ansible/the operator provisions: every box pulls the same image from the registry.', adds: ['ctl', 'registry'] },
      { caption: 'One torchrun agent starts per box (pod spec, systemd, or sbatch glue).', adds: ['daemons'] },
      { caption: 'Agents rendezvous: box 0 wins the bind race and hosts the TCPStore; CAS joins collect the world.', adds: ['store', 'tree'] },
      { caption: 'Each agent forks four workers.', adds: ['procs'] },
      { caption: 'Workers are born with RANK / LOCAL_RANK / MASTER_ADDR in env; torch binds the devices.', adds: ['identity', 'gpus'] },
      { caption: 'Rank 0 set()s the uniqueId into the store; fifteen blocked get()s release at once. The app never saw the bytes.', adds: ['id0', 'root', 'idAll'] },
      { caption: 'Every worker holds the same 128 bytes. NCCL reaches out to the root — the RDMA fabric has not carried a single byte yet.', adds: ['reach'] },
    ],
  },
]

// ── geometry ─────────────────────────────────────────────────────────────────
const BW = 218  // box width
const BH = 260  // box height

// 2×2 grid: left col x=16, right col x=298, top row y=90, bottom row y=400
const BPOS = [
  { x: 16,  y: 90  },   // box 0: top-left  (root)
  { x: 298, y: 90  },   // box 1: top-right
  { x: 16,  y: 400 },   // box 2: bottom-left
  { x: 298, y: 400 },   // box 3: bottom-right
]

// Four GPU-NIC columns, left edges within a box
const SLOT_X = [10, 60, 110, 160]
const SLOT_W = 46

// Within-box y for each layer
const DAEMON_Y = 28
const PROC_Y   = 52
const ID_Y     = PROC_Y + 74   // = 126
const NIC_Y    = 172
const NIC_H    = 18
const GPU_Y    = NIC_Y + NIC_H + 8   // = 198
const GPU_H    = 36

function has(flags: Set<Flag>, f: Flag) { return flags.has(f) }

function ServerBox({ bi, flags, track }: { bi: number; flags: Set<Flag>; track: Track }) {
  const { x, y } = BPOS[bi]
  const root  = bi === 0
  const mgmt  = has(flags, 'ssh') || has(flags, 'tree') || has(flags, 'reach') || has(flags, 'batch0')
  const gpuLit = has(flags, 'gpus')

  return (
    <g>
      {/* chassis */}
      <rect x={x} y={y} width={BW} height={BH} rx={8}
        fill={has(flags, 'registry') ? '#101822' : '#0e0e16'}
        stroke={has(flags, 'reach') ? '#00ff41' : '#333344'}
        strokeWidth={has(flags, 'reach') ? 1.6 : 1.2}
      />
      <text x={x + 9} y={y + 15} fill="#555566" fontSize={9}>box {bi}</text>
      <text x={x + BW - 8} y={y + 15} textAnchor="end" fill="#3a3a4a" fontSize={8}>linux</text>

      {/* mgmt port — bottom edge, glows when management traffic is active */}
      <circle cx={x + 14} cy={y + BH + 6} r={4.5}
        fill={mgmt ? '#00ffff' : '#1a1a25'} stroke="#00ffff" strokeWidth={0.8}
        opacity={mgmt ? 1 : 0.3}
      />

      {/* daemon chip */}
      {has(flags, 'daemons') && (
        <g>
          <rect x={x + 8} y={y + DAEMON_Y} width={68} height={16} rx={3}
            fill="#1a1030" stroke="#aa66ff" strokeWidth={0.9} />
          <text x={x + 42} y={y + DAEMON_Y + 11} textAnchor="middle" fill="#aa66ff" fontSize={8.5}>
            {track.daemonName}
          </text>
        </g>
      )}

      {/* TCPStore chip (torchrun, box 0 only) */}
      {root && has(flags, 'store') && (
        <g>
          <rect x={x + 82} y={y + DAEMON_Y} width={128} height={16} rx={3}
            fill="#221400" stroke="#ff6600" strokeWidth={0.9} />
          <text x={x + 146} y={y + DAEMON_Y + 11} textAnchor="middle" fill="#ff6600" fontSize={8}>
            TCPStore · box0:29500
          </text>
        </g>
      )}

      {/* batch step chip (slurm, box 0 only) */}
      {root && has(flags, 'batch0') && (
        <g>
          <rect x={x + 82} y={y + DAEMON_Y} width={80} height={16} rx={3}
            fill="#101d10" stroke="#00ff41" strokeWidth={0.9} />
          <text x={x + 122} y={y + DAEMON_Y + 11} textAnchor="middle" fill="#00ff41" fontSize={8}>
            batch step
          </text>
        </g>
      )}

      {/* rank process squares */}
      {has(flags, 'procs') && SLOT_X.map((sx, si) => (
        <rect key={si} x={x + sx} y={y + PROC_Y} width={SLOT_W} height={34} rx={3}
          fill="#0d1a12" stroke="#00ff88" strokeWidth={0.9} />
      ))}
      {has(flags, 'procs') && (
        <text x={x + 9} y={y + PROC_Y + 47} fill="#557755" fontSize={7}>
          ranks {bi * 4}–{bi * 4 + 3}
        </text>
      )}

      {/* identity env line */}
      {has(flags, 'identity') && (
        <text x={x + 9} y={y + PROC_Y + 58} fill="#8899aa" fontSize={7}>
          {track.identityLine}
        </text>
      )}

      {/* NCCL_COMM_ID (slurm path): the address lives in the ENV */}
      {has(flags, 'commid') && (
        <text x={x + 9} y={y + PROC_Y + 68} fill="#00ffff" fontSize={7}>
          NCCL_COMM_ID=box0:29500
        </text>
      )}
      {/* mpirun/torchrun: the address lives INSIDE the 128-byte blob */}
      {track.addrLine && ((root && has(flags, 'id0')) || has(flags, 'idAll')) && (
        <text x={x + 9} y={y + PROC_Y + 68} fill="#8899aa" fontSize={7}>
          {track.addrLine}
        </text>
      )}

      {/* uniqueId chip */}
      {((root && has(flags, 'id0')) || has(flags, 'idAll')) && (
        <g>
          <rect x={x + 8} y={y + ID_Y} width={56} height={14} rx={3}
            fill="#221f00" stroke="#ffff00" strokeWidth={0.9} />
          <text x={x + 36} y={y + ID_Y + 10} textAnchor="middle" fill="#ffff00" fontSize={7.5}>
            id · 128 B
          </text>
        </g>
      )}

      {/* hardware section divider */}
      <line x1={x + 8} y1={y + 163} x2={x + BW - 8} y2={y + 163}
        stroke="#1e1e2a" strokeWidth={0.7} />
      <text x={x + BW / 2} y={y + 160} textAnchor="middle" fill="#332211" fontSize={6.5}>
        backend NICs — never lit during pre-init
      </text>

      {/* GPU-NIC pairs: NIC directly above its GPU with a connector stub */}
      {SLOT_X.map((sx, si) => (
        <g key={`hw-${si}`}>
          <rect x={x + sx + 2} y={y + NIC_Y} width={SLOT_W - 4} height={NIC_H} rx={2}
            fill="#0c0c14" stroke="#553311" strokeWidth={0.8} />
          <text x={x + sx + SLOT_W / 2} y={y + NIC_Y + 12} textAnchor="middle"
            fill="#553311" fontSize={6.5}>nic{si}</text>
          {/* NIC→GPU pairing connector */}
          <line
            x1={x + sx + SLOT_W / 2} y1={y + NIC_Y + NIC_H}
            x2={x + sx + SLOT_W / 2} y2={y + GPU_Y}
            stroke={gpuLit ? '#1a4444' : '#1f140a'} strokeWidth={0.7}
          />
          <rect x={x + sx} y={y + GPU_Y} width={SLOT_W} height={GPU_H} rx={3}
            fill={gpuLit ? '#032a2a' : '#14141c'}
            stroke={gpuLit ? '#00ffff' : '#2a2a38'}
            strokeWidth={1}
          />
          <text x={x + sx + SLOT_W / 2} y={y + GPU_Y + GPU_H / 2 + 3} textAnchor="middle"
            fill={gpuLit ? '#00ffff' : '#333344'} fontSize={8.5}>g{si}</text>
        </g>
      ))}

      {/* root listener port (box 0, right edge) */}
      {root && has(flags, 'root') && (
        <g>
          <circle cx={x + BW + 2} cy={y + 58} r={5.5}
            fill="#221400" stroke="#ff6600" strokeWidth={1.5} />
          <text x={x + BW + 11} y={y + 54} fill="#ff6600" fontSize={7.5}>root</text>
          <text x={x + BW + 11} y={y + 64} fill="#885533" fontSize={7}>{track.rootPort}</text>
        </g>
      )}
    </g>
  )
}

export function PreInitFig() {
  const [trackIdx, setTrackIdx] = useState(0)
  const track = TRACKS[trackIdx]
  const { step, reset, setStep, setPlaying } = useStepper(track.steps.length - 1, 1900)

  const flags = new Set<Flag>()
  for (let i = 0; i <= Math.min(step, track.steps.length - 1); i++)
    for (const f of track.steps[i].adds) flags.add(f)

  const done    = step >= track.steps.length - 1
  const caption = track.steps[Math.min(step, track.steps.length - 1)].caption

  const switchTrack = (i: number) => { setTrackIdx(i); setStep(0); setPlaying(true) }

  // y-center of daemon chips for each box (used to draw tree connections)
  const dy = (bi: number) => BPOS[bi].y + DAEMON_Y + 8

  return (
    <div className="font-mono text-[11px]">
      {/* track tabs */}
      <div className="flex gap-2 mb-2">
        {TRACKS.map((t, i) => (
          <button key={t.key} onClick={() => switchTrack(i)} title={`track-${t.key}`}
            className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${
              i === trackIdx
                ? 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10'
                : 'text-gray-500 border-surface-600 hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <svg viewBox="0 0 532 690" className="w-full">

        {/* ── Infrastructure band (y = 0..88) ── */}

        {has(flags, 'ctl') && (
          <g>
            <rect x={16} y={10} width={116} height={22} rx={4}
              fill="#12121a" stroke="#8888aa" strokeWidth={1} />
            <text x={74} y={25} textAnchor="middle" fill="#8888aa" fontSize={9}>
              {track.ctlLabel}
            </text>
          </g>
        )}

        {has(flags, 'fs') && (
          <g>
            <ellipse cx={430} cy={16} rx={60} ry={9} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <rect x={370} y={16} width={120} height={16} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <ellipse cx={430} cy={32} rx={60} ry={9} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <text x={430} y={28} textAnchor="middle" fill="#00ff88" fontSize={8.5}>shared FS /app</text>
            {[0, 1, 2, 3].map((bi) => (
              <line key={bi}
                x1={430} y1={41} x2={BPOS[bi].x + BW / 2} y2={BPOS[bi].y}
                stroke="#00ff88" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.5}
              />
            ))}
          </g>
        )}

        {has(flags, 'registry') && (
          <g>
            <rect x={366} y={9} width={148} height={26} rx={4}
              fill="#12121a" stroke="#ff00ff" strokeWidth={1} />
            <text x={440} y={26} textAnchor="middle" fill="#ff00ff" fontSize={8.5}>
              registry · image:v7
            </text>
            {[0, 1, 2, 3].map((bi) => (
              <line key={bi}
                x1={440} y1={35} x2={BPOS[bi].x + BW / 2} y2={BPOS[bi].y}
                stroke="#ff00ff" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.5}
              />
            ))}
          </g>
        )}

        {/* ── Cross-box connections ── */}

        {/* ssh: box 0 → boxes 1,2,3 arcing through the top band */}
        {has(flags, 'ssh') && [1, 2, 3].map((bi) => {
          const sx = BPOS[0].x + BW / 2, sy = BPOS[0].y
          const dx = BPOS[bi].x + BW / 2, ey = BPOS[bi].y
          const cy = Math.min(sy, ey) - 40
          return (
            <path key={bi}
              d={`M ${sx} ${sy} C ${sx} ${cy} ${dx} ${cy} ${dx} ${ey}`}
              fill="none" stroke="#8888aa" strokeWidth={1} strokeDasharray="4 3" opacity={0.7}
            />
          )
        })}
        {has(flags, 'ssh') && (
          <text x={BPOS[1].x + 14} y={BPOS[1].y - 6} fill="#8888aa" fontSize={8}>ssh</text>
        )}

        {/* daemon tree: rectangular ring — top row, bottom row, left col, right col */}
        {has(flags, 'tree') && (
          <>
            <line x1={BPOS[0].x + BW} y1={dy(0)} x2={BPOS[1].x}           y2={dy(1)}
              stroke="#aa66ff" strokeWidth={1} opacity={0.45} />
            <line x1={BPOS[2].x + BW} y1={dy(2)} x2={BPOS[3].x}           y2={dy(3)}
              stroke="#aa66ff" strokeWidth={1} opacity={0.45} />
            <line x1={BPOS[0].x - 6}  y1={dy(0)} x2={BPOS[2].x - 6}       y2={dy(2)}
              stroke="#aa66ff" strokeWidth={1} opacity={0.45} />
            <line x1={BPOS[1].x + BW + 6} y1={dy(1)} x2={BPOS[3].x + BW + 6} y2={dy(3)}
              stroke="#aa66ff" strokeWidth={1} opacity={0.45} />
          </>
        )}

        {/* uniqueId broadcast: box 0 uniqueId chip → each other box */}
        {has(flags, 'idAll') && has(flags, 'id0') && [1, 2, 3].map((bi) => {
          const sx = BPOS[0].x + 36, sy = BPOS[0].y + ID_Y + 7
          const dx = BPOS[bi].x + 36, ey = BPOS[bi].y + ID_Y + 7
          const mx = (sx + dx) / 2, my = (sy + ey) / 2 + 28
          return (
            <path key={bi}
              d={`M ${sx} ${sy} Q ${mx} ${my} ${dx} ${ey}`}
              fill="none" stroke="#ffff00" strokeWidth={0.9} strokeDasharray="3 3" opacity={0.55}
            />
          )
        })}

        {/* reach-out: boxes 1,2,3 all dial the root port on box 0 */}
        {has(flags, 'reach') && (
          <>
            {/* box 1 → root: short arc through the 64 px center gap */}
            <path
              d={`M ${BPOS[1].x + 18} ${BPOS[1].y + 60}
                  C 278 ${BPOS[1].y + 56} 248 ${BPOS[0].y + 52}
                    ${BPOS[0].x + BW + 2} ${BPOS[0].y + 58}`}
              fill="none" stroke="#00ff41" strokeWidth={1.6} opacity={0.85}
            />
            {/* box 2 → root: arc up the outer left side */}
            <path
              d={`M ${BPOS[2].x + 18} ${BPOS[2].y + 60}
                  C ${BPOS[2].x - 24} ${BPOS[2].y + 20}
                    ${BPOS[0].x - 24} ${BPOS[0].y + 140}
                    ${BPOS[0].x + BW + 2} ${BPOS[0].y + 58}`}
              fill="none" stroke="#00ff41" strokeWidth={1.6} opacity={0.85}
            />
            {/* box 3 → root: diagonal arc through cluster center */}
            <path
              d={`M ${BPOS[3].x + 18} ${BPOS[3].y + 60}
                  C 348 ${BPOS[3].y} 310 240
                    ${BPOS[0].x + BW + 2} ${BPOS[0].y + 58}`}
              fill="none" stroke="#00ff41" strokeWidth={1.6} opacity={0.85}
            />
          </>
        )}
        {has(flags, 'reach') && (
          <text x={BPOS[2].x + 20} y={BPOS[2].y + 48} fill="#00ff41" fontSize={8}>
            ncclCommInitRank → dial root
          </text>
        )}

        {/* management net label in the vertical center gap */}
        {(has(flags, 'ssh') || has(flags, 'tree') || has(flags, 'batch0')) && (
          <text x={266} y={378} textAnchor="middle" fill="#004444" fontSize={7}>mgmt net</text>
        )}

        {/* server boxes — rendered last so they sit on top of connection lines */}
        {[0, 1, 2, 3].map((bi) => (
          <ServerBox key={bi} bi={bi} flags={flags} track={track} />
        ))}

      </svg>

      <div className="flex items-center gap-3 mt-1">
        <button onClick={reset} title="replay-preinit"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40">
          ↻ replay
        </button>
        <span className="text-gray-500">step {stepperLabel(step, track.steps.length - 1)}</span>
      </div>
      <div className={`mt-2 min-h-[3.2em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {caption}
      </div>
    </div>
  )
}
