import { useSimStore } from '../../store/sim-store'

/** Transport bar for the sim player — play/pause, step, scrub. */
export function SimControls() {
  const trace = useSimStore((s) => s.trace)
  const clusterTrace = useSimStore((s) => s.clusterTrace)
  const step = useSimStore((s) => s.step)
  const playing = useSimStore((s) => s.playing)
  const playPause = useSimStore((s) => s.playPause)
  const simMode = useSimStore((s) => s.simMode)
  const setSimMode = useSimStore((s) => s.setSimMode)
  const seek = useSimStore((s) => s.seek)
  const reset = useSimStore((s) => s.reset)

  if (!trace && !clusterTrace) return null

  const total = clusterTrace ? clusterTrace.nSteps : trace!.totalSteps
  let label: string
  if (step >= total) {
    label = 'complete'
  } else if (clusterTrace) {
    label = `all-gather ${step + 1}/${total} · ${clusterTrace.nRanks} GPUs`
  } else {
    const phaseSteps = trace!.nRanks - 1
    label =
      step < phaseSteps
        ? `reduce-scatter ${step + 1}/${phaseSteps}`
        : `all-gather ${step - phaseSteps + 1}/${phaseSteps}`
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded border border-surface-600 bg-surface-900/90 backdrop-blur">
      <div className="flex gap-1 mr-1">
        <button
          onClick={() => setSimMode('cluster')}
          title="sim-mode-cluster"
          className={`px-2 py-0.5 text-[10px] rounded border ${simMode === 'cluster' ? 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10' : 'text-gray-500 border-surface-600'}`}
        >
          cluster · 32
        </button>
        <button
          onClick={() => setSimMode('toy')}
          title="sim-mode-toy"
          className={`px-2 py-0.5 text-[10px] rounded border ${simMode === 'toy' ? 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10' : 'text-gray-500 border-surface-600'}`}
        >
          toy · 4
        </button>
      </div>
      <button onClick={reset} title="Reset" className="btn-secondary text-xs px-2">
        ⏮
      </button>
      <button onClick={() => seek(step - 1)} title="Step back" className="btn-secondary text-xs px-2">
        ◀
      </button>
      <button
        onClick={playPause}
        title={playing ? 'Pause' : 'Play'}
        className="btn-secondary text-sm px-3 text-neon-cyan border-neon-cyan/30"
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={() => seek(step + 1)} title="Step forward" className="btn-secondary text-xs px-2">
        ▶|
      </button>

      <input
        type="range"
        min={0}
        max={total}
        value={step}
        onChange={(e) => seek(Number(e.target.value))}
        className="w-48 accent-cyan-400"
        title="Scrub"
      />

      <span className="text-[11px] text-gray-400 w-40 text-left tabular-nums">
        step {step}/{total} · {label}
      </span>
    </div>
  )
}
