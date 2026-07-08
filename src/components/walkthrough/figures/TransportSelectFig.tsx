// selectTransport (transport.cc:15-42): walk the ordered transport list,
// first canConnect wins — administrative distance for the data plane.
import { useStepper, stepperLabel } from '../useStepper'

const LIST = ['p2p', 'shm', 'net', 'collNet'] as const

// The two canonical walks: same-node neighbors and cross-node ring stitch.
const WALKS = [
  {
    pair: 'rank 0 → rank 1 (same node)',
    checks: [{ t: 'p2p', ok: true, why: 'NVLink path exists, same hostHash' }],
    result: 'P2P',
    color: '#00ffff',
  },
  {
    pair: 'rank 3 → rank 4 (cross node, the stitch)',
    checks: [
      { t: 'p2p', ok: false, why: 'different hostHash — no NVLink/PCIe path' },
      { t: 'shm', ok: false, why: 'different host — no shared memory' },
      { t: 'net', ok: true, why: 'NIC reachable on both ends (rail 0)' },
    ],
    result: 'NET',
    color: '#ff6600',
  },
]

const TOTAL = WALKS.reduce((a, w) => a + w.checks.length, 0) + 1 // +1 matrix reveal

const N = 8
function cellTransport(a: number, b: number): 'self' | 'p2p' | 'net' {
  if (a === b) return 'self'
  return Math.floor(a / 4) === Math.floor(b / 4) ? 'p2p' : 'net'
}

export function TransportSelectFig() {
  const { step, reset } = useStepper(TOTAL, 1000)
  const done = step >= TOTAL
  let consumed = 0

  return (
    <div className="font-mono text-[11px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-500">ncclTransports[] :</span>
        {LIST.map((t, i) => (
          <span key={t} className="flex items-center gap-2">
            <span className="px-2 py-0.5 border border-surface-600 rounded text-gray-300">{t}</span>
            {i < LIST.length - 1 && <span className="text-gray-600">→</span>}
          </span>
        ))}
        <span className="text-gray-600 ml-1">(first canConnect wins)</span>
      </div>

      <div className="space-y-2 mb-3">
        {WALKS.map((w) => {
          const start = consumed
          consumed += w.checks.length
          const shown = Math.max(0, Math.min(step - start, w.checks.length))
          const decided = shown === w.checks.length && step > start
          return (
            <div key={w.pair} className="border border-surface-600 rounded p-2">
              <div className="text-gray-300 mb-1">
                {w.pair}
                {decided && (
                  <span className="ml-2 font-bold" style={{ color: w.color }}>
                    → {w.result}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {w.checks.slice(0, shown).map((c) => (
                  <div key={c.t} className="flex gap-2">
                    <span className={c.ok ? 'text-neon-green' : 'text-neon-red'}>
                      {c.ok ? '✓' : '✗'} {c.t}.canConnect
                    </span>
                    <span className="text-gray-500">— {c.why}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* full pair matrix */}
      <div className="flex gap-4 items-start" style={{ opacity: done ? 1 : 0.15 }}>
        <table className="border-collapse">
          <tbody>
            <tr>
              <td />
              {Array.from({ length: N }, (_, c) => (
                <td key={c} className="text-gray-500 text-center w-6 pb-1">{c}</td>
              ))}
            </tr>
            {Array.from({ length: N }, (_, r) => (
              <tr key={r}>
                <td className="text-gray-500 pr-1 text-right">{r}</td>
                {Array.from({ length: N }, (_, c) => {
                  const t = cellTransport(r, c)
                  return (
                    <td key={c} className="p-0">
                      <div
                        className="w-6 h-6 border border-surface-900"
                        style={{
                          backgroundColor:
                            t === 'self' ? '#0a0a0f' : t === 'p2p' ? 'rgba(0,255,255,0.35)' : 'rgba(255,102,0,0.35)',
                        }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-gray-500 space-y-1 pt-4">
          <div><span className="inline-block w-3 h-3 align-[-2px] mr-1" style={{ backgroundColor: 'rgba(0,255,255,0.35)' }} /> P2P (intra-node)</div>
          <div><span className="inline-block w-3 h-3 align-[-2px] mr-1" style={{ backgroundColor: 'rgba(255,102,0,0.35)' }} /> NET (cross-node)</div>
          <div className="text-gray-600 max-w-[180px]">Only ring/tree neighbors actually connect — the matrix shows what selection WOULD yield per pair.</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          title="replay-transport"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">checks {stepperLabel(step, TOTAL)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {done
          ? 'Admin distance for the data plane: an ordered preference list, first eligible source wins. NET pairs then become IB queue pairs — nChannels × nNodes × NCCL_IB_QPS_PER_CONNECTION.'
          : 'Walking the list per channel-peer pair (transport.cc:27-42)…'}
      </div>
    </div>
  )
}
