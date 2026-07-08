// The rank↔device binding table — decided by the launcher before NCCL runs.
const ROWS = [
  { rank: 0, host: 'host-a', local: 0 },
  { rank: 1, host: 'host-a', local: 1 },
  { rank: 2, host: 'host-a', local: 2 },
  { rank: 3, host: 'host-a', local: 3 },
  { rank: 4, host: 'host-b', local: 0 },
  { rank: 5, host: 'host-b', local: 1 },
  { rank: 6, host: 'host-b', local: 2 },
  { rank: 7, host: 'host-b', local: 3 },
]

export function LaunchFig() {
  return (
    <div className="font-mono text-[11px]">
      <div className="text-gray-500 mb-2">
        torchrun --nnodes 2 --nproc-per-node 4 train.py
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-gray-500 text-left">
            <th className="py-1 pr-4 font-normal">RANK</th>
            <th className="py-1 pr-4 font-normal">host</th>
            <th className="py-1 pr-4 font-normal">LOCAL_RANK</th>
            <th className="py-1 font-normal">binding</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.rank} className="border-t border-surface-600">
              <td className="py-1 pr-4 text-neon-cyan">{r.rank}</td>
              <td className={`py-1 pr-4 ${r.host === 'host-a' ? 'text-neon-green' : 'text-neon-magenta'}`}>
                {r.host}
              </td>
              <td className="py-1 pr-4 text-gray-300">{r.local}</td>
              <td className="py-1 text-gray-400">cudaSetDevice({r.local})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-gray-500">
        Global RANK is the communicator identity; LOCAL_RANK picks the GPU. Every
        &ldquo;scrambled&rdquo; ring printout is read through this table.
      </div>
    </div>
  )
}
