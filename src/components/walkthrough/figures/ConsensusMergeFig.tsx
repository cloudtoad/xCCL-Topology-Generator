// AllGather3 consensus: every rank's ring graphInfo tuple, merged column by
// column — min() on what you want more of, max() on what you want less of
// (init.cc:1438-1446). Rank 5 is a straggler (VM-flat topology) and drags
// the whole communicator down.
import { useStepper, stepperLabel } from '../useStepper'

interface Tuple {
  nChannels: number
  sameChannels: number
  bwIntra: number
  bwInter: number
  typeIntra: string
  typeInter: string
  crossNic: number
}

const HEALTHY: Tuple = { nChannels: 12, sameChannels: 1, bwIntra: 30, bwInter: 30, typeIntra: 'NVL', typeInter: 'PIX', crossNic: 0 }
const STRAGGLER: Tuple = { nChannels: 8, sameChannels: 0, bwIntra: 15, bwInter: 15, typeIntra: 'PXB', typeInter: 'PHB', crossNic: 1 }

const COLS: { key: keyof Tuple; rule: 'min' | 'max' }[] = [
  { key: 'nChannels', rule: 'min' },
  { key: 'sameChannels', rule: 'min' },
  { key: 'bwIntra', rule: 'min' },
  { key: 'bwInter', rule: 'min' },
  { key: 'typeIntra', rule: 'max' },
  { key: 'typeInter', rule: 'max' },
  { key: 'crossNic', rule: 'max' },
]

const RANKS = Array.from({ length: 8 }, (_, r) => ({
  rank: r,
  tuple: r === 5 ? STRAGGLER : HEALTHY,
}))

export function ConsensusMergeFig() {
  const { step, reset } = useStepper(COLS.length, 900)
  const done = step >= COLS.length

  return (
    <div className="font-mono text-[11px]">
      <table className="w-full border-collapse text-right">
        <thead>
          <tr className="text-gray-500">
            <th className="py-1 pr-2 font-normal text-left">rank</th>
            {COLS.map((c, i) => (
              <th
                key={c.key}
                className={`py-1 px-2 font-normal transition-colors ${i === step - 1 && !done ? 'text-neon-yellow' : ''}`}
              >
                {c.key}
                <div className={`text-[9px] ${c.rule === 'min' ? 'text-neon-cyan' : 'text-neon-orange'}`}>
                  {c.rule}()
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RANKS.map(({ rank, tuple }) => (
            <tr key={rank} className={`border-t border-surface-600 ${rank === 5 ? 'bg-neon-red/5' : ''}`}>
              <td className={`py-0.5 pr-2 text-left ${rank === 5 ? 'text-neon-red' : 'text-neon-cyan'}`}>
                {rank}{rank === 5 ? ' ⚠' : ''}
              </td>
              {COLS.map((c, i) => {
                const merged = i < step
                const isLoser = rank !== 5 && merged
                return (
                  <td
                    key={c.key}
                    className={`py-0.5 px-2 transition-colors duration-300 ${
                      merged ? (rank === 5 ? 'text-neon-yellow' : 'text-gray-600') : 'text-gray-300'
                    } ${i === step - 1 && !done && !isLoser ? 'bg-neon-yellow/10' : ''}`}
                  >
                    {tuple[c.key]}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className={`border-t-2 border-surface-600 ${done ? 'bg-neon-orange/10' : ''}`}>
            <td className="py-1 pr-2 text-left text-neon-orange">agreed</td>
            {COLS.map((c, i) => (
              <td key={c.key} className={`py-1 px-2 font-bold ${i < step ? 'text-neon-orange' : 'text-gray-700'}`}>
                {i < step ? STRAGGLER[c.key] : '·'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          title="replay-consensus"
          className="px-2 py-0.5 text-[10px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/40"
        >
          ↻ replay
        </button>
        <span className="text-gray-500">fields merged {stepperLabel(step, COLS.length)}</span>
      </div>
      <div className={`mt-2 min-h-[2.5em] ${done ? 'text-neon-orange' : 'text-gray-400'}`}>
        {done
          ? 'Seven healthy ranks now run 8 channels at 15 GB/s over PXB/PHB with crossNic — because ONE rank detected a flat topology. The communicator is only as strong as its weakest rank.'
          : 'Each rank publishes the tuple its own search produced; the merge walks the fields in order…'}
      </div>
    </div>
  )
}
