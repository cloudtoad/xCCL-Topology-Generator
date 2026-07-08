// Layer P−1 / P−0.5: nobody distributes your code; three spawn mechanisms.
const COLS = [
  {
    name: 'Slurm',
    color: '#00ffff',
    placement: 'shared FS (sbcast otherwise)',
    spawn: 'persistent slurmd + MUNGE-auth RPCs → slurmstepd forks tasks',
    standing: 'daemons predate the job',
  },
  {
    name: 'MPI runtimes',
    color: '#00ff41',
    placement: 'shared FS assumed',
    spawn: 'ssh-spawned daemon tree (orted/prted/hydra) + OOB TCP mesh',
    standing: 'daemons live for one job',
  },
  {
    name: 'torchrun / K8s',
    color: '#ff00ff',
    placement: 'image pull — the container era\'s code distribution',
    spawn: 'none — BYO agents (sbatch, pdsh, operator pod spec)',
    standing: 'agents are your problem',
  },
]

export function GroundZeroFig() {
  return (
    <div className="font-mono text-[11px]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="py-1 pr-3 font-normal text-gray-500 text-left w-24"></th>
            {COLS.map((c) => (
              <th key={c.name} className="py-1 px-2 font-bold text-left" style={{ color: c.color }}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-surface-600">
            <td className="py-1.5 pr-3 text-gray-500">code gets there</td>
            {COLS.map((c) => (
              <td key={c.name} className="py-1.5 px-2 text-gray-300">{c.placement}</td>
            ))}
          </tr>
          <tr className="border-t border-surface-600">
            <td className="py-1.5 pr-3 text-gray-500">processes start</td>
            {COLS.map((c) => (
              <td key={c.name} className="py-1.5 px-2 text-gray-300">{c.spawn}</td>
            ))}
          </tr>
          <tr className="border-t border-surface-600">
            <td className="py-1.5 pr-3 text-gray-500">who keeps it up</td>
            {COLS.map((c) => (
              <td key={c.name} className="py-1.5 px-2 text-gray-400">{c.standing}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="mt-3 text-gray-500">
        No launcher copies your binary per-job — sameness is <span className="text-gray-300">infrastructural</span> (one
        filesystem, one image). Sameness violations launch fine and surface two phases later as the
        version-mismatch WARN.
      </div>
    </div>
  )
}
