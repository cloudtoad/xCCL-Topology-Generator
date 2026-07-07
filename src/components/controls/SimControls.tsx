import { useSimStore } from '../../store/sim-store'

/** Transport bar for the sim player — play/pause, step, scrub. */
export function SimControls() {
  const trace = useSimStore((s) => s.trace)
  const step = useSimStore((s) => s.step)
  const playing = useSimStore((s) => s.playing)
  const playPause = useSimStore((s) => s.playPause)
  const seek = useSimStore((s) => s.seek)
  const reset = useSimStore((s) => s.reset)

  if (!trace) return null

  const phaseSteps = trace.nRanks - 1
  const label =
    step >= trace.totalSteps
      ? 'complete'
      : step < phaseSteps
        ? `reduce-scatter ${step + 1}/${phaseSteps}`
        : `all-gather ${step - phaseSteps + 1}/${phaseSteps}`

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded border border-surface-600 bg-surface-900/90 backdrop-blur">
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
        max={trace.totalSteps}
        value={step}
        onChange={(e) => seek(Number(e.target.value))}
        className="w-48 accent-cyan-400"
        title="Scrub"
      />

      <span className="text-[11px] text-gray-400 w-40 text-left tabular-nums">
        step {step}/{trace.totalSteps} · {label}
      </span>
    </div>
  )
}
