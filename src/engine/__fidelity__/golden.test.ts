// =============================================================================
// Golden anchors — engine outputs pinned to PUBLIC real-world NCCL data
//
// We have no private NCCL_DEBUG dump, so these anchors come from:
//   [G1] NVIDIA/nccl issue #1197 (github.com/NVIDIA/nccl/issues/1197):
//        an H100-class NVSwitch system on NCCL 2.19.4 with GRAPH dumps:
//          "Pattern 4, crossNic 0, nChannels 12, bw 30.000000/30.000000, type NVL/PIX"
//          "Pattern 1, crossNic 0, nChannels 12, bw 30.000000/30.000000, type NVL/PIX"
//          "Pattern 5, crossNic 0, nChannels 8,  bw 40.000000/60.000000, ..."
//        and a topology dump showing GPU↔NVS links at 360.0 GB/s
//        (18 NVLinks × 20.0, the 2.19-era SM90_NVLINK_BW).
//   [G2] NCCL 2.30.7 source in ref/src/nccl: graph.h:160-169 (pattern IDs),
//        topo.cc:856 (bw = count × nvlBw), tuning.cc:306-325 (NVLS busBw).
//
// Where 2.30.7 constants differ from the 2.19-era dump (nvlBw 20.6 vs 20.0),
// we anchor to OUR source version and note the dump-era value.
// =============================================================================

import { describe, test, expect } from 'vitest'
import { GraphPattern, NodeType, LinkType, Algorithm } from '../types'
import { buildTopoSystem } from '../topo'
import { runInit } from '../init'
import { DecisionLog } from '../decision-log'
import { createDefaultEnvConfig } from '../env'
import { dgxH100Config } from '../templates/dgx-h100'
import { dgxB200Config } from '../templates/dgx-b200'
import { SM90_NVLINK_BW, NVLS_EFFICIENCY_HOPPER } from '../constants/nccl'

describe('[G2] pattern IDs match graph.h:160-169 (visible in GRAPH logs)', () => {
  test('the IDs real logs print — "Pattern 4" is Ring, "Pattern 5" is NVLS', () => {
    expect(GraphPattern.BALANCED_TREE).toBe(1)
    expect(GraphPattern.SPLIT_TREE).toBe(2)
    expect(GraphPattern.TREE).toBe(3)
    expect(GraphPattern.RING).toBe(4)
    expect(GraphPattern.NVLS).toBe(5)
    expect(GraphPattern.COLLNET_DIRECT).toBe(6)
  })
})

describe('[G1+G2] NVSwitch link bandwidth aggregates the NVLink count', () => {
  test('DGX H100: GPU aggregate into fabric = 18 × 20.6 = 370.8 GB/s', () => {
    // Issue #1197 shows 360.0 on NCCL 2.19 (nvlBw 20.0); 2.30.7 uses 20.6.
    const env = createDefaultEnvConfig()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)

    const gpus = system.nodesByType.get(NodeType.GPU) ?? []
    const nvsIds = new Set((system.nodesByType.get(NodeType.NVS) ?? []).map((n) => n.id))
    for (const gpu of gpus) {
      const aggregate = system.links
        .filter((l) => l.fromId === gpu.id && l.type === LinkType.NVL && nvsIds.has(l.toId))
        .reduce((sum, l) => sum + l.bandwidth, 0)
      expect(aggregate).toBeCloseTo(18 * SM90_NVLINK_BW, 5) // 370.8
      // One logical NVS link at the full aggregate — NCCL presents the fabric
      // as a single switch (#1197 shows NVS/0 @ 360 on 2.19-era constants).
      const logical = system.links.find(
        (l) => l.fromId === gpu.id && l.type === LinkType.NVL && nvsIds.has(l.toId),
      )
      expect(logical?.bandwidth).toBeCloseTo(18 * SM90_NVLINK_BW, 5)
    }
  })
})

describe('[G1] NVLS graph matches the real dump shape', () => {
  test('H100: 8 head channels @ bw 40 ("Pattern 5 … nChannels 8, bw 40.000000")', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.nvlsGraph?.pattern).toBe(GraphPattern.NVLS)
    expect(result.nvlsGraph?.nChannels).toBe(8) // one head per GPU — as in the dump
    // 370.8 aggregate / 8 heads = 46.35 → speed table entry 40, as in the dump.
    expect(result.nvlsGraph?.speedIntra).toBe(40)
  })

  test('B200: 8 heads @ 90 (721.8 aggregate / 8 = 90.2 → SM100 table 90)', () => {
    const result = runInit(dgxB200Config, createDefaultEnvConfig())
    expect(result.nvlsGraph?.nChannels).toBe(8)
    expect(result.nvlsGraph?.speedIntra).toBe(90)
  })
})

describe('[G2] NVLS busBw formula (tuning.cc:306-325) lands on real-world numbers', () => {
  test('H100 AllReduce busBw = 8 × 40 × 0.85 × 7/8 × 2 = 476 GB/s (real ≈ 480)', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.tuning?.algorithm).toBe(Algorithm.NVLS)
    const expected = 8 * 40 * NVLS_EFFICIENCY_HOPPER * (7 / 8) * 2
    expect(result.tuning?.bandwidth).toBeCloseTo(expected, 3)
    expect(expected).toBe(476) // sanity: the arithmetic itself
  })
})

describe('[G3] "=== System : maxBw/totalBw" semantics (search.cc:14-53)', () => {
  // Real dump anchor: ROCm/rccl#1210 — 4× MI300X prints
  //   "=== System : maxBw 48.0 totalBw 144.0 ==="  (3 xGMI links × 48.0)
  test('4× MI300X reproduces the #1210 dump: maxBw 48, totalBw 144', () => {
    const mi300x4: typeof dgxH100Config = {
      ...JSON.parse(JSON.stringify(dgxH100Config)),
      name: 'MI300X x4',
      gpu: { count: 4, type: 'MI300X', cudaCompCap: 0, nvlinksPerPair: 1, gdrSupport: true },
      nvswitch: { count: 0 },
      numaMapping: [0, 0, 1, 1],
    }
    const result = runInit(mi300x4, createDefaultEnvConfig())
    expect(result.system.maxBw).toBe(48) // best xGMI path
    expect(result.system.totalBw).toBe(144) // per-GPU Σ xGMI = 3 × 48
  })

  test('DGX H100 totalBw = per-GPU NVLink aggregate (370.8), not a system sum', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.system.totalBw).toBeCloseTo(18 * SM90_NVLINK_BW, 5) // 370.8
    // maxBw = best GPU→GPU path — the full aggregate via the logical switch
    expect(result.system.maxBw).toBeCloseTo(18 * SM90_NVLINK_BW, 5)
  })
})

describe('[G1] ring search reproduces the #1197 GRAPH line', () => {
  test('H100 ring = 12 channels @ 30 — the dump\'s exact intra values', () => {
    // #1197: "Pattern 4, crossNic 0, nChannels 12, bw 30.000000/30.000000, ..."
    // (bwInter differs: theirs is a 2-node system, ours single-node → 0.)
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.ringGraph.nChannels).toBe(12)
    expect(result.ringGraph.speedIntra).toBe(30)
    // 12 × 30 = 360 — saturates ≥95% of totalBw 370.8 (the optimality target).
    const aggregate = result.ringGraph.nChannels * result.ringGraph.speedIntra
    expect(aggregate / result.system.totalBw).toBeGreaterThan(0.95)
  })

  test('H100 tree (pre-doubling) = 12 @ 30, matching the dump\'s Pattern 1 line', () => {
    // Our connected treeGraph doubles channels (forward+reverse chains), so
    // the search-graph equivalent is nChannels/2 — the dump prints pre-Preset.
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.treeGraph.nChannels / 2).toBe(12)
    expect(result.treeGraph.speedIntra).toBe(30)
  })

  test('B200 ring saturates its per-GPU ceiling (24 × 30 = 720 of 721.8)', () => {
    const result = runInit(dgxB200Config, createDefaultEnvConfig())
    const aggregate = result.ringGraph.nChannels * result.ringGraph.speedIntra
    expect(aggregate / result.system.totalBw).toBeGreaterThan(0.95)
  })
})
