import { describe, it, expect } from 'vitest'
import { CURRICULUM, allBeats, gapBeats } from './curriculum'
import { PREAMBLE_BEATS } from './preamble'

describe('curriculum (ground zero → established)', () => {
  it('modules run session → database → spf → decision → consensus → tables → dataplane → steady-state', () => {
    expect(CURRICULUM.map((m) => m.id)).toEqual([
      'session',
      'database',
      'spf',
      'decision',
      'consensus',
      'tables',
      'dataplane',
      'steady-state',
    ])
  })

  it('every beat is source-cited and carries analogy + failure signature', () => {
    for (const b of allBeats()) {
      expect(b.sourceRef, b.id).toMatch(/^[a-z_/.]+\.(cc|h):\d+/)
      expect(b.analogy.length, b.id).toBeGreaterThan(10)
      expect(b.failureSignature.length, b.id).toBeGreaterThan(20)
    }
  })

  it('beat ids are unique across the whole curriculum', () => {
    const ids = allBeats().map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('module 1 reuses the preamble beats verbatim (single source of truth)', () => {
    const session = CURRICULUM[0]
    const preambleIds = PREAMBLE_BEATS.map((b) => b.id)
    for (const beat of session.beats) {
      expect(preambleIds).toContain(beat.id)
      const src = PREAMBLE_BEATS.find((p) => p.id === beat.id)!
      expect(beat.narration).toBe(src.narration)
      expect(beat.sourceRef).toBe(src.sourceRef)
    }
  })

  it('transport selection teaches the admin-distance order (p2p → shm → net)', () => {
    const t = allBeats().find((b) => b.id === 'transport-select')!
    expect(t.narration).toMatch(/P2P.*SHM.*NET/s)
    expect(t.sourceRef).toContain('transport.cc:15')
  })

  it('every beat either binds to a built view or declares its gap', () => {
    for (const b of allBeats()) {
      expect(b.view !== undefined || b.gap !== undefined, b.id).toBe(true)
    }
  })

  it('every beat is demonstrated — the gap list is empty', () => {
    expect(gapBeats()).toEqual([])
  })

  it('session and consensus beats bind to the walkthrough view', () => {
    for (const id of ['launch', 'rendezvous', 'bootstrap-ring', 'allgather1', 'consensus']) {
      expect(allBeats().find((b) => b.id === id)?.view).toBe('walkthrough')
    }
  })
})
