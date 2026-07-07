// =============================================================================
// Ring AllReduce value-level simulator — correctness tests
//
// Toy scale:     4 GPUs × 16 el × int16, 2 rings   (the "16-lane GPU")
// Target scale:  64 GPUs (8 servers × 8) — the LL128 flag's 64 bits exactly
// =============================================================================

import { describe, test, expect } from 'vitest'
import { simulateAllReduce, toyAllReduce, buffersAtStep } from './allreduce'
import { clusterRankOf } from './allgather'
import { buildClusterChannels } from '../engine/cluster'

function popcount(x: bigint): number {
  let n = 0
  while (x > 0n) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

describe('toy AllReduce (4 GPUs × 16 lanes × int16, 2 rings)', () => {
  const t = toyAllReduce()

  test('matches the toy GPU spec', () => {
    expect(t.elementsPerGpu).toBe(16) // 2 chunk × 4 ranks × 2 channels
    expect(t.lanesPerGpu).toBe(16)
    expect(t.totalSteps).toBe(6) // reduce-scatter 3 + all-gather 3
    // 2 phases × 3 steps × 4 transfers × 2 channels
    expect(t.frames).toHaveLength(48)
    // A 2-element chunk (4 bytes) rides one LL128 line, one lane-tick to add.
    expect(t.frames[0].nLines).toBe(1)
    expect(t.frames[0].ticksToProcess).toBe(1)
  })

  test('every GPU ends with the identical, correct sums: 100 + 4e', () => {
    for (let e = 0; e < 16; e++) expect(t.expectedSums[e]).toBe(100 + 4 * e)
    for (const buf of t.finalBuffers) expect(buf).toEqual(t.expectedSums)
  })

  test('reduce-scatter frames carry growing partial sums and origin masks', () => {
    // Step s payload contains exactly s+1 ranks' contributions.
    for (const f of t.frames.filter((f) => f.phase === 'reduce-scatter')) {
      expect(popcount(f.origins)).toBe(f.step + 1)
    }
    // Step 0 payloads are raw seeds: sender's own (r+1)*10 + e.
    for (const f of t.frames.filter((f) => f.phase === 'reduce-scatter' && f.step === 0)) {
      const expected = Array.from({ length: f.elemCount }, (_, i) =>
        (f.fromRank + 1) * 10 + (f.elemOffset + i),
      )
      expect(f.payload).toEqual(expected)
    }
  })

  test('all-gather is pure passthrough: full sums, full mask, never altered', () => {
    const ag = t.frames.filter((f) => f.phase === 'all-gather')
    expect(ag.length).toBeGreaterThan(0)
    for (const f of ag) {
      expect(f.origins).toBe(t.fullMask) // {0,1,2,3} — flag passes through
      expect(f.payload).toEqual(
        t.expectedSums.slice(f.elemOffset, f.elemOffset + f.elemCount),
      )
    }
  })

  test('receive logs: 2 phases × 3 steps × 2 channels per GPU', () => {
    for (const log of t.logs) expect(log.received).toHaveLength(12)
  })

  test('channel 1 runs the opposite ring direction', () => {
    const ch0 = t.frames.find((f) => f.channel === 0 && f.fromRank === 0)!
    const ch1 = t.frames.find((f) => f.channel === 1 && f.fromRank === 0)!
    expect(ch0.toRank).toBe(1) // 0→1→2→3
    expect(ch1.toRank).toBe(3) // 3→2→1→0 wraps 0→3
  })
})

describe('buffersAtStep (the scrubber)', () => {
  const t = toyAllReduce()

  test('step 0 is the seeds, totalSteps is the final sums', () => {
    expect(buffersAtStep(t, 0)).toEqual(t.initialBuffers)
    expect(buffersAtStep(t, t.totalSteps)).toEqual(t.finalBuffers)
  })

  test('after RS step 0, G1 holds the partial sum for chunk 0: 10+20, 11+21', () => {
    const bufs = buffersAtStep(t, 1)
    expect(bufs[1].slice(0, 2)).toEqual([30, 32])
  })

  test('clamps out-of-range steps', () => {
    expect(buffersAtStep(t, -5)).toEqual(t.initialBuffers)
    expect(buffersAtStep(t, 999)).toEqual(t.finalBuffers)
  })
})

describe('guards', () => {
  test('int16 overflow in the final sums throws with guidance', () => {
    expect(() =>
      simulateAllReduce([[0, 1]], 2, { seed: () => 30000 }),
    ).toThrow(/overflow/i)
  })

  test('more than 64 ranks refuses — the LL128 flag holds exactly 64 bits', () => {
    const order = Array.from({ length: 65 }, (_, i) => i)
    expect(() => simulateAllReduce([order], 65)).toThrow(/64/)
  })
})

describe('target scale: 64 GPUs (8 servers × 8), rings from the cluster engine', () => {
  const identity = [0, 1, 2, 3, 4, 5, 6, 7]
  const topo = buildClusterChannels({
    serverCount: 8,
    gpuPerServer: 8,
    nicCount: 8,
    railCount: 8,
    intraOrders: [identity, identity],
  })
  const rankOf = clusterRankOf(8)
  const orders = topo.channels.map((ch) => ch.globalOrder.map(rankOf))
  // Small seeds so 64-way sums stay in int16: Σ(r+1) = 2080, + 64·(e%4) ≤ 2272.
  const t = simulateAllReduce(orders, 64, { seed: (r, e) => r + 1 + (e % 4) })

  test('scaling model holds: buffer grows, GPU width does not', () => {
    expect(t.elementsPerGpu).toBe(2 * 64 * 2) // 256 — same 2-element chunks
    expect(t.chunkElems).toBe(2)
    expect(t.totalSteps).toBe(126) // 2 × 63
    expect(t.frames).toHaveLength(2 * 63 * 64 * 2) // 16,128 transfers
  })

  test('all 64 GPUs converge to identical correct sums', () => {
    for (let e = 0; e < 256; e++) expect(t.expectedSums[e]).toBe(2080 + 64 * (e % 4))
    for (const buf of t.finalBuffers) expect(buf).toEqual(t.expectedSums)
  })

  test('the origin mask fills all 64 bits of the LL128 flag — exactly', () => {
    expect(t.fullMask).toBe((1n << 64n) - 1n)
    for (const f of t.frames.filter((f) => f.phase === 'all-gather')) {
      expect(f.origins).toBe(t.fullMask)
    }
  })
})
