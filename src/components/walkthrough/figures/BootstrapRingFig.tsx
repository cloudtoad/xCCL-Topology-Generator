// The bootstrap ring forming: ranks check in with the root in arrival order;
// the root forwards successor addresses as they become known
// (bootstrap.cc:355-390). A ring edge r→r+1 exists once rank r has learned
// its successor's listen address.
import { useStepper, stepperLabel } from '../useStepper'

const N = 8
// Deliberately shuffled arrival order so "successor not yet known — saved for
// later" actually happens (the else-branch at bootstrap.cc:366).
const ARRIVALS = [0, 3, 1, 5, 7, 2, 6, 4]

const CX = 190
const CY = 150
const R = 110

function pos(rank: number) {
  const a = (rank / N) * Math.PI * 2 - Math.PI / 2
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) }
}

function caption(step: number): string {
  if (step === 0) return 'Every rank knows only the root’s address (from the uniqueId).'
  const r = ARRIVALS[step - 1]
  const checked = new Set(ARRIVALS.slice(0, step))
  const next = (r + 1) % N
  const prev = (r + N - 1) % N
  const parts = [`rank ${r} checks in`]
  if (checked.has(next)) parts.push(`root sends it rank ${next}’s address → edge ${r}→${next}`)
  else parts.push(`successor ${next} unknown — root saves rank ${r}’s slot for later`)
  if (checked.has(prev)) parts.push(`and completes edge ${prev}→${r}`)
  return parts.join('; ')
}

export function BootstrapRingFig() {
  const { step, reset } = useStepper(N, 1100)
  const checked = new Set(ARRIVALS.slice(0, step))
  const done = step >= N

  return (
    <div className="font-mono text-[11px]">
      <svg viewBox="0 0 380 300" className="w-full max-w-md">
        {/* check-in spokes */}
        {ARRIVALS.slice(0, step).map((r) => {
          const p = pos(r)
          return (
            <line
              key={`spoke-${r}`}
              x1={p.x} y1={p.y} x2={CX} y2={CY}
              stroke="#555566"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={done ? 0.25 : 0.7}
            />
          )
        })}
        {/* ring edges: r -> r+1 once both checked in */}
        {Array.from({ length: N }, (_, r) => {
          const next = (r + 1) % N
          if (!checked.has(r) || !checked.has(next)) return null
          const a = pos(r)
          const b = pos(next)
          return (
            <line
              key={`edge-${r}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#00ff41"
              strokeWidth={2}
              opacity={0.9}
            />
          )
        })}
        {/* root */}
        <circle cx={CX} cy={CY} r={16} fill="#1a1a25" stroke="#00ffff" strokeWidth={1.5} />
        <text x={CX} y={CY + 3} textAnchor="middle" fill="#00ffff" fontSize={9}>root</text>
        {/* ranks */}
        {Array.from({ length: N }, (_, r) => {
          const p = pos(r)
          const isIn = checked.has(r)
          return (
            <g key={`rank-${r}`}>
              <circle
                cx={p.x} cy={p.y} r={14}
                fill={isIn ? '#12121a' : '#0a0a0f'}
                stroke={isIn ? '#00ff41' : '#333344'}
                strokeWidth={1.5}
              />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fill={isIn ? '#e5e5e5' : '#555566'} fontSize={9}>
                r{r}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={reset}
          title="replay-bootstrap"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">check-ins {stepperLabel(step, N)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {done
          ? 'TCP socket ring established — the first ring NCCL builds, before any topology exists. Every bootstrapAllGather walks it.'
          : caption(step)}
      </div>
    </div>
  )
}
