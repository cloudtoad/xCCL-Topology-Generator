// Atlas integrity: the shared keys must actually be shared. Every mermaid
// node id in the L2 graphs resolves through the registry; every registry
// cross-link resolves in its target artifact. The atlas is only an atlas
// if the keys line up.
import { describe, test, expect } from 'vitest'
import { ATLAS, ATLAS_BY_MID, mid } from './ids'
import { L2_CFG } from './graphs/l2-cfg'
import { L2_DFD } from './graphs/l2-dfd'
import { runInit } from '../engine/init'
import { createDefaultEnvConfig } from '../engine/env'
import { dgxH100Config } from '../engine/templates/dgx-h100'
import { buildLineage } from '../engine/lineage'
import { CURRICULUM } from '../walkthrough/curriculum'

const EVENT_KINDS = [
  'phase', 'speed', 'relax', 'attempt', 'accepted', 'improve',
  'channel-start', 'consider', 'hop', 'backtrack', 'close', 'channel-done',
  'dup', 'done',
]

/** Extract node ids from mermaid node-definition lines (id[..], id([..]), id{..}, id[(..)]). */
function nodeIds(src: string): string[] {
  const ids = new Set<string>()
  for (const line of src.split('\n')) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\[|\(\[|\{|\[\()/)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

describe('atlas registry integrity', () => {
  const su = { serverCount: 2, railCount: 8, networkType: 'rail-optimized' as const }
  const two = runInit(dgxH100Config, createDefaultEnvConfig(), su)
  const lineage = buildLineage(dgxH100Config, createDefaultEnvConfig(), su, two)
  const single = runInit(dgxH100Config, createDefaultEnvConfig())
  const singleLineage = buildLineage(dgxH100Config, createDefaultEnvConfig(), undefined, single)

  test('every registered atlas node id used in L2 graphs resolves via ATLAS_BY_MID', () => {
    for (const src of [L2_CFG, L2_DFD]) {
      for (const id of nodeIds(src)) {
        // plain-structural nodes (decision diamonds like FOUND/EXH) are allowed;
        // anything with the S60 prefix must be registered
        if (id.startsWith(mid('S60.').slice(0, 4))) {
          expect(ATLAS_BY_MID[id], `unregistered graph node ${id}`).toBeDefined()
        }
      }
    }
  })

  test('registry lineageIds resolve in at least one scenario lineage', () => {
    // e.g. search.climb exists only where phase-2 headroom existed (single-
    // server), not in the 2-node lineage (solution enters at its ceiling).
    // The Atlas detail card guards on resolution; the registry must merely
    // point at something real somewhere.
    for (const e of Object.values(ATLAS)) {
      if (e.lineageId) {
        const resolves = lineage.nodes.has(e.lineageId) || singleLineage.nodes.has(e.lineageId)
        expect(resolves, `${e.id} → ${e.lineageId}`).toBe(true)
      }
    }
  })

  test('registry buildEvent kinds are real trace event kinds, and each matcher hits the 2-node trace where expected', () => {
    for (const e of Object.values(ATLAS)) {
      if (e.buildEvent) {
        expect(EVENT_KINDS, `${e.id} kind`).toContain(e.buildEvent.kind)
      }
    }
    // spot-pin the ones the 2-node trace must demonstrate
    const events = two.ringBuildTrace!.events
    const hits = (id: string) => {
      const be = ATLAS[id].buildEvent!
      return events.some(
        (ev) => ev.kind === be.kind && (!be.includes || JSON.stringify(ev).includes(be.includes)),
      )
    }
    expect(hits('S60.attempt')).toBe(true)
    expect(hits('S60.rungSame')).toBe(true)
    expect(hits('S60.accepted')).toBe(true)
  })

  test('registry guideBeats exist in the curriculum', () => {
    const beatIds = new Set(CURRICULUM.flatMap((m) => m.beats.map((b) => b.id)))
    for (const e of Object.values(ATLAS)) {
      if (e.guideBeat) expect(beatIds.has(e.guideBeat), `${e.id} → ${e.guideBeat}`).toBe(true)
    }
  })

  test('mid() round-trips every registry id uniquely', () => {
    const mids = Object.keys(ATLAS).map(mid)
    expect(new Set(mids).size).toBe(mids.length)
  })
})
