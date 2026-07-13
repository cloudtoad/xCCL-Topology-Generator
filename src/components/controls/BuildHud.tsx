// The evaluation HUD — what the search is trying RIGHT NOW, against what it
// already has, against the ceiling it's chasing. The side-box for the ladder
// phase: attempt constraints + outcome, incumbent best, optimality target.
import { useMemo } from 'react'
import { useBuildStore } from '../../store/build-store'
import { useTopologyStore } from '../../store/topology-store'
import { buildStateAt } from '../../engine/ring-build-trace'
import { PATH_TYPE_STR } from '../../engine/log-replay'

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${accent ?? 'text-gray-200'}`}>{value}</span>
    </div>
  )
}

export function BuildHud() {
  const trace = useBuildStore((s) => s.trace)
  const idx = useBuildStore((s) => s.idx)
  const displaySystem = useTopologyStore((s) => s.system)
  const buildSystem = useTopologyStore((s) => s.buildSystem)
  const system = buildSystem ?? displaySystem

  const state = useMemo(() => (trace ? buildStateAt(trace, idx) : null), [trace, idx])
  if (!trace || !state || !system) return null

  const a = state.lastAttempt
  const best = state.best
  const acc = state.accepted
  const ceiling = system.totalBw
  const bestTotal = best ? best.nChannels * best.speed : 0
  const inter = system.inter

  return (
    <div className="absolute top-4 left-4 w-64 rounded border border-surface-600 bg-surface-900/90 backdrop-blur px-3 py-2 text-[10px] space-y-1.5">
      <div className="text-gray-400 uppercase tracking-wider text-[9px]">
        {state.phaseLabel || 'search'}
      </div>

      {a && !acc && (
        <>
          <div className="border-l-2 border-neon-yellow/60 pl-2 space-y-0.5">
            <div className="text-neon-yellow text-[9px] uppercase tracking-wider">
              Attempt {a.n} — trying
            </div>
            <Row label="speed" value={`${a.speed} GB/s`} />
            <Row label="sameChannels" value={String(a.sameChannels)} />
            <Row label="typeIntra ≤" value={PATH_TYPE_STR[a.typeIntra] ?? String(a.typeIntra)} />
            {inter && (
              <Row label="typeInter ≤" value={PATH_TYPE_STR[a.typeInter] ?? String(a.typeInter)} />
            )}
            {inter && <Row label="crossNic" value={String(a.crossNic)} />}
            <Row
              label="found"
              value={`${a.found} ch → ${a.kept ? 'KEPT' : 'discarded'}`}
              accent={a.kept ? 'text-neon-green' : 'text-gray-500'}
            />
          </div>

          <div className="border-l-2 border-neon-cyan/60 pl-2 space-y-0.5">
            <div className="text-neon-cyan text-[9px] uppercase tracking-wider">Incumbent best</div>
            {best ? (
              <Row
                label={`${best.nChannels} ch × ${best.speed}`}
                value={`${bestTotal.toFixed(0)} GB/s`}
                accent="text-neon-cyan"
              />
            ) : (
              <div className="text-gray-600">none yet — anything counts</div>
            )}
            <Row
              label="optimality ceiling"
              value={`${ceiling.toFixed(0)} GB/s`}
              accent={bestTotal >= ceiling ? 'text-neon-green' : 'text-gray-400'}
            />
            <div className="text-gray-600 text-[9px]">
              keep-if-better: nCh × bw · stop at ceiling (search.cc:445-461, :1135)
            </div>
          </div>
        </>
      )}

      {acc && (
        <div className="border-l-2 border-neon-green/60 pl-2 space-y-0.5">
          <div className="text-neon-green text-[9px] uppercase tracking-wider">Accepted</div>
          <Row label="channels" value={String(acc.nChannels)} />
          <Row label="speed" value={`${acc.speed} GB/s`} />
          <Row label="sameChannels" value={String(acc.sameChannels)} />
          <Row label="typeIntra" value={PATH_TYPE_STR[acc.typeIntra] ?? String(acc.typeIntra)} />
          {inter && (
            <Row label="typeInter" value={PATH_TYPE_STR[acc.typeInter] ?? String(acc.typeInter)} />
          )}
          <div className="text-gray-600 text-[9px]">params locked — construction replay below</div>
        </div>
      )}
    </div>
  )
}
