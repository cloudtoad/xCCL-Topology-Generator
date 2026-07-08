// The guided walkthrough — the full curriculum, ground zero → established,
// rendered as narrated beats with figures for the phases that have no 3D view.
import { CURRICULUM, type CurriculumBeat } from '../../walkthrough/curriculum'
import { useWalkthroughStore } from '../../store/walkthrough-store'
import { useUIStore, type ViewMode } from '../../store/ui-store'
import { LaunchFig } from './figures/LaunchFig'
import { UniqueIdFig } from './figures/UniqueIdFig'
import { BootstrapRingFig } from './figures/BootstrapRingFig'
import { PeerTableFig } from './figures/PeerTableFig'
import { ConsensusMergeFig } from './figures/ConsensusMergeFig'
import { GroundZeroFig } from './figures/GroundZeroFig'
import { TrilogyFig } from './figures/TrilogyFig'
import { ConvergenceFig } from './figures/ConvergenceFig'
import { PresetFig } from './figures/PresetFig'
import { PostsetFig } from './figures/PostsetFig'
import { TransportSelectFig } from './figures/TransportSelectFig'

const FIGURES: Record<string, React.ComponentType> = {
  'ground-zero': GroundZeroFig,
  'three-stores': TrilogyFig,
  convergence: ConvergenceFig,
  launch: LaunchFig,
  rendezvous: UniqueIdFig,
  'bootstrap-ring': BootstrapRingFig,
  allgather1: PeerTableFig,
  consensus: ConsensusMergeFig,
  preset: PresetFig,
  postset: PostsetFig,
  'transport-select': TransportSelectFig,
}

// Curriculum view bindings → app view modes ('decisions' opens the info panel).
const VIEW_TARGET: Record<string, { mode?: ViewMode; label: string }> = {
  physical: { mode: 'physical', label: 'Physical view' },
  build: { mode: 'build', label: 'Build walkthrough' },
  sim: { mode: 'sim', label: 'Sim player' },
  decisions: { label: 'Decisions log' },
}

function BeatCard({ beat }: { beat: CurriculumBeat }) {
  const setViewMode = useUIStore((s) => s.setViewMode)
  const setInfoPanel = useUIStore((s) => s.setInfoPanel)
  const Figure = FIGURES[beat.id]
  const target = beat.view && beat.view !== 'walkthrough' ? VIEW_TARGET[beat.view] : null

  return (
    <div className="max-w-3xl">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg text-gray-100 font-medium">{beat.title}</h2>
        <span className="font-mono text-[10px] text-gray-500 border border-surface-600 rounded px-1.5 py-0.5">
          {beat.sourceRef}
        </span>
      </div>

      <p className="text-[13px] text-gray-300 leading-relaxed mb-4">{beat.narration}</p>

      {Figure && (
        <div className="border border-surface-600 rounded-lg p-4 mb-4 bg-surface-800 overflow-x-auto">
          <Figure />
        </div>
      )}

      <div className="space-y-2 text-[12px]">
        <div className="border-l-2 border-neon-cyan/60 pl-3 py-1">
          <span className="text-neon-cyan text-[10px] uppercase tracking-wider">The analog</span>
          <p className="text-gray-400">{beat.analogy}</p>
        </div>
        {beat.showCommand && (
          <div className="border-l-2 border-neon-green/60 pl-3 py-1">
            <span className="text-neon-green text-[10px] uppercase tracking-wider">Observable</span>
            <p className="text-gray-400 font-mono text-[11px]">{beat.showCommand}</p>
          </div>
        )}
        <div className="border-l-2 border-neon-orange/60 pl-3 py-1">
          <span className="text-neon-orange text-[10px] uppercase tracking-wider">When it breaks</span>
          <p className="text-gray-400">{beat.failureSignature}</p>
        </div>
      </div>

      {target && (
        <button
          onClick={() => {
            if (target.mode) setViewMode(target.mode)
            else setInfoPanel('decisions')
          }}
          title={`open-${beat.view}`}
          className="mt-4 px-3 py-1.5 text-[11px] border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
        >
          Demonstrated live → {target.label}
        </button>
      )}
    </div>
  )
}

export function WalkthroughView() {
  const { moduleIdx, beatIdx, setBeat, next, prev } = useWalkthroughStore()
  const module = CURRICULUM[moduleIdx]
  const beat = module.beats[beatIdx]
  const isFirst = moduleIdx === 0 && beatIdx === 0
  const isLast =
    moduleIdx === CURRICULUM.length - 1 && beatIdx === module.beats.length - 1

  return (
    <div className="absolute inset-0 flex bg-surface-900 overflow-hidden">
      {/* syllabus nav */}
      <div className="w-72 flex-shrink-0 border-r border-surface-600 overflow-y-auto p-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
          Init → established
        </div>
        {CURRICULUM.map((m, mi) => (
          <div key={m.id} className="mb-2">
            <div
              className={`text-[11px] font-medium ${mi === moduleIdx ? 'text-gray-200' : 'text-gray-500'}`}
            >
              {mi + 1}. {m.title}
            </div>
            <div className="ml-3 mt-0.5 space-y-0.5">
              {m.beats.map((b, bi) => {
                const active = mi === moduleIdx && bi === beatIdx
                return (
                  <button
                    key={b.id}
                    onClick={() => setBeat(mi, bi)}
                    title={`beat-${b.id}`}
                    className={`block w-full text-left text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                      active
                        ? 'text-neon-cyan bg-neon-cyan/10'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {b.title}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* beat content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-4 pb-2 border-b border-surface-600">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
            Module {moduleIdx + 1} · {module.title}
          </div>
          <div className="text-[11px] text-gray-400 italic">{module.analogy}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <BeatCard beat={beat} />
        </div>
        <div className="px-6 py-3 border-t border-surface-600 flex items-center gap-3">
          <button
            onClick={prev}
            disabled={isFirst}
            title="walkthrough-prev"
            className="px-3 py-1 text-[11px] border border-surface-600 rounded text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <button
            onClick={next}
            disabled={isLast}
            title="walkthrough-next"
            className="px-3 py-1 text-[11px] border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
          <span className="text-[10px] text-gray-600 font-mono ml-auto">
            {CURRICULUM.slice(0, moduleIdx).reduce((a, m) => a + m.beats.length, 0) + beatIdx + 1}
            {' / '}
            {CURRICULUM.reduce((a, m) => a + m.beats.length, 0)}
          </span>
        </div>
      </div>
    </div>
  )
}
