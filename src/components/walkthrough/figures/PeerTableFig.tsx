// AllGather1: the peer table filling in as ncclPeerInfo circulates the
// bootstrap ring (init.cc:1034-1067). Node membership = hostHash equality.
import { useStepper, stepperLabel } from '../useStepper'

const N = 8
const PEERS = Array.from({ length: N }, (_, r) => ({
  rank: r,
  busId: `0000:${(0x1a + (r % 4) * 0x20).toString(16).padStart(2, '0')}:00.0`,
  hostHash: r < 4 ? '9c41f0aa07d2' : '3e88b1c55f19',
  hostColor: r < 4 ? '#00ff41' : '#ff00ff',
  cudaDev: r % 4,
}))

export function PeerTableFig() {
  const { step, reset } = useStepper(N, 700)
  const done = step >= N

  return (
    <div className="font-mono text-[11px]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-gray-500 text-left">
            <th className="py-1 pr-3 font-normal">rank</th>
            <th className="py-1 pr-3 font-normal">busId</th>
            <th className="py-1 pr-3 font-normal">hostHash</th>
            <th className="py-1 pr-3 font-normal">cudaDev</th>
            <th className="py-1 font-normal">node</th>
          </tr>
        </thead>
        <tbody>
          {PEERS.map((p) => {
            const visible = p.rank < step
            return (
              <tr
                key={p.rank}
                className="border-t border-surface-600 transition-opacity duration-300"
                style={{ opacity: visible ? 1 : 0.12 }}
              >
                <td className="py-1 pr-3 text-neon-cyan">{p.rank}</td>
                <td className="py-1 pr-3 text-gray-400">{visible ? p.busId : '—'}</td>
                <td className="py-1 pr-3" style={{ color: p.hostColor }}>
                  {visible ? p.hostHash : '—'}
                </td>
                <td className="py-1 pr-3 text-gray-300">{visible ? p.cudaDev : '—'}</td>
                <td className="py-1" style={{ color: p.hostColor }}>
                  {done ? (p.rank < 4 ? 'node 0' : 'node 1') : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          title="replay-allgather1"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">gathered {stepperLabel(step, N)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-green' : 'text-gray-400'}`}>
        {done
          ? 'Two distinct hostHashes → nNodes = 2. Nobody configured this — hostHash = hash(hostname + boot_id), and "my node" is everyone who shares mine.'
          : 'bootstrapAllGather circulates each rank’s ncclPeerInfo around the socket ring…'}
      </div>
    </div>
  )
}
