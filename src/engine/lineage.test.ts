import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'
import { buildLineage, ancestors, dependents, toMermaid } from './lineage'

const env = createDefaultEnvConfig()

describe('lineage graph — the datapoint map', () => {
  const single = runInit(dgxH100Config, env)
  const singleLineage = buildLineage(dgxH100Config, env, undefined, single)

  const twoSu = { serverCount: 2, railCount: 8, networkType: 'rail-optimized' as const }
  const two = runInit(dgxH100Config, env, twoSu)
  const twoLineage = buildLineage(dgxH100Config, env, twoSu, two)

  const fourSu = { serverCount: 4, railCount: 8, networkType: 'rail-optimized' as const }
  const four = runInit(dgxH100Config, env, fourSu)
  const fourLineage = buildLineage(dgxH100Config, env, fourSu, four)

  test('no arrow from nowhere — build validates all upstream refs (all scenarios)', () => {
    // buildLineage throws on dangling refs; reaching here means all three passed.
    expect(singleLineage.nodes.size).toBeGreaterThan(10)
    expect(twoLineage.nodes.size).toBeGreaterThan(12)
    expect(fourLineage.nodes.size).toBeGreaterThan(8)
  })

  test('roots have no upstream; derived nodes have at least one', () => {
    for (const g of [singleLineage, twoLineage, fourLineage]) {
      for (const n of g.nodes.values()) {
        if (n.kind === 'root') expect(n.upstream, n.id).toEqual([])
        else expect(n.upstream.length, n.id).toBeGreaterThan(0)
      }
    }
  })

  test('the mechanic walk: qp.total dangles from serverCount and the ring search', () => {
    const anc = ancestors(twoLineage, 'qp.total').map((n) => n.id)
    expect(anc).toContain('su.serverCount')
    expect(anc).toContain('ring.nChannels')
    expect(anc).toContain('cfg.nic') // 2-node: channels per NIC rotation
    expect(anc).toContain('paths.matrix')
  })

  test('trees dangle from the ring order (folded, not searched)', () => {
    const tree = singleLineage.nodes.get('tree.structure')
    expect(tree).toBeDefined()
    expect(tree!.upstream).toContain('ring.ch0.order')
  })

  test('2-node: channel 0 entry NET dangles from NIC count via rotation', () => {
    const netIn = twoLineage.nodes.get('ring.ch0.netIn')
    expect(netIn).toBeDefined()
    expect(netIn!.upstream).toEqual(['cfg.nic'])
    expect(netIn!.sourceRef).toContain('735')
  })

  test('values are ground truth, not recomputed', () => {
    expect(singleLineage.nodes.get('ring.nChannels')!.value).toBe(
      String(single.ringGraph.nChannels),
    )
    expect(twoLineage.nodes.get('qp.total')!.value).toContain(String(two.qpPlan!.total))
  })

  test('tuning.algorithm reaches the config roots transitively', () => {
    const anc = ancestors(singleLineage, 'tuning.algorithm').map((n) => n.id)
    expect(anc).toContain('cfg.gpu')
    expect(anc).toContain('cfg.nvlinks')
  })

  test('dependents: totalBw is read by the search speed and tuning', () => {
    const deps = dependents(singleLineage, 'topo.totalBw').map((n) => n.id)
    expect(deps).toContain('search.speed')
    expect(deps).toContain('tuning.algorithm')
  })

  test('fast path (4-node): cluster nodes exist without ring nodes', () => {
    expect(fourLineage.nodes.get('cluster.nChannels')).toBeDefined()
    expect(fourLineage.nodes.get('ring.nChannels')).toBeUndefined()
    expect(fourLineage.nodes.get('qp.total')!.upstream).toContain('cluster.nChannels')
  })

  test('mermaid export: parseable shape, focus mode prunes to ancestry', () => {
    const full = toMermaid(twoLineage)
    expect(full).toContain('flowchart LR')
    expect(full).toContain('qp_total')
    const focused = toMermaid(twoLineage, 'ring.ch0.order')
    expect(focused).toContain('ring_ch0_order')
    expect(focused).not.toContain('qp_total')
  })
})
