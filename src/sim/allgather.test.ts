// =============================================================================
// Ring AllGather simulator — correctness tests
// =============================================================================

import { describe, test, expect } from 'vitest'
import {
  simulateAllGather,
  ringOrdersFromGraph,
  defaultRankOf,
  clusterRankOf,
  ll128Lines,
} from './allgather'
import { runInit } from '../engine/init'
import { createDefaultEnvConfig } from '../engine/env'
import { buildClusterChannels } from '../engine/cluster'
import { dgxH100Config } from '../engine/templates/dgx-h100'

describe('ll128Lines', () => {
  test('120 bytes fits one LL128 line', () => {
    expect(ll128Lines(120)).toBe(1)
    expect(ll128Lines(1)).toBe(1)
    expect(ll128Lines(121)).toBe(2)
    expect(ll128Lines(480)).toBe(4)
  })
})

describe('ring AllGather schedule', () => {
  test('runs N-1 steps with N transfers per step per channel', () => {
    const t = simulateAllGather([[0, 1, 2, 3]], 4)
    expect(t.nSteps).toBe(3)
    expect(t.framesByStep).toHaveLength(3)
    for (const step of t.framesByStep) expect(step).toHaveLength(4) // one per ring edge
    expect(t.frames).toHaveLength(3 * 4)
  })

  test('every GPU ends holding all N origins (its own + N-1 received)', () => {
    const t = simulateAllGather([[0, 1, 2, 3]], 4)
    for (const log of t.logs) {
      expect([...log.origins].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
      expect(log.received).toHaveLength(3) // received N-1 chunks
    }
  })

  test('matches the tutorial trace: rank 0 receives origins 3, 2, 1 in order', () => {
    const t = simulateAllGather([[0, 1, 2, 3]], 4)
    const rank0 = t.logs[0].received.map((f) => f.origin)
    expect(rank0).toEqual([3, 2, 1])
  })

  test('origin is never altered — a GPU forwards exactly what it received', () => {
    // For every non-first step, the frame a GPU sends carries the origin it
    // received in the previous step (pure passthrough).
    const order = [0, 2, 1, 3]
    const t = simulateAllGather([order], 4)
    for (let rank = 0; rank < 4; rank++) {
      const sent = t.frames.filter((f) => f.fromRank === rank).sort((a, b) => a.step - b.step)
      const recv = t.frames.filter((f) => f.toRank === rank).sort((a, b) => a.step - b.step)
      for (let s = 1; s < t.nSteps; s++) {
        const sentThisStep = sent.find((f) => f.step === s)!
        const recvPrevStep = recv.find((f) => f.step === s - 1)!
        expect(sentThisStep.origin).toBe(recvPrevStep.origin)
      }
    }
  })

  test('every origin reaches every other GPU exactly once', () => {
    const t = simulateAllGather([[0, 1, 2, 3, 4]], 5)
    for (let rank = 0; rank < 5; rank++) {
      const originsSeen = t.logs[rank].received.map((f) => f.origin).sort((a, b) => a - b)
      const expected = [0, 1, 2, 3, 4].filter((o) => o !== rank)
      expect(originsSeen).toEqual(expected) // all others, each once, never its own
    }
  })
})

describe('parallel rings (channels)', () => {
  test('C channels run independently; each completes the AllGather', () => {
    const ch0 = [0, 1, 2, 3]
    const ch1 = [0, 2, 1, 3] // a different ring ordering
    const t = simulateAllGather([ch0, ch1], 4)
    expect(t.nChannels).toBe(2)
    expect(t.frames).toHaveLength(2 * 3 * 4) // channels * steps * edges

    // Each channel independently delivers all origins to every GPU.
    for (let c = 0; c < 2; c++) {
      for (let rank = 0; rank < 4; rank++) {
        const seen = t.frames
          .filter((f) => f.channel === c && f.toRank === rank)
          .map((f) => f.origin)
          .sort((a, b) => a - b)
        expect(seen).toEqual([0, 1, 2, 3].filter((o) => o !== rank))
      }
    }
  })

  test('bytes split across channels', () => {
    const t = simulateAllGather([[0, 1, 2, 3], [0, 1, 2, 3]], 4, { bytesPerRankChunk: 480 })
    expect(t.bytesPerChunkPerChannel).toBe(240)
    expect(t.frames[0].nLines).toBe(ll128Lines(240)) // 2 lines
  })
})

describe('guards + graph extraction', () => {
  test('non-permutation ring order length throws', () => {
    expect(() => simulateAllGather([[0, 1, 2]], 4)).toThrow(/expected 4/)
  })

  test('defaultRankOf extracts trailing integer', () => {
    expect(defaultRankOf('gpu-3')).toBe(3)
    expect(defaultRankOf('s0-gpu-5')).toBe(5)
  })

  test('drives from a real computed ring graph (DGX H100)', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    const orders = ringOrdersFromGraph(result.ringGraph)
    expect(orders.length).toBe(result.ringGraph.nChannels)
    expect(orders[0]).toHaveLength(8)

    const t = simulateAllGather(orders, 8)
    // Every GPU ends with all 8 origins on every channel.
    for (const log of t.logs) {
      expect([...log.origins].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    }
  })

  test('runs on a TRUE 32-GPU cluster channel ring (4 servers × 8 GPUs)', () => {
    const identity = [0, 1, 2, 3, 4, 5, 6, 7]
    const topo = buildClusterChannels({
      serverCount: 4, gpuPerServer: 8, nicCount: 8, railCount: 8,
      intraOrders: [identity],
    })
    const rankOf = clusterRankOf(8)
    const order = topo.channels[0].globalOrder.map(rankOf)
    expect(order).toHaveLength(32)
    expect(new Set(order).size).toBe(32)

    const t = simulateAllGather([order], 32)
    expect(t.nSteps).toBe(31) // N-1 steps across the whole cluster
    for (const log of t.logs) {
      expect(log.origins).toHaveLength(32) // every GPU ends with all 32 origins
    }
  })
})
