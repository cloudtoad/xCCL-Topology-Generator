// =============================================================================
// Ring build trace — the deterministic replay must tell the true story
// =============================================================================

import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { buildStateAt } from './ring-build-trace'
import { dgxH100Config } from './templates/dgx-h100'

describe('ring build trace (DGX H100)', () => {
  const result = runInit(dgxH100Config, createDefaultEnvConfig())
  const trace = result.ringBuildTrace!

  test('trace exists and is compact', () => {
    expect(trace).not.toBeNull()
    expect(trace.events.length).toBeGreaterThan(10)
    expect(trace.truncated).toBe(false)
  })

  test('replayed channel orders match the final ring graph exactly', () => {
    const done = trace.events.filter((e) => e.kind === 'channel-done')
    // The replay reproduces the pre-DupChannels search (6 rings @ 60)...
    const dup = trace.events.find((e) => e.kind === 'dup')
    expect(dup).toBeDefined()
    if (dup?.kind === 'dup') {
      expect(dup.fromChannels).toBe(done.length)
      expect(dup.toChannels).toBe(result.ringGraph.nChannels) // ...doubled to 12
      expect(dup.bwAfter).toBe(result.ringGraph.speedIntra) // @ 30
    }
    // ...and each traced order equals the corresponding final channel's order.
    done.forEach((e, i) => {
      if (e.kind === 'channel-done') {
        expect(e.order).toEqual(result.ringGraph.channels[i].ringOrder)
      }
    })
  })

  test('hops consume bandwidth monotonically (after < before)', () => {
    for (const e of trace.events) {
      if (e.kind === 'hop') expect(e.after).toBeLessThan(e.before)
    }
  })

  test('consider events always choose a listed candidate', () => {
    for (const e of trace.events) {
      if (e.kind === 'consider') {
        expect(e.candidates.map((c) => c.id)).toContain(e.chosen)
        expect(e.candidates[0].rank).toBe(0)
      }
    }
  })

  test('buildStateAt folds to a complete final state', () => {
    const s = buildStateAt(trace, trace.events.length)
    const done = trace.events.filter((e) => e.kind === 'channel-done').length
    expect(s.closed.size).toBe(done)
    for (const [, order] of s.rings) expect(order).toHaveLength(8)
    expect(s.lastEvent?.kind).toBe('done')
  })

  test('buildStateAt at 0 is empty', () => {
    const s = buildStateAt(trace, 0)
    expect(s.rings.size).toBe(0)
    expect(s.lastEvent).toBeNull()
  })
})
