// The L2 ladder must be fully reconstructible from the trace alone:
// (a) the ordered rung chain, (b) the accepted parameters, (c) attempt
// boundaries, (d) the Phase-2 climb. These power the lineage L2 nodes
// and the Atlas cross-links.
import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'

const env = createDefaultEnvConfig()

describe('trace reconstruction (station 60)', () => {
  const single = runInit(dgxH100Config, env)
  const two = runInit(dgxH100Config, env, {
    serverCount: 2, railCount: 8, networkType: 'rail-optimized',
  })

  test('attempt boundaries exist and carry full constraint sets', () => {
    for (const r of [single, two]) {
      const attempts = r.ringBuildTrace!.events.filter((e) => e.kind === 'attempt')
      expect(attempts.length).toBeGreaterThanOrEqual(1)
      const first = attempts[0] as Extract<typeof attempts[0], { kind: 'attempt' }>
      expect(first.n).toBe(1)
      expect(first.sameChannels).toBe(1) // strictest first
    }
  })

  test('exactly one accepted event; params match the final graph', () => {
    for (const r of [single, two]) {
      const accepted = r.ringBuildTrace!.events.filter((e) => e.kind === 'accepted')
      expect(accepted.length).toBe(1)
    }
    const acc = single.ringBuildTrace!.events.find((e) => e.kind === 'accepted') as
      Extract<import('./ring-build-trace').RingBuildEvent, { kind: 'accepted' }>
    const dup = single.ringBuildTrace!.events.find((e) => e.kind === 'dup') as
      | Extract<import('./ring-build-trace').RingBuildEvent, { kind: 'dup' }> | undefined
    // accepted records the PRE-dup search; dup + done bridge to the final graph
    if (dup) {
      expect(acc.nChannels).toBe(dup.fromChannels)
      expect(dup.toChannels).toBe(single.ringGraph.nChannels)
    } else {
      expect(acc.nChannels).toBe(single.ringGraph.nChannels)
    }
  })

  test('2-node: accepted has sameChannels=0 (the sacrificed replay) and crossNic=0', () => {
    const acc = two.ringBuildTrace!.events.find((e) => e.kind === 'accepted') as
      Extract<import('./ring-build-trace').RingBuildEvent, { kind: 'accepted' }>
    expect(acc.sameChannels).toBe(0)
    expect(acc.crossNic).toBe(0)
    expect(acc.nChannels).toBe(8)
    expect(acc.speed).toBe(20)
  })

  test('rung chain: relax events form an ordered ladder before acceptance', () => {
    const events = two.ringBuildTrace!.events
    const acceptedIdx = events.findIndex((e) => e.kind === 'accepted')
    const rungs = events.slice(0, acceptedIdx).filter((e) => e.kind === 'relax')
    expect(rungs.length).toBeGreaterThanOrEqual(1)
    // 2-node fires sameChannels→0 (the validated experiment)
    expect(rungs.some((r) => (r as { action: string }).action.includes('sameChannels'))).toBe(true)
  })

  test('Phase 2 climb is traced where headroom exists, and never improves the anchors', () => {
    // Single-server H100: solution 12ch@30 sits BELOW the entry speed (60) —
    // the climb runs (real pass-2 gate: time != 0) and every rung fails.
    const improves = single.ringBuildTrace!.events.filter((e) => e.kind === 'improve')
    expect(improves.length).toBeGreaterThanOrEqual(1)
    for (const imp of improves) {
      expect((imp as { kept: boolean }).kept).toBe(false) // goldens must not shift
    }
    // 2-node: solution 8ch@20 IS the entry rung (maxBw on the NET view = 20)
    // — no headroom, no climb. Faithful: pass 2 climbs only up to speedIndex.
    const twoImproves = two.ringBuildTrace!.events.filter((e) => e.kind === 'improve')
    expect(twoImproves.length).toBe(0)
  })
})
