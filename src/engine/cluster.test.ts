// =============================================================================
// True multi-node channel rings — tests
//
// Fidelity anchors:
//   search.cc:837      — inter RING visits every GPU in a node, then exits to NET
//   connect.cc:106-109 — ring prev/next stitched across node boundaries
//   search.cc:735      — NICs round-robin per channel (c % nNics)
// =============================================================================

import { describe, test, expect } from 'vitest'
import {
  buildClusterChannels,
  intraOrdersFromRingGraph,
  allInterNodeHops,
  railLens,
  clusterGpuId,
} from './cluster'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'

/** 4 servers × 8 GPUs × 8 NICs × 8 rails with simple identity intra cycles. */
function topo4x8(intraOrders?: number[][]) {
  const identity = [0, 1, 2, 3, 4, 5, 6, 7]
  return buildClusterChannels({
    serverCount: 4,
    gpuPerServer: 8,
    nicCount: 8,
    railCount: 8,
    intraOrders: intraOrders ?? [identity, identity, identity],
  })
}

describe('buildClusterChannels — one ring per channel over ALL GPUs', () => {
  test('globalOrder spans every GPU in the cluster exactly once', () => {
    const t = topo4x8()
    for (const ch of t.channels) {
      expect(ch.globalOrder).toHaveLength(4 * 8)
      expect(new Set(ch.globalOrder).size).toBe(32)
    }
  })

  test('each server segment contains all 8 GPUs (search.cc:837 backToNet=ngpus-1)', () => {
    const t = topo4x8()
    for (const ch of t.channels) {
      expect(ch.serverSegments).toHaveLength(4)
      for (const seg of ch.serverSegments) {
        expect(seg.order).toHaveLength(8)
        expect(new Set(seg.order).size).toBe(8)
      }
    }
  })

  test('channel c enters every server at the local GPU of NIC c%nNics', () => {
    const t = topo4x8()
    // channel 0 → NIC 0 → entry GPU 0; channel 1 → NIC 1 → entry GPU 1
    for (const ch of t.channels) {
      for (const seg of ch.serverSegments) {
        expect(seg.order[0]).toBe(clusterGpuId(seg.server, ch.nic))
      }
    }
  })

  test('exit GPU is the entry GPU\'s predecessor in the intra cycle', () => {
    // cycle 0→2→4→6→1→3→5→7; channel 1 enters at GPU 1, so it must exit at 6
    // (6 precedes 1 in the cycle).
    const cycle = [0, 2, 4, 6, 1, 3, 5, 7]
    const t = buildClusterChannels({
      serverCount: 4, gpuPerServer: 8, nicCount: 8, railCount: 8,
      intraOrders: [cycle, cycle],
    })
    const ch1 = t.channels[1]
    expect(ch1.serverSegments[0].order[0]).toBe('s0-gpu-1')
    expect(ch1.serverSegments[0].order[7]).toBe('s0-gpu-6')
    expect(ch1.hops[0]).toMatchObject({ fromId: 's0-gpu-6', toId: 's1-gpu-1' })
  })

  test('hops stitch exit(s) → entry(s+1) and wrap (connect.cc:106-109)', () => {
    const t = topo4x8()
    const ch0 = t.channels[0]
    expect(ch0.hops).toHaveLength(4)
    expect(ch0.hops[0]).toMatchObject({ fromId: 's0-gpu-7', toId: 's1-gpu-0' })
    expect(ch0.hops[3]).toMatchObject({ fromId: 's3-gpu-7', toId: 's0-gpu-0' }) // wrap
  })

  test('globalOrder + hops form one closed cycle over 32 GPUs', () => {
    const t = topo4x8()
    for (const ch of t.channels) {
      // Build next-pointers: consecutive within globalOrder, and the wrap hop.
      const next = new Map<string, string>()
      for (let i = 0; i < ch.globalOrder.length - 1; i++) {
        next.set(ch.globalOrder[i], ch.globalOrder[i + 1])
      }
      next.set(ch.globalOrder[31], ch.globalOrder[0]) // the wrap hop closes it

      // Segment boundaries must agree with the recorded hops.
      for (const hop of ch.hops) {
        expect(next.get(hop.fromId)).toBe(hop.toId)
      }

      // Walking next from the start visits all 32 exactly once and returns.
      let cur = ch.globalOrder[0]
      const seen = new Set<string>()
      do {
        seen.add(cur)
        cur = next.get(cur)!
      } while (cur !== ch.globalOrder[0] && seen.size <= 32)
      expect(seen.size).toBe(32)
    }
  })

  test('channel c rides rail (c%nNics)%railCount (search.cc:735 round-robin)', () => {
    const t = buildClusterChannels({
      serverCount: 4, gpuPerServer: 8, nicCount: 8, railCount: 4, // 8 NICs share 4 rails
      intraOrders: Array.from({ length: 6 }, () => [0, 1, 2, 3, 4, 5, 6, 7]),
    })
    expect(t.channels.map((c) => c.nic)).toEqual([0, 1, 2, 3, 4, 5])
    expect(t.channels.map((c) => c.rail)).toEqual([0, 1, 2, 3, 0, 1]) // nic%4
  })

  test('rail lens groups hops by rail — a view, not the rings', () => {
    const t = topo4x8() // 3 channels → rails 0,1,2; 4 hops each
    const lens = railLens(t)
    expect(lens.get(0)!).toHaveLength(4)
    expect(lens.get(1)!).toHaveLength(4)
    expect(allInterNodeHops(t)).toHaveLength(3 * 4) // channels × servers
  })

  test('single server → channels with no hops', () => {
    const t = buildClusterChannels({
      serverCount: 1, gpuPerServer: 8, nicCount: 8, railCount: 8,
      intraOrders: [[0, 1, 2, 3, 4, 5, 6, 7]],
    })
    expect(t.channels[0].globalOrder).toHaveLength(8)
    expect(allInterNodeHops(t)).toHaveLength(0)
  })

  test('8-server option deepens the rings, not the channel count', () => {
    const identity = [0, 1, 2, 3, 4, 5, 6, 7]
    const t = buildClusterChannels({
      serverCount: 8, gpuPerServer: 8, nicCount: 8, railCount: 8,
      intraOrders: [identity, identity],
    })
    expect(t.nChannels).toBe(2)
    expect(t.channels[0].globalOrder).toHaveLength(64)
    expect(t.channels[0].hops).toHaveLength(8)
  })

  test('bad intra order length throws', () => {
    expect(() =>
      buildClusterChannels({
        serverCount: 4, gpuPerServer: 8, nicCount: 8, railCount: 8,
        intraOrders: [[0, 1, 2]],
      }),
    ).toThrow(/expected 8/)
  })
})

describe('driven from the real engine (DGX H100)', () => {
  test('intraOrdersFromRingGraph extracts the search\'s cycles', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    const orders = intraOrdersFromRingGraph(result.ringGraph)
    expect(orders.length).toBe(result.ringGraph.nChannels)
    for (const o of orders) {
      expect([...o].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    }
  })
})
