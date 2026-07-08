// The three rendezvous stores, side by side — one KVS shape, three ecosystems,
// zero shared bytes. Rows reveal in sequence; the auth row is the punchline.
import { useStepper, stepperLabel } from '../useStepper'

const STORES = ['PMI / PMIx', 'NCCL bootstrap', 'c10d TCPStore']
const STORE_COLORS = ['#00ff41', '#00ffff', '#ff00ff']

const ROWS: { label: string; cells: string[]; colors?: string[] }[] = [
  { label: 'born', cells: ['1990s machine room', '2015+ NVIDIA', '2017+ PyTorch'] },
  { label: 'shape', cells: ['put / fence / get', 'root check-in → socket ring + address book', 'set / blocking-get / CAS'] },
  { label: 'server', cells: ['per-node daemon in the RM', 'transient root thread, then peer ring', 'one process binds a port'] },
  { label: 'wire', cells: ['ASCII w/ version → typed versioned binary', 'memcpy\'d C structs, unversioned', 'private binary opcodes, unversioned'] },
  {
    label: 'auth',
    cells: ['MUNGE / uid handshake', 'random 64-bit magic', 'NONE'],
    colors: ['#00ff41', '#ffff00', '#ff0040'],
  },
  { label: 'elastic', cells: ['no — worlds immutable', 'no — comms die whole', 'yes — its reason to exist'] },
]

export function TrilogyFig() {
  const { step, reset } = useStepper(ROWS.length, 900)
  const done = step >= ROWS.length

  return (
    <div className="font-mono text-[11px]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="py-1 pr-3 w-16"></th>
            {STORES.map((s, i) => (
              <th key={s} className="py-1 px-2 font-bold text-left" style={{ color: STORE_COLORS[i] }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, ri) => {
            const visible = ri < step
            const isAuth = r.label === 'auth'
            return (
              <tr
                key={r.label}
                className={`border-t border-surface-600 transition-opacity duration-300 ${isAuth && visible ? 'bg-neon-red/5' : ''}`}
                style={{ opacity: visible ? 1 : 0.12 }}
              >
                <td className="py-1.5 pr-3 text-gray-500">{r.label}</td>
                {r.cells.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-1.5 px-2 ${isAuth ? 'font-bold' : 'text-gray-300'}`}
                    style={isAuth && r.colors ? { color: r.colors[ci] } : undefined}
                  >
                    {visible ? cell : '·'}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          title="replay-trilogy"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">{stepperLabel(step, ROWS.length)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-orange' : 'text-gray-400'}`}>
        {done
          ? 'Each store was born in a MORE hostile environment and shipped with LESS session security. Three stores, one job description, zero shared bytes — session establishment as private implementation detail, three times over.'
          : 'The same key-value rendezvous, independently rebuilt by three ecosystems…'}
      </div>
    </div>
  )
}
