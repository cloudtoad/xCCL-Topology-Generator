// The landing: three rendezvous paths funnel into one identical per-rank
// state, and the launcher exits the story. From here, everything is xCCL.
import { useStepper, stepperLabel } from '../useStepper'

const PATHS = [
  { label: 'mpirun', sub: 'MPI_Bcast', color: '#00ff41', y: 52 },
  { label: 'srun', sub: 'NCCL_COMM_ID env', color: '#00ffff', y: 132 },
  { label: 'torchrun', sub: 'TCPStore get()', color: '#ff00ff', y: 212 },
]

const CX = 208 // convergence box left edge
const CY = 132 // convergence box center y

const CAPTIONS = [
  'Three ecosystems, three rendezvous mechanisms…',
  'mpirun: the app author broadcast the blob over MPI.',
  'srun: every rank rebuilt the identical handle from a static env var — zero bytes moved.',
  'torchrun: N−1 blocked get()s released by rank 0\'s set().',
  'Every rank now holds the SAME four facts — the paths are indistinguishable in the state they produced.',
  'ncclCommInitRank() begins. The launcher is out of the story.',
]

export function ConvergenceFig() {
  const { step, reset } = useStepper(CAPTIONS.length - 1, 1300)
  const done = step >= CAPTIONS.length - 1

  return (
    <div className="font-mono text-[11px]">
      <svg viewBox="0 0 470 264" className="w-full max-w-xl">
        {/* source paths */}
        {PATHS.map((p, i) => {
          const lit = step >= i + 1
          return (
            <g key={p.label} opacity={lit ? 1 : 0.18}>
              <rect x={8} y={p.y - 22} width={118} height={44} rx={5} fill="#12121a" stroke={p.color} strokeWidth={1.2} />
              <text x={67} y={p.y - 4} textAnchor="middle" fill={p.color} fontSize={11} fontWeight="bold">
                {p.label}
              </text>
              <text x={67} y={p.y + 12} textAnchor="middle" fill="#8899aa" fontSize={8.5}>
                {p.sub}
              </text>
              <path
                d={`M 126 ${p.y} C 168 ${p.y}, 168 ${CY}, ${CX} ${CY}`}
                fill="none"
                stroke={p.color}
                strokeWidth={lit ? 1.8 : 1}
                strokeDasharray={lit ? undefined : '3 3'}
              />
              <circle cx={CX} cy={CY} r={2.5} fill={p.color} opacity={lit ? 1 : 0} />
            </g>
          )
        })}

        {/* the identical state */}
        <g opacity={step >= 4 ? 1 : 0.3}>
          <rect
            x={CX} y={CY - 52} width={140} height={104} rx={6}
            fill="#0a0a0f"
            stroke={step >= 4 ? '#e5e5e5' : '#333344'}
            strokeWidth={step >= 4 ? 1.6 : 1}
          />
          <text x={CX + 70} y={CY - 34} textAnchor="middle" fill="#8899aa" fontSize={8.5}>
            every rank, identically:
          </text>
          {['RANK', 'WORLD_SIZE', 'cudaSetDevice(…)', 'uniqueId — 128 B'].map((f, i) => (
            <text key={f} x={CX + 70} y={CY - 14 + i * 16} textAnchor="middle" fill={step >= 4 ? '#e5e5e5' : '#555566'} fontSize={9.5}>
              {f}
            </text>
          ))}
        </g>

        {/* the door */}
        <g opacity={done ? 1 : 0.15}>
          <path d={`M ${CX + 140} ${CY} L ${CX + 168} ${CY}`} stroke="#00ff41" strokeWidth={2} />
          <path d={`M ${CX + 163} ${CY - 4} L ${CX + 168} ${CY} L ${CX + 163} ${CY + 4}`} fill="none" stroke="#00ff41" strokeWidth={2} />
          <rect x={CX + 170} y={CY - 26} width={88} height={52} rx={5} fill="#12121a" stroke="#00ff41" strokeWidth={done ? 1.6 : 1} />
          <text x={CX + 214} y={CY - 6} textAnchor="middle" fill="#00ff41" fontSize={7.8}>
            ncclCommInitRank()
          </text>
          <text x={CX + 214} y={CY + 10} textAnchor="middle" fill="#8899aa" fontSize={8}>
            one protocol from here
          </text>
        </g>
      </svg>

      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={reset}
          title="replay-convergence"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">{stepperLabel(step, CAPTIONS.length - 1)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {CAPTIONS[Math.min(step, CAPTIONS.length - 1)]}
      </div>
    </div>
  )
}
