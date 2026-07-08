// =============================================================================
// PreInitFig — from bare OS to the first NCCL packet, three roads, one grammar.
//
// Four boxes, four GPUs each, each GPU with a dedicated backend NIC. The boxes
// start EMPTY (an OS, dark silicon). Each step places something on a box or
// changes a variable, until every rank holds the four facts and reaches out to
// the root. Track tabs switch between the three launcher families; the FINAL
// FRAME IS IDENTICAL on every track — that's the convergence, drawn.
//
// Deliberate detail: the backend NICs never light up. Nothing in pre-init
// touches the RDMA fabric — every byte so far rode the management network
// (the small mgmt port on each box's left edge).
// =============================================================================
import { useState } from 'react'
import { useStepper, stepperLabel } from '../useStepper'

type Flag =
  | 'daemons' | 'ctl' | 'fs' | 'registry' | 'batch0' | 'ssh' | 'tree' | 'store'
  | 'procs' | 'identity' | 'gpus' | 'commid' | 'id0' | 'idAll' | 'root' | 'reach'

interface TrackStep { caption: string; adds: Flag[] }
interface Track {
  key: string
  label: string
  daemonName: string
  ctlLabel: string
  identityLine: string
  steps: TrackStep[]
}

const STEP0 = 'Four boxes, an OS each. GPUs and their dedicated backend NICs: dark silicon.'

const TRACKS: Track[] = [
  {
    key: 'slurm',
    label: 'srun · shared FS',
    daemonName: 'slurmd',
    ctlLabel: 'slurmctld',
    identityLine: 'SLURM_PROCID · LOCALID',
    steps: [
      { caption: STEP0, adds: [] },
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
    key: 'mpirun',
    label: 'mpirun · ssh',
    daemonName: 'prted',
    ctlLabel: 'mpirun @ box 0',
    identityLine: 'MPI_COMM_WORLD rank',
    steps: [
      { caption: STEP0, adds: [] },
      { caption: 'Code placement: one shared filesystem mounted everywhere.', adds: ['fs'] },
      { caption: 'mpirun starts on box 0 and sshes a helper daemon (orted/prted) onto every other box.', adds: ['ctl', 'ssh', 'daemons'] },
      { caption: 'The daemons link into an out-of-band TCP tree — mpirun\'s private control plane, alive for one job.', adds: ['tree'] },
      { caption: 'The launch command propagates down the tree; each daemon forks four ranks.', adds: ['procs'] },
      { caption: 'MPI_Init assigns COMM_WORLD ranks; the app maps local rank → cudaSetDevice. (The author wrote that line.)', adds: ['identity', 'gpus'] },
      { caption: 'Rank 0 mints the 128-byte uniqueId and binds an ephemeral root port; MPI_Bcast copies the blob to every rank — app code, over MPI\'s own transport.', adds: ['id0', 'root', 'idAll'] },
      { caption: 'Every rank holds the same 128 bytes. NCCL reaches out to the root — backend NICs still dark; the blob rode MPI, the dial-in rides management TCP.', adds: ['reach'] },
    ],
  },
  {
    key: 'torchrun',
    label: 'torchrun · containers',
    daemonName: 'agent',
    ctlLabel: 'IaC / operator',
    identityLine: 'RANK · LOCAL_RANK · MASTER_ADDR',
    steps: [
      { caption: STEP0, adds: [] },
      { caption: 'Terraform/Ansible/the operator provisions: every box pulls the same image from the registry — code distribution by image, the container era\'s answer.', adds: ['ctl', 'registry'] },
      { caption: 'One torchrun agent starts per box (pod spec, systemd, or sbatch glue).', adds: ['daemons'] },
      { caption: 'Agents rendezvous: box 0 wins the bind race and hosts the TCPStore; CAS joins collect the world, last-call passes, the round freezes.', adds: ['store', 'tree'] },
      { caption: 'Each agent forks four workers.', adds: ['procs'] },
      { caption: 'Workers are born with RANK / LOCAL_RANK / MASTER_ADDR in env; torch binds the devices.', adds: ['identity', 'gpus'] },
      { caption: 'Rank 0 set()s the uniqueId into the store; fifteen blocked get()s release at once. The app never saw the bytes.', adds: ['id0', 'root', 'idAll'] },
      { caption: 'Every worker holds the same 128 bytes. NCCL reaches out to the root — the RDMA fabric has not carried a single byte yet.', adds: ['reach'] },
    ],
  },
]

// ── geometry ────────────────────────────────────────────────────────────────
const BOX_W = 150
const BOX_H = 168
const BOX_Y = 96
const BOX_X = (i: number) => 42 + i * 172

function has(flags: Set<Flag>, f: Flag) { return flags.has(f) }

function ServerBox({ i, flags, track }: { i: number; flags: Set<Flag>; track: Track }) {
  const x = BOX_X(i)
  const isRoot = i === 0
  const busy = has(flags, 'ssh') || has(flags, 'tree') || has(flags, 'reach') || has(flags, 'batch0')
  return (
    <g>
      {/* chassis */}
      <rect x={x} y={BOX_Y} width={BOX_W} height={BOX_H} rx={7}
        fill={has(flags, 'registry') ? '#101822' : '#0e0e16'} stroke="#333344" strokeWidth={1.2} />
      <text x={x + 8} y={BOX_Y + 14} fill="#555566" fontSize={9}>box {i}</text>
      <text x={x + BOX_W - 8} y={BOX_Y + 14} textAnchor="end" fill="#3a3a4a" fontSize={8}>linux</text>

      {/* mgmt port — glows whenever the management plane is talking */}
      <circle cx={x} cy={BOX_Y + 30} r={4} fill={busy ? '#00ffff' : '#1a1a25'} stroke="#00ffff" strokeWidth={0.8} opacity={busy ? 1 : 0.5} />
      <text x={x - 4} y={BOX_Y + 44} fill="#446" fontSize={7}>mgmt</text>

      {/* backend NICs — top edge, dedicated per GPU, NEVER lit during pre-init */}
      {[0, 1, 2, 3].map((n) => (
        <g key={n}>
          <rect x={x + 18 + n * 32} y={BOX_Y - 9} width={20} height={9} rx={2} fill="#12121a" stroke="#553311" strokeWidth={0.8} />
          <text x={x + 28 + n * 32} y={BOX_Y - 13} textAnchor="middle" fill="#553311" fontSize={6.5}>nic{n}</text>
        </g>
      ))}

      {/* daemon chip */}
      {has(flags, 'daemons') && (
        <g>
          <rect x={x + 8} y={BOX_Y + 22} width={62} height={16} rx={3} fill="#1a1030" stroke="#aa66ff" strokeWidth={0.9} />
          <text x={x + 39} y={BOX_Y + 33} textAnchor="middle" fill="#aa66ff" fontSize={8.5}>{track.daemonName}</text>
        </g>
      )}
      {/* store / batch chips on box 0 */}
      {isRoot && has(flags, 'store') && (
        <g>
          <rect x={x + 76} y={BOX_Y + 22} width={66} height={16} rx={3} fill="#221400" stroke="#ff6600" strokeWidth={0.9} />
          <text x={x + 109} y={BOX_Y + 33} textAnchor="middle" fill="#ff6600" fontSize={8}>TCPStore</text>
        </g>
      )}
      {isRoot && has(flags, 'batch0') && (
        <g>
          <rect x={x + 76} y={BOX_Y + 22} width={66} height={16} rx={3} fill="#101d10" stroke="#00ff41" strokeWidth={0.9} />
          <text x={x + 109} y={BOX_Y + 33} textAnchor="middle" fill="#00ff41" fontSize={8}>batch step</text>
        </g>
      )}

      {/* rank processes */}
      {has(flags, 'procs') && [0, 1, 2, 3].map((p) => (
        <rect key={p} x={x + 14 + p * 33} y={BOX_Y + 48} width={24} height={18} rx={3}
          fill="#0d1a12" stroke="#00ff88" strokeWidth={0.9} />
      ))}
      {has(flags, 'procs') && (
        <text x={x + 8} y={BOX_Y + 80} fill="#557755" fontSize={7}>ranks {i * 4}–{i * 4 + 3}</text>
      )}

      {/* identity env line */}
      {has(flags, 'identity') && (
        <text x={x + 8} y={BOX_Y + 94} fill="#8899aa" fontSize={7.5}>{track.identityLine}</text>
      )}
      {/* NCCL_COMM_ID env line (slurm) */}
      {has(flags, 'commid') && (
        <text x={x + 8} y={BOX_Y + 106} fill="#00ffff" fontSize={7.5}>NCCL_COMM_ID=box0:29500</text>
      )}
      {/* uniqueId chip */}
      {((isRoot && has(flags, 'id0')) || has(flags, 'idAll')) && (
        <g>
          <rect x={x + 8} y={BOX_Y + 112} width={54} height={14} rx={3} fill="#221f00" stroke="#ffff00" strokeWidth={0.9} />
          <text x={x + 35} y={BOX_Y + 122} textAnchor="middle" fill="#ffff00" fontSize={7.5}>id · 128 B</text>
        </g>
      )}

      {/* GPUs — dark until bound */}
      {[0, 1, 2, 3].map((g) => {
        const lit = has(flags, 'gpus')
        return (
          <g key={g}>
            <rect x={x + 14 + g * 33} y={BOX_Y + BOX_H - 34} width={26} height={22} rx={3}
              fill={lit ? '#032a2a' : '#14141c'} stroke={lit ? '#00ffff' : '#2a2a38'} strokeWidth={1} />
            <text x={x + 27 + g * 33} y={BOX_Y + BOX_H - 20} textAnchor="middle"
              fill={lit ? '#00ffff' : '#333344'} fontSize={7.5}>g{g}</text>
          </g>
        )
      })}

      {/* root listener on box 0 */}
      {isRoot && has(flags, 'root') && (
        <g>
          <circle cx={x + BOX_W} cy={BOX_Y + 58} r={5.5} fill="#221400" stroke="#ff6600" strokeWidth={1.5} />
          <text x={x + BOX_W + 9} y={BOX_Y + 54} fill="#ff6600" fontSize={7.5}>root</text>
          <text x={x + BOX_W + 9} y={BOX_Y + 64} fill="#885533" fontSize={7}>:29500</text>
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
  for (let i = 0; i <= Math.min(step, track.steps.length - 1); i++) {
    for (const f of track.steps[i].adds) flags.add(f)
  }
  const done = step >= track.steps.length - 1
  const caption = track.steps[Math.min(step, track.steps.length - 1)].caption

  const switchTrack = (i: number) => {
    setTrackIdx(i)
    setStep(0)
    setPlaying(true)
  }

  return (
    <div className="font-mono text-[11px]">
      {/* track tabs */}
      <div className="flex gap-2 mb-2">
        {TRACKS.map((t, i) => (
          <button
            key={t.key}
            onClick={() => switchTrack(i)}
            title={`track-${t.key}`}
            className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${
              i === trackIdx
                ? 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10'
                : 'text-gray-500 border-surface-600 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <svg viewBox="0 0 740 292" className="w-full">
        {/* shared infrastructure band */}
        {has(flags, 'ctl') && (
          <g>
            <rect x={42} y={18} width={110} height={22} rx={4} fill="#12121a" stroke="#8888aa" strokeWidth={1} />
            <text x={97} y={32} textAnchor="middle" fill="#8888aa" fontSize={9}>{track.ctlLabel}</text>
          </g>
        )}
        {has(flags, 'fs') && (
          <g>
            <ellipse cx={620} cy={22} rx={54} ry={9} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <rect x={566} y={22} width={108} height={16} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <ellipse cx={620} cy={38} rx={54} ry={9} fill="#12121a" stroke="#00ff88" strokeWidth={1} />
            <text x={620} y={34} textAnchor="middle" fill="#00ff88" fontSize={8.5}>shared FS /app</text>
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1={620} y1={47} x2={BOX_X(i) + BOX_W / 2} y2={BOX_Y - 14}
                stroke="#00ff88" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.5} />
            ))}
          </g>
        )}
        {has(flags, 'registry') && (
          <g>
            <rect x={560} y={14} width={120} height={26} rx={4} fill="#12121a" stroke="#ff00ff" strokeWidth={1} />
            <text x={620} y={31} textAnchor="middle" fill="#ff00ff" fontSize={8.5}>registry · image:v7</text>
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1={620} y1={40} x2={BOX_X(i) + BOX_W / 2} y2={BOX_Y - 14}
                stroke="#ff00ff" strokeWidth={0.7} strokeDasharray="2 3" opacity={0.5} />
            ))}
          </g>
        )}

        {/* ssh arrows from box0 to others */}
        {has(flags, 'ssh') && [1, 2, 3].map((i) => (
          <path key={i}
            d={`M ${BOX_X(0) + BOX_W - 20} ${BOX_Y - 22} C ${BOX_X(0) + 220} ${BOX_Y - 52}, ${BOX_X(i) - 40} ${BOX_Y - 52}, ${BOX_X(i) + 30} ${BOX_Y - 16}`}
            fill="none" stroke="#8888aa" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        ))}
        {has(flags, 'ssh') && <text x={BOX_X(1) + 20} y={52} fill="#8888aa" fontSize={8}>ssh</text>}

        {/* daemon OOB tree / agent rendezvous links */}
        {has(flags, 'tree') && [1, 2, 3].map((i) => (
          <line key={i}
            x1={BOX_X(0) + 39} y1={BOX_Y + 30} x2={BOX_X(i) + 39} y2={BOX_Y + 30}
            stroke="#aa66ff" strokeWidth={1} opacity={0.45} />
        ))}

        {/* uniqueId broadcast pulses (mpirun/torchrun): box0 → others */}
        {has(flags, 'idAll') && has(flags, 'id0') && [1, 2, 3].map((i) => (
          <path key={i}
            d={`M ${BOX_X(0) + 62} ${BOX_Y + 119} C ${BOX_X(0) + 200} ${BOX_Y + 150}, ${BOX_X(i) - 60} ${BOX_Y + 150}, ${BOX_X(i) + 8} ${BOX_Y + 119}`}
            fill="none" stroke="#ffff00" strokeWidth={0.9} strokeDasharray="3 3" opacity={0.55} />
        ))}

        {/* boxes */}
        {[0, 1, 2, 3].map((i) => (
          <ServerBox key={i} i={i} flags={flags} track={track} />
        ))}

        {/* reach-out: everyone dials the root */}
        {has(flags, 'reach') && [1, 2, 3].map((i) => (
          <path key={i}
            d={`M ${BOX_X(i) + 26} ${BOX_Y + 57} C ${BOX_X(i) - 60} ${BOX_Y + 44}, ${BOX_X(0) + 260} ${BOX_Y + 40}, ${BOX_X(0) + BOX_W + 6} ${BOX_Y + 54}`}
            fill="none" stroke="#00ff41" strokeWidth={1.6} opacity={0.85} />
        ))}
        {has(flags, 'reach') && (
          <text x={BOX_X(2) + 20} y={72} fill="#00ff41" fontSize={8.5}>
            ncclCommInitRank → dial the root
          </text>
        )}
      </svg>

      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={reset}
          title="replay-preinit"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
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
