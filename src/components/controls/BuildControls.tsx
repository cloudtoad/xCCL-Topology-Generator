import { useBuildStore } from '../../store/build-store'
import type { RingBuildEvent } from '../../engine/ring-build-trace'

/** One human sentence per build event — the walkthrough's narration voice. */
function prose(e: RingBuildEvent | null): string {
  if (!e) return 'Ready — step through how the search constructs the rings.'
  switch (e.kind) {
    case 'phase':
      return `${e.label}: ${e.detail}  (${e.sourceRef})`
    case 'speed':
      return `Trying ${e.speed} GB/s per channel — ${e.detail}.`
    case 'relax':
      return `No solution yet → relax: ${e.action} (${e.reason}, ${e.sourceRef}).`
    case 'attempt':
      return `Attempt ${e.n} @ ${e.speed} GB/s (sameCh=${e.sameChannels}, typeIntra≤${e.typeIntra}, typeInter≤${e.typeInter}, crossNic=${e.crossNic}) → found ${e.found} channel${e.found === 1 ? '' : 's'} — ${e.kept ? 'NEW BEST, kept' : 'not better, discarded'}.`
    case 'accepted':
      return `ACCEPTED: ${e.nChannels} channels @ ${e.speed} GB/s (sameChannels=${e.sameChannels}, crossNic=${e.crossNic}) — parameters locked; replaying construction.`
    case 'improve':
      return e.kept
        ? `Phase 2 climb: ${e.fromSpeed} → ${e.toSpeed} GB/s sustained the locked channel count — solution improved.`
        : `Phase 2 climb to ${e.toSpeed} GB/s could not hold the channel count — kept ${e.fromSpeed} GB/s (search.cc:1267-1283).`
    case 'channel-start':
      if (e.net)
        return e.reused
          ? `Channel ${e.channel}: enter from ${e.net.replace('net-', 'NET ')} (NIC rotation, search.cc:735) — try replaying the previous ordering first.`
          : `Channel ${e.channel}: enter from ${e.net.replace('net-', 'NET ')} at its rail's local GPU ${e.startGpu.replace('gpu-', '')} @ ${e.speed} GB/s (search.cc:791).`
      return e.reused
        ? `Channel ${e.channel}: reuse channel 0's ordering (sameChannels=1) if bandwidth remains.`
        : `Channel ${e.channel}: start a fresh ring at ${e.startGpu} @ ${e.speed} GB/s.`
    case 'consider': {
      const c = e.candidates
        .map((x) => `${x.id.replace('gpu-', 'G')}(${x.intraBw.toFixed(0)}GB/s,${x.intraNhops}h)`)
        .join(' > ')
      return `From ${e.from.replace('gpu-', 'GPU ')}: candidates by tiebreaker cascade — ${c}. Choose ${e.chosen.replace('gpu-', 'GPU ')}.`
    }
    case 'hop':
      return `${e.from.replace('gpu-', 'GPU ')} → ${e.to.replace('gpu-', 'GPU ')}: consume bandwidth, ${e.before.toFixed(1)} → ${e.after.toFixed(1)} GB/s left on that route.`
    case 'backtrack':
      return `Dead end at ${e.at.replace('gpu-', 'GPU ')} — no feasible next hop. Backtrack to ${e.backTo.replace('gpu-', 'GPU ')} and restore the bandwidth.`
    case 'close':
      return `Ring ${e.channel} closes: ${e.from.replace('gpu-', 'GPU ')} → ${e.to.replace('gpu-', 'GPU ')} completes the Hamiltonian cycle.`
    case 'channel-done': {
      const chain = e.order.map((g) => g.replace('gpu-', '')).join(' → ')
      if (e.netIn)
        return `Channel ${e.channel} locked in: ${e.netIn.replace('net-', 'NET ')} → ${chain} → ${(e.netOut ?? e.netIn).replace('net-', 'NET ')}${e.netOut && e.netOut !== e.netIn ? ' (crossNic!)' : ''} — exits to the far node; the stitch closes the global ring (search.cc:816-830).`
      return `Channel ${e.channel} locked in: ${chain} — the row is now in ring order; the wrap arc closes the cycle.`
    }
    case 'dup':
      return `DupChannels: bandwidth allows doubling — ${e.fromChannels} rings × ${e.bwBefore} GB/s become ${e.toChannels} × ${e.bwAfter} GB/s (${e.sourceRef}).`
    case 'done':
      return `Search complete: ${e.nChannels} ring channels @ ${e.speed} GB/s per channel.`
  }
}

/** Transport + narration bar for the ring-construction walkthrough. */
export function BuildControls() {
  const trace = useBuildStore((s) => s.trace)
  const idx = useBuildStore((s) => s.idx)
  const playing = useBuildStore((s) => s.playing)
  const playPause = useBuildStore((s) => s.playPause)
  const seek = useBuildStore((s) => s.seek)
  const advance = useBuildStore((s) => s.advance)
  const retreat = useBuildStore((s) => s.retreat)
  const reset = useBuildStore((s) => s.reset)
  const condensed = useBuildStore((s) => s.condensed)
  const stops = useBuildStore((s) => s.stops)
  const toggleCondensed = useBuildStore((s) => s.toggleCondensed)

  if (!trace) return null

  const last = idx > 0 ? trace.events[idx - 1] : null
  // stop we're on (or the nearest one at/behind us, after a raw seek)
  const stopPos = condensed
    ? stops.reduce((acc, s, i) => (s.idx <= idx ? i : acc), 0)
    : -1
  const atStop = condensed && stops[stopPos]?.idx === idx ? stops[stopPos] : null

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(46rem,90%)] rounded border border-surface-600 bg-surface-900/90 backdrop-blur px-4 py-2">
      {/* Narration */}
      <div className="text-[12px] text-gray-200 leading-snug min-h-[2.4em] mb-1.5">
        {prose(last)}
        {atStop?.note && (
          <div className="text-[11px] text-amber-300/90 mt-0.5">
            ⏩ {atStop.note}
            {atStop.skipped ? ` · ${atStop.skipped} repeated steps skipped` : ''}
          </div>
        )}
        {!atStop?.note && atStop?.skipped ? (
          <div className="text-[11px] text-amber-300/90 mt-0.5">
            ⏩ {atStop.skipped} repeated steps skipped
          </div>
        ) : null}
      </div>
      {/* Transport */}
      <div className="flex items-center gap-3">
        <button onClick={reset} title="Reset build" className="btn-secondary text-xs px-2">⏮</button>
        <button onClick={retreat} title="Previous step" className="btn-secondary text-xs px-2">◀</button>
        <button
          onClick={playPause}
          title={playing ? 'Pause build' : 'Play build'}
          className="btn-secondary text-sm px-3 text-neon-cyan border-neon-cyan/30"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={advance} title="Next step" className="btn-secondary text-xs px-2">▶|</button>
        {condensed ? (
          <input
            type="range"
            min={0}
            max={Math.max(0, stops.length - 1)}
            value={stopPos}
            onChange={(e) => seek(stops[Number(e.target.value)]?.idx ?? 0)}
            className="flex-1 accent-cyan-400"
            title="Scrub build (condensed stops)"
          />
        ) : (
          <input
            type="range"
            min={0}
            max={trace.events.length}
            value={idx}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 accent-cyan-400"
            title="Scrub build (every event)"
          />
        )}
        <span className="text-[11px] text-gray-400 tabular-nums text-right">
          {condensed ? `${stopPos}/${stops.length - 1}` : `${idx}/${trace.events.length}`}
        </span>
        <button
          onClick={toggleCondensed}
          title={
            condensed
              ? `Condensed: ${stops.length - 1} distinct steps of ${trace.events.length} events — repeats are jumped with a label. Click for the full trace.`
              : `Full trace: all ${trace.events.length} events, repeats included. Click to condense.`
          }
          className={`btn-secondary text-[10px] px-2 whitespace-nowrap ${condensed ? 'text-amber-300 border-amber-300/30' : 'text-gray-400'}`}
        >
          {condensed ? '⏩ condensed' : 'full trace'}
        </button>
      </div>
    </div>
  )
}
