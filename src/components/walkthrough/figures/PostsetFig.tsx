// ncclTopoPostset (connect.cc:380): the cross-node stitch. Each node's intra
// chain closes into one global Hamiltonian cycle via the rail NICs the search
// chose — exit GPU → NET → next node's entry GPU.
import { useStepper, stepperLabel } from '../useStepper'

const GPU_W = 34
const GPU_H = 24

// Two nodes, 4 GPUs each; channel 0 enters at the rail NIC's local GPU.
const NODE0 = { x: 30, ranks: [0, 1, 2, 3] }
const NODE1 = { x: 250, ranks: [4, 5, 6, 7] }
const NET_X = 190
const NET_Y = 60

function gpuPos(node: typeof NODE0, i: number) {
  return { x: node.x + 10, y: 95 + i * (GPU_H + 10) }
}

const STEPS = 4 // intra n0, intra n1, stitch out, stitch back

function Arrow({ x1, y1, x2, y2, color, dash }: { x1: number; y1: number; x2: number; y2: number; color: string; dash?: string }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.8} strokeDasharray={dash} />
      <circle cx={x2} cy={y2} r={2.4} fill={color} />
    </g>
  )
}

export function PostsetFig() {
  const { step, reset } = useStepper(STEPS, 1200)
  const done = step >= STEPS

  const captions = [
    'Two nodes, each holding its own agreed intra chain and open −1 slots…',
    'Node 0’s intra chain: entry rank 0 → 1 → 2 → exit rank 3.',
    'Node 1 has the SAME chain shape (same graph, same fold): entry 4 → … → exit 7.',
    'Stitch: node 0’s exit (3) → NET rail → node 1’s entry (4). One −1 slot filled on each side.',
  ]

  return (
    <div className="font-mono text-[11px]">
      <svg viewBox="0 0 420 260" className="w-full max-w-lg">
        {/* server boxes */}
        {[{ n: NODE0, label: 'node 0' }, { n: NODE1, label: 'node 1' }].map(({ n, label }) => (
          <g key={label}>
            <rect x={n.x} y={80} width={140} height={155} rx={6} fill="#12121a" stroke="#222230" />
            <text x={n.x + 8} y={73} fill="#555566" fontSize={9}>{label}</text>
          </g>
        ))}
        {/* NET rail */}
        <rect x={NET_X} y={NET_Y - 14} width={40} height={20} rx={4} fill="#1a1a25" stroke="#ff6600" strokeWidth={1} />
        <text x={NET_X + 20} y={NET_Y} textAnchor="middle" fill="#ff6600" fontSize={8}>NET 0</text>

        {/* GPUs */}
        {[NODE0, NODE1].map((n) =>
          n.ranks.map((r, i) => {
            const p = gpuPos(n, i)
            return (
              <g key={r}>
                <rect x={p.x} y={p.y} width={GPU_W} height={GPU_H} rx={3} fill="#0a0a0f" stroke="#00ffff" strokeWidth={0.8} opacity={0.9} />
                <text x={p.x + GPU_W / 2} y={p.y + GPU_H / 2 + 3} textAnchor="middle" fill="#e5e5e5" fontSize={9}>
                  g{r}
                </text>
              </g>
            )
          }),
        )}

        {/* intra chains */}
        {step >= 1 &&
          NODE0.ranks.slice(0, -1).map((r, i) => {
            const a = gpuPos(NODE0, i)
            const b = gpuPos(NODE0, i + 1)
            return <Arrow key={`n0-${r}`} x1={a.x + GPU_W} y1={a.y + GPU_H / 2} x2={b.x + GPU_W} y2={b.y + GPU_H / 2} color="#00ff41" />
          })}
        {step >= 2 &&
          NODE1.ranks.slice(0, -1).map((r, i) => {
            const a = gpuPos(NODE1, i)
            const b = gpuPos(NODE1, i + 1)
            return <Arrow key={`n1-${r}`} x1={a.x + GPU_W} y1={a.y + GPU_H / 2} x2={b.x + GPU_W} y2={b.y + GPU_H / 2} color="#00ff41" />
          })}

        {/* stitch arcs through NET */}
        {step >= 3 && (
          <g>
            {/* node0 exit (g3) up to NET */}
            <path
              d={`M ${gpuPos(NODE0, 3).x + GPU_W / 2} ${gpuPos(NODE0, 3).y + GPU_H} C 120 250, ${NET_X - 30} ${NET_Y + 40}, ${NET_X} ${NET_Y}`}
              fill="none" stroke="#ff6600" strokeWidth={1.8}
            />
            {/* NET down to node1 entry (g4) */}
            <path
              d={`M ${NET_X + 40} ${NET_Y} C ${NET_X + 70} ${NET_Y + 20}, ${gpuPos(NODE1, 0).x - 20} ${gpuPos(NODE1, 0).y - 10}, ${gpuPos(NODE1, 0).x} ${gpuPos(NODE1, 0).y + GPU_H / 2}`}
              fill="none" stroke="#ff6600" strokeWidth={1.8}
            />
            <circle cx={gpuPos(NODE1, 0).x} cy={gpuPos(NODE1, 0).y + GPU_H / 2} r={2.4} fill="#ff6600" />
          </g>
        )}
        {done && (
          <path
            d={`M ${gpuPos(NODE1, 3).x + GPU_W / 2} ${gpuPos(NODE1, 3).y + GPU_H} C 250 258, 90 258, ${gpuPos(NODE0, 0).x} ${gpuPos(NODE0, 0).y + GPU_H / 2}`}
            fill="none" stroke="#ff6600" strokeWidth={1.8} strokeDasharray="4 3"
          />
        )}
      </svg>
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={reset}
          title="replay-postset"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">stitch {stepperLabel(step, STEPS)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {done
          ? 'Return path (7 → rail → 0, dashed) closes the global ring: one Hamiltonian cycle over all 8 GPUs. Trees fold from the SAME intra chains — nodesFirstRank roots them, no second search.'
          : captions[step]}
      </div>
    </div>
  )
}
