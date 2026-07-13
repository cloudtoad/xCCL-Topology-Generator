// Condensed playback must compress choreography repeats WITHOUT losing a
// single decisive moment: every kept attempt, the accepted solution, every
// finished channel, every backtrack, dup and done all survive. And it must
// be honest: skipped counts account for every elided event.
import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'
import { condenseTrace } from './trace-condense'
import type { RingBuildEvent } from './ring-build-trace'

const two = runInit(dgxH100Config, createDefaultEnvConfig(), {
  serverCount: 2, railCount: 8, networkType: 'rail-optimized',
})
const events = two.ringBuildTrace!.events
const stops = condenseTrace(events)

describe('condenseTrace (two-node, 256-event trace)', () => {
  test('compresses hard: repeats collapse to well under half the trace', () => {
    expect(stops.length).toBeLessThan(events.length / 2)
    expect(stops.length).toBeGreaterThan(20) // but the story survives
  })

  test('stops are strictly increasing, start at Ready, end at done', () => {
    for (let i = 1; i < stops.length; i++) expect(stops[i].idx).toBeGreaterThan(stops[i - 1].idx)
    expect(stops[0].idx).toBe(0)
    expect(stops[stops.length - 1].idx).toBe(events.length) // 'done' is last
  })

  test('never loses a decisive moment', () => {
    const kept = new Set(stops.map((s) => s.idx))
    events.forEach((e, i) => {
      const decisive =
        (e.kind === 'attempt' && e.kept) ||
        e.kind === 'accepted' || e.kind === 'channel-done' ||
        e.kind === 'dup' || e.kind === 'done' ||
        e.kind === 'backtrack' || e.kind === 'improve'
      if (decisive) expect(kept.has(i + 1), `${e.kind} at ${i} must be a stop`).toBe(true)
    })
  })

  test('the first speed block (descent to the kept solution) plays in full', () => {
    const kept = new Set(stops.map((s) => s.idx))
    const secondSpeed = events.findIndex((e, i) => e.kind === 'speed' && i > 1)
    for (let i = 0; i < secondSpeed; i++) expect(kept.has(i + 1)).toBe(true)
  })

  test('post-solution speed blocks after the representative get exactly one stop', () => {
    // blocks at speeds 15, 12, 6, 3 (17.5 is the in-brief representative)
    const speedIdxs = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.kind === 'speed')
      .map(({ i }) => i)
    const acceptedAt = events.findIndex((e) => e.kind === 'accepted')
    for (let b = 2; b < speedIdxs.length; b++) {
      const start = speedIdxs[b]
      const end = b + 1 < speedIdxs.length ? speedIdxs[b + 1] : acceptedAt
      const inBlock = stops.filter((s) => s.idx - 1 >= start && s.idx - 1 < end)
      expect(inBlock.length, `block at event ${start}`).toBe(1)
      expect(inBlock[0].note).toContain('nothing beat the incumbent')
    }
  })

  test('channel 0 walks in full; channels 2+ collapse to their finished ring', () => {
    const kept = new Set(stops.map((s) => s.idx))
    const starts = events.map((e, i) => (e.kind === 'channel-start' ? i : -1)).filter((i) => i >= 0)
    const dones = events.map((e, i) => (e.kind === 'channel-done' ? i : -1)).filter((i) => i >= 0)
    for (let i = starts[0]; i <= dones[0]; i++) expect(kept.has(i + 1)).toBe(true)
    for (let c = 2; c < starts.length; c++) {
      const inGroup = stops.filter((s) => s.idx - 1 >= starts[c] && s.idx - 1 <= dones[c])
      expect(inGroup.length).toBe(1)
      expect(inGroup[0].idx).toBe(dones[c] + 1)
    }
  })

  test('honest bookkeeping: covered + skipped == whole trace', () => {
    const covered = stops.length - 1 // stops after Ready, one event each
    const skipped = stops.reduce((a, s) => a + (s.skipped ?? 0), 0)
    expect(covered + skipped).toBe(events.length)
  })

  test('a backtracking channel is never condensed', () => {
    // synthetic: channel 2 (ordinal 2, normally collapsed) contains a backtrack
    const mini: RingBuildEvent[] = [
      { kind: 'phase', label: 'p', detail: '', sourceRef: '' },
      { kind: 'accepted', speed: 20, sameChannels: 0, typeIntra: 1, typeInter: 7, crossNic: 0, nChannels: 3 },
      { kind: 'channel-start', channel: 0, startGpu: 'gpu-0', speed: 20, reused: false },
      { kind: 'channel-done', channel: 0, order: ['gpu-0'] },
      { kind: 'channel-start', channel: 1, startGpu: 'gpu-1', speed: 20, reused: false },
      { kind: 'channel-done', channel: 1, order: ['gpu-1'] },
      { kind: 'channel-start', channel: 2, startGpu: 'gpu-2', speed: 20, reused: false },
      { kind: 'backtrack', channel: 2, at: 'gpu-3', backTo: 'gpu-2' },
      { kind: 'channel-done', channel: 2, order: ['gpu-2'] },
      { kind: 'done', nChannels: 3, speed: 20 },
    ]
    const s = condenseTrace(mini)
    const kept = new Set(s.map((x) => x.idx))
    for (let i = 6; i <= 8; i++) expect(kept.has(i + 1)).toBe(true)
  })

  test('a trace where nothing was kept (fallback) is not compressed', () => {
    const mini: RingBuildEvent[] = [
      { kind: 'phase', label: 'p', detail: '', sourceRef: '' },
      { kind: 'speed', speed: 20, detail: '' },
      { kind: 'attempt', n: 1, speed: 20, sameChannels: 1, pattern: 0, typeIntra: 1, typeInter: 4, crossNic: 0, found: 0, kept: false },
      { kind: 'speed', speed: 15, detail: '' },
      { kind: 'attempt', n: 2, speed: 15, sameChannels: 1, pattern: 0, typeIntra: 1, typeInter: 4, crossNic: 0, found: 0, kept: false },
    ]
    const s = condenseTrace(mini)
    expect(s.length).toBe(mini.length + 1) // Ready + every event
  })
})
