// =============================================================================
// Ring AllReduce — value-level dataflow simulator ("what GPUs actually do")
//
// Unlike the AllGather sim (labeled envelopes), this one carries REAL VALUES:
// each GPU contributes a small int16 buffer, and the two phases of ring
// AllReduce become visible arithmetic:
//
//   Phase 1 — reduce-scatter (N-1 steps): each hop RECEIVES a chunk, ADDS it
//     elementwise into the local copy (the lanes light up), and forwards the
//     running partial sum. After N-1 steps, each position owns one fully
//     reduced chunk.
//   Phase 2 — all-gather (N-1 steps): the completed chunks are COPIED around
//     the ring untouched — exactly the AllGather passthrough lesson.
//
// The LL128 flag (8 bytes) carries an ORIGIN BITMASK: whose contributions are
// in this payload. It ORs together during reduce-scatter ({0}→{0,3}→…) and
// passes through unchanged during all-gather. 8 bytes = 64 bits, so the flag
// is exactly full at the target scale of 64 GPUs (8 servers × 8 GPUs) — we
// use bigint so all 64 bits are real.
//
// SCALING MODEL (holds from the 4-GPU toy to the 64-GPU cluster):
//   chunk        = chunkElems elements            (the atom that moves per hop)
//   per-channel  = chunkElems × nRanks            (N rank-chunks)
//   buffer/GPU   = chunkElems × nRanks × channels (always divides cleanly)
// Toy:     A=2 × 4 ranks × 2 ch  = 16 elements — the "16-lane GPU" spec.
// Cluster: A=2 × 64 ranks × 2 ch = 256 elements — same GPU width, bigger
// buffer, which is exactly how real clusters scale.
//
// PEDAGOGICAL scale (see manifest): channel count and sizes are chosen for
// legibility; the construction layers above (rings, rails, QPs) stay VERIFIED.
// =============================================================================

import { ll128Lines } from './allgather'

export type AllReducePhase = 'reduce-scatter' | 'all-gather'

/** One chunk transfer: values + origin mask riding LL128 lines. */
export interface AllReduceFrame {
  phase: AllReducePhase
  step: number // 0..N-2 within its phase
  globalStep: number // 0..2(N-1)-1 across both phases
  channel: number
  fromRank: number
  toRank: number
  chunkIndex: number // rank-chunk slot within this channel's slice
  elemOffset: number // element offset within the full per-GPU buffer
  elemCount: number
  payload: number[] // the values on the wire (partial sums during phase 1)
  origins: bigint // LL128 flag: bitmask of ranks whose data is in the payload
  nLines: number // 128-byte LL128 lines this chunk spans
  ticksToProcess: number // ceil(elemCount / lanesPerGpu) — receiver lane occupancy
}

export interface AllReduceReceive {
  globalStep: number
  phase: AllReducePhase
  channel: number
  fromRank: number
  chunkIndex: number
  elemOffset: number
  values: number[]
  origins: bigint
}

export interface AllReduceGpuLog {
  rank: number
  received: AllReduceReceive[]
}

export interface AllReduceTrace {
  nRanks: number
  nChannels: number
  chunkElems: number
  lanesPerGpu: number
  elementsPerGpu: number
  totalSteps: number // 2 × (N-1) global steps
  ringOrders: number[][]
  frames: AllReduceFrame[]
  framesByGlobalStep: AllReduceFrame[][]
  initialBuffers: number[][] // per rank
  finalBuffers: number[][] // per rank — all identical when the ring is correct
  expectedSums: number[] // element-wise ground truth from the seeds
  fullMask: bigint // (1n << nRanks) - 1n
  logs: AllReduceGpuLog[]
}

export interface AllReduceOptions {
  /** Elements per rank-chunk per channel — the atom that moves per hop. Default 2. */
  chunkElems?: number
  /** Elementwise ALUs per GPU (display/lane model). Default 16. */
  lanesPerGpu?: number
  /**
   * Seed value for (rank, element). Default (r+1)*10 + e — final sums become
   * 10·N(N+1)/2 + N·e, head-checkable (N=4: 100+4e).
   */
  seed?: (rank: number, elem: number) => number
}

const INT16_MAX = 32767
const INT16_MIN = -32768
const BYTES_PER_ELEM = 2 // int16 — the "16-bit values" of the toy GPU spec

/**
 * Simulate ring AllReduce (sum) over per-channel ring orders.
 *
 * @param ringOrders One rank-permutation per channel (each a permutation of
 *   0..nRanks-1 — use clusterRankOf() to map cluster node ids at 8×8 scale).
 */
export function simulateAllReduce(
  ringOrders: number[][],
  nRanks: number,
  opts: AllReduceOptions = {},
): AllReduceTrace {
  const nChannels = ringOrders.length
  if (nChannels === 0) throw new Error('need at least one ring order')
  for (const [c, order] of ringOrders.entries()) {
    if (order.length !== nRanks) {
      throw new Error(`ring order for channel ${c} has ${order.length} ranks, expected ${nRanks}`)
    }
  }
  if (nRanks > 64) {
    throw new Error(
      `nRanks=${nRanks} exceeds 64 — the 8-byte LL128 flag holds exactly 64 origin bits`,
    )
  }

  const chunkElems = opts.chunkElems ?? 2
  const lanesPerGpu = opts.lanesPerGpu ?? 16
  const seed = opts.seed ?? ((r: number, e: number) => (r + 1) * 10 + e)
  const elementsPerGpu = chunkElems * nRanks * nChannels
  const phaseSteps = Math.max(0, nRanks - 1)
  const totalSteps = 2 * phaseSteps
  const fullMask = (1n << BigInt(nRanks)) - 1n

  // --- Seed buffers + int16 overflow guard (teaching sim must not silently wrap) ---
  const buffers: Int16Array[] = []
  const expectedSums: number[] = new Array(elementsPerGpu).fill(0)
  for (let r = 0; r < nRanks; r++) {
    const buf = new Int16Array(elementsPerGpu)
    for (let e = 0; e < elementsPerGpu; e++) {
      const v = seed(r, e)
      if (!Number.isInteger(v) || v > INT16_MAX || v < INT16_MIN) {
        throw new Error(`seed(${r},${e})=${v} is not an int16`)
      }
      buf[e] = v
      expectedSums[e] += v
    }
    buffers.push(buf)
  }
  for (let e = 0; e < elementsPerGpu; e++) {
    if (expectedSums[e] > INT16_MAX || expectedSums[e] < INT16_MIN) {
      throw new Error(
        `element ${e} sums to ${expectedSums[e]}, overflowing int16 — ` +
          `use smaller seeds at nRanks=${nRanks} (e.g. (r,e) => (r+1) + (e % 4))`,
      )
    }
  }
  const initialBuffers = buffers.map((b) => Array.from(b))

  // Origin mask per (rank, channel, chunk) — starts as "my own contribution".
  const masks: bigint[][][] = Array.from({ length: nRanks }, (_, r) =>
    Array.from({ length: nChannels }, () =>
      Array.from({ length: nRanks }, () => 1n << BigInt(r)),
    ),
  )

  const elemOffsetOf = (channel: number, chunk: number) =>
    channel * nRanks * chunkElems + chunk * chunkElems

  const frames: AllReduceFrame[] = []
  const framesByGlobalStep: AllReduceFrame[][] = Array.from({ length: totalSteps }, () => [])
  const logs: AllReduceGpuLog[] = Array.from({ length: nRanks }, (_, rank) => ({
    rank,
    received: [],
  }))
  const nLines = ll128Lines(chunkElems * BYTES_PER_ELEM)
  const ticksToProcess = Math.max(1, Math.ceil(chunkElems / lanesPerGpu))

  const mod = (x: number, n: number) => ((x % n) + n) % n

  for (let phaseIdx = 0; phaseIdx < 2; phaseIdx++) {
    const phase: AllReducePhase = phaseIdx === 0 ? 'reduce-scatter' : 'all-gather'
    for (let s = 0; s < phaseSteps; s++) {
      const globalStep = phaseIdx * phaseSteps + s
      for (let c = 0; c < nChannels; c++) {
        const order = ringOrders[c]

        // Snapshot all sends first — transfers within a step are simultaneous.
        const sends: {
          fromRank: number
          toRank: number
          chunk: number
          payload: number[]
          origins: bigint
        }[] = []
        for (let p = 0; p < nRanks; p++) {
          const fromRank = order[p]
          const toRank = order[(p + 1) % nRanks]
          // Phase 1: position p sends chunk (p-s); phase 2: chunk (p+1-s) —
          // the chunk it completed at the end of reduce-scatter.
          const chunk =
            phase === 'reduce-scatter' ? mod(p - s, nRanks) : mod(p + 1 - s, nRanks)
          const off = elemOffsetOf(c, chunk)
          sends.push({
            fromRank,
            toRank,
            chunk,
            payload: Array.from(buffers[fromRank].subarray(off, off + chunkElems)),
            origins: masks[fromRank][c][chunk],
          })
        }

        // Apply receives.
        for (const send of sends) {
          const off = elemOffsetOf(c, send.chunk)
          if (phase === 'reduce-scatter') {
            // The lanes: elementwise ADD into the local chunk; flag ORs.
            for (let e = 0; e < chunkElems; e++) {
              buffers[send.toRank][off + e] += send.payload[e]
            }
            masks[send.toRank][c][send.chunk] |= send.origins
          } else {
            // Pure copy — payload and origin mask pass through unaltered.
            for (let e = 0; e < chunkElems; e++) {
              buffers[send.toRank][off + e] = send.payload[e]
            }
            masks[send.toRank][c][send.chunk] = send.origins
          }

          const frame: AllReduceFrame = {
            phase,
            step: s,
            globalStep,
            channel: c,
            fromRank: send.fromRank,
            toRank: send.toRank,
            chunkIndex: send.chunk,
            elemOffset: off,
            elemCount: chunkElems,
            payload: send.payload,
            origins: send.origins,
            nLines,
            ticksToProcess,
          }
          frames.push(frame)
          framesByGlobalStep[globalStep].push(frame)
          logs[send.toRank].received.push({
            globalStep,
            phase,
            channel: c,
            fromRank: send.fromRank,
            chunkIndex: send.chunk,
            elemOffset: off,
            values: send.payload,
            origins: send.origins,
          })
        }
      }
    }
  }

  return {
    nRanks,
    nChannels,
    chunkElems,
    lanesPerGpu,
    elementsPerGpu,
    totalSteps,
    ringOrders,
    frames,
    framesByGlobalStep,
    initialBuffers,
    finalBuffers: buffers.map((b) => Array.from(b)),
    expectedSums,
    fullMask,
    logs,
  }
}

/**
 * Reconstruct every GPU's buffer after `step` global steps have been applied
 * (0 = initial seeds, totalSteps = final sums). Used by the player's scrubber.
 */
export function buffersAtStep(trace: AllReduceTrace, step: number): number[][] {
  const s = Math.max(0, Math.min(step, trace.totalSteps))
  const bufs = trace.initialBuffers.map((b) => b.slice())
  for (let g = 0; g < s; g++) {
    for (const f of trace.framesByGlobalStep[g]) {
      if (f.phase === 'reduce-scatter') {
        for (let e = 0; e < f.elemCount; e++) bufs[f.toRank][f.elemOffset + e] += f.payload[e]
      } else {
        for (let e = 0; e < f.elemCount; e++) bufs[f.toRank][f.elemOffset + e] = f.payload[e]
      }
    }
  }
  return bufs
}

/** The ranks present in an origin mask, e.g. 0b1011n → [0, 1, 3]. */
export function originsOf(mask: bigint, nRanks: number): number[] {
  const out: number[] = []
  for (let r = 0; r < nRanks; r++) if ((mask >> BigInt(r)) & 1n) out.push(r)
  return out
}

/**
 * The 4-GPU toy: 2 rings (opposite directions), chunk of 2, 16-lane GPUs on
 * int16 — buffer = 2×4×2 = 16 elements. Final sums are 100 + 4e: checkable
 * in your head.
 */
export function toyAllReduce(): AllReduceTrace {
  return simulateAllReduce(
    [
      [0, 1, 2, 3],
      [3, 2, 1, 0], // second channel runs the opposite direction
    ],
    4,
  )
}
