import { describe, it, expect } from 'vitest'
import { PREAMBLE_BEATS, preambleBeat } from './preamble'

describe('walkthrough preamble (Phase P)', () => {
  it('has the six phases in session-establishment order', () => {
    expect(PREAMBLE_BEATS.map((b) => b.id)).toEqual([
      'ground-zero',
      'launch',
      'rendezvous',
      'three-stores',
      'convergence',
      'bootstrap-ring',
      'allgather1',
      'local-search',
      'consensus',
    ])
  })

  it('every beat carries a source citation into ref/src', () => {
    for (const b of PREAMBLE_BEATS) {
      expect(b.sourceRef).toMatch(/^([a-z_]+\.(cc|h):\d+|docs\/[A-Z]+\.md)/)
    }
  })

  it('every beat has a failure signature (the troubleshooting hook)', () => {
    for (const b of PREAMBLE_BEATS) {
      expect(b.failureSignature.length).toBeGreaterThan(20)
      expect(b.analogy.length).toBeGreaterThan(10)
    }
  })

  it('consensus beat states the min/max merge rule', () => {
    const c = preambleBeat('consensus')
    expect(c.narration).toContain('min()')
    expect(c.narration).toContain('max()')
    expect(c.sourceRef).toContain('init.cc:1438-1446')
  })

  it('preambleBeat throws on unknown id', () => {
    expect(() => preambleBeat('nope')).toThrow('unknown preamble beat')
  })
})
