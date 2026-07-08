// ncclTopoPreset (connect.cc:20): each rank stamps its channel structs from
// the agreed graphs — ring prev/next seeded from the intra order, inter-node
// slots left open (-1) for postset to fill.
import { useStepper, stepperLabel } from '../useStepper'

const CHANNELS = [
  { id: 0, order: [0, 1, 2, 3] },
  { id: 1, order: [0, 3, 2, 1] }, // dup'd counter-rotating ring
]

function prevNext(order: number[], rank: number) {
  const i = order.indexOf(rank)
  const n = order.length
  return { prev: order[(i + n - 1) % n], next: order[(i + 1) % n] }
}

export function PresetFig() {
  const total = CHANNELS.length * 4
  const { step, reset } = useStepper(total, 450)
  const done = step >= total

  return (
    <div className="font-mono text-[11px]">
      <div className="flex gap-6 flex-wrap">
        {CHANNELS.map((ch, ci) => (
          <table key={ch.id} className="border-collapse">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="py-1 pr-3 font-normal" colSpan={4}>
                  channel {ch.id}{' '}
                  <span className="text-gray-600">· intra order [{ch.order.join(' ')}]</span>
                </th>
              </tr>
              <tr className="text-gray-500 text-left">
                <th className="py-1 pr-3 font-normal">rank</th>
                <th className="py-1 pr-3 font-normal">ring.prev</th>
                <th className="py-1 pr-3 font-normal">ring.next</th>
                <th className="py-1 font-normal">inter</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((rank) => {
                const filled = ci * 4 + rank < step
                const { prev, next } = prevNext(ch.order, rank)
                const isBoundary = ch.order.indexOf(rank) === 0 || ch.order.indexOf(rank) === 3
                return (
                  <tr key={rank} className="border-t border-surface-600">
                    <td className="py-0.5 pr-3 text-neon-cyan">{rank}</td>
                    <td className={`py-0.5 pr-3 transition-colors ${filled ? 'text-gray-200' : 'text-gray-700'}`}>
                      {filled ? prev : '·'}
                    </td>
                    <td className={`py-0.5 pr-3 transition-colors ${filled ? 'text-gray-200' : 'text-gray-700'}`}>
                      {filled ? next : '·'}
                    </td>
                    <td className={`py-0.5 transition-colors ${filled ? 'text-neon-orange' : 'text-gray-700'}`}>
                      {filled ? (isBoundary ? '−1 ⟵ postset' : '—') : '·'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          title="replay-preset"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">slots stamped {stepperLabel(step, total)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {done
          ? 'Local skeletons ready on every rank — same tables everywhere, because every rank folded the same agreed graph. The −1 slots at each ring boundary are where postset will splice the next node in.'
          : 'Each rank stamps prev/next from the agreed intra order — purely local, no communication…'}
      </div>
    </div>
  )
}
