// =============================================================================
// Ring AllGather — frame-level dataflow simulator
//
// Runs the NCCL ring AllGather schedule over the *computed* ring channels and
// emits an origin-tagged, per-frame trace so the dataflow can be watched.
//
// Teaching device (see docs/ORDER-OF-OPERATIONS.md + the tutorial):
// LL128 frames a 128-byte line as 16 x 8-byte words — 15 data words + one
// 8-byte flag word (device.h:110-112). Real NCCL uses that flag as a data-ready
// sync counter; here we OVERLOAD it to carry the "GPU of origin". In AllGather
// data is *copied* hop to hop (never reduced), so the origin passes through
// every GPU untouched — a GPU forwards exactly what it received.
//
// Ring AllGather (N ranks, ring positions 0..N-1, next = pos+1 mod N):
//   - runs N-1 steps
//   - at step s, the GPU at position p sends the chunk it forwarded last step
//     (its own at s=0) to next; that chunk's origin is O[(p - s) mod N]
//   - after N-1 steps every GPU has logged all N origins (its own + N-1 received)
// =============================================================================

// One 128-byte LL128 line carries the origin in its flag word.
const LL128_DATA_BYTES = 120 // 15 x 8-byte data words per 128-byte line

/** A single origin-tagged transfer: one chunk hop, framed as LL128 lines. */
export interface AllGatherFrame {
  step: number // 0-indexed step (0 .. N-2)
  channel: number // which parallel ring/channel
  origin: number // GPU rank that originated this chunk — embedded in the flag, never altered
  fromRank: number // sender GPU rank
  toRank: number // receiver GPU rank
  nLines: number // number of 128-byte LL128 lines this chunk spans
}

/** Per-GPU receive log — the "tcpdump for NCCL frames". */
export interface GpuReceiveLog {
  rank: number
  ownOrigin: number // the chunk this GPU contributed (present from the start)
  received: AllGatherFrame[] // frames received, in step order
  origins: number[] // distinct origins this GPU holds, in the order they arrived
}

export interface AllGatherTrace {
  nRanks: number
  nChannels: number
  nSteps: number // N-1
  ringOrders: number[][] // per channel: ring order as ranks
  frames: AllGatherFrame[] // every frame, ordered by (step, channel)
  framesByStep: AllGatherFrame[][] // frames[step] = all transfers that step
  logs: GpuReceiveLog[] // indexed by rank
  bytesPerChunkPerChannel: number
}

export interface AllGatherOptions {
  /** Total bytes each rank contributes (split across channels). Default 480 B. */
  bytesPerRankChunk?: number
}

/** Number of 128-byte LL128 lines needed for `bytes` of payload (min 1). */
export function ll128Lines(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / LL128_DATA_BYTES))
}

/**
 * Simulate a ring AllGather over the given per-channel ring orders.
 *
 * @param ringOrders One rank-permutation per channel (each a permutation of 0..N-1).
 * @param nRanks     Number of GPUs (must match each ring order's length).
 */
export function simulateAllGather(
  ringOrders: number[][],
  nRanks: number,
  opts: AllGatherOptions = {},
): AllGatherTrace {
  const nChannels = ringOrders.length
  const nSteps = Math.max(0, nRanks - 1)

  const totalBytes = opts.bytesPerRankChunk ?? 480
  const bytesPerChunkPerChannel = nChannels > 0 ? totalBytes / nChannels : totalBytes
  const nLines = ll128Lines(bytesPerChunkPerChannel)

  const logs: GpuReceiveLog[] = Array.from({ length: nRanks }, (_, rank) => ({
    rank,
    ownOrigin: rank,
    received: [],
    origins: [rank], // a GPU starts holding its own contribution
  }))

  const frames: AllGatherFrame[] = []
  const framesByStep: AllGatherFrame[][] = Array.from({ length: nSteps }, () => [])

  for (let c = 0; c < nChannels; c++) {
    const order = ringOrders[c]
    if (order.length !== nRanks) {
      throw new Error(
        `ring order for channel ${c} has ${order.length} ranks, expected ${nRanks}`,
      )
    }
    for (let s = 0; s < nSteps; s++) {
      for (let p = 0; p < nRanks; p++) {
        const fromRank = order[p]
        const toRank = order[(p + 1) % nRanks]
        const originPos = ((p - s) % nRanks + nRanks) % nRanks
        const origin = order[originPos]

        const frame: AllGatherFrame = { step: s, channel: c, origin, fromRank, toRank, nLines }
        frames.push(frame)
        framesByStep[s].push(frame)

        // Receiver logs the frame; origin is recorded verbatim (never altered).
        const log = logs[toRank]
        log.received.push(frame)
        if (!log.origins.includes(origin)) log.origins.push(origin)
      }
    }
  }

  return {
    nRanks,
    nChannels,
    nSteps,
    ringOrders,
    frames,
    framesByStep,
    logs,
    bytesPerChunkPerChannel,
  }
}

/** Extract the trailing integer of a node id ("gpu-3" -> 3, "s0-gpu-5" -> 5). */
export function defaultRankOf(nodeId: string): number {
  const m = nodeId.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : -1
}

/**
 * Rank mapper for cluster node ids: "s2-gpu-3" with 8 GPUs/server → rank 19.
 * Matches multi-node.ts's global rank assignment (rank + server*gpuCount).
 */
export function clusterRankOf(gpuPerServer: number): (nodeId: string) => number {
  return (nodeId) => {
    const m = nodeId.match(/^s(\d+)-gpu-(\d+)$/)
    if (!m) return -1
    return parseInt(m[1], 10) * gpuPerServer + parseInt(m[2], 10)
  }
}

/**
 * Derive per-channel rank orders from a computed ring graph.
 * `rankOf` maps a GPU node id to its rank (defaults to the trailing integer).
 */
export function ringOrdersFromGraph(
  ringGraph: { channels: { ringOrder: string[] }[] },
  rankOf: (id: string) => number = defaultRankOf,
): number[][] {
  return ringGraph.channels
    .map((ch) => ch.ringOrder.map(rankOf))
    .filter((order) => order.length > 0 && order.every((r) => r >= 0))
}
