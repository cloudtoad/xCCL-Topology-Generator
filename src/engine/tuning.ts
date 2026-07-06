// =============================================================================
// Algorithm/Protocol Selection — mirrors tuning.cc from NCCL source
//
// Simplified tuning logic that selects the best algorithm (ring/tree) and
// protocol (LL/LL128/SIMPLE) based on message size, rank count, and hardware.
// =============================================================================

import type { TopoSystem, TopoGraph } from './types'
import { Algorithm, Protocol, LinkType, NodeType } from './types'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'
import { DecisionLog } from './decision-log'
import {
  NCCL_MAX_NTHREADS,
  NCCL_MIN_NTHREADS,
  NCCL_SIMPLE_MAX_NTHREADS,
  NCCL_LL_MAX_NTHREADS,
  NCCL_LL128_MAX_NTHREADS,
  nvlsEfficiency,
  nvlsRuntimeChannels,
  NVLS_SIMPLE_HW_LATENCY,
} from './constants/nccl'

// =============================================================================
// Types
// =============================================================================

export interface TuningResult {
  algorithm: Algorithm
  protocol: Protocol
  bandwidth: number   // Estimated effective bandwidth in GB/s
  latency: number     // Estimated latency in microseconds
  nChannels: number   // Number of channels to use
  nThreads: number    // Number of threads per channel
}

// =============================================================================
// Message size thresholds (tuning.cc)
// =============================================================================

const SMALL_MSG_THRESHOLD = 4 * 1024           // 4 KB
const MEDIUM_MSG_THRESHOLD = 512 * 1024        // 512 KB

// Latency constants (simplified from tuning.cc latency tables)
const BASE_LATENCY_LL = 3.0       // microseconds
const BASE_LATENCY_LL128 = 3.5
const BASE_LATENCY_SIMPLE = 5.0

// Per-rank latency contribution
const PER_RANK_LATENCY_RING = 2.0
const PER_RANK_LATENCY_TREE = 1.0  // tree has log(n) depth

// NVLS reduces in-network at the NVSwitch. Its intra-node latency is a fixed
// NVLink Simple hop (~25 us, tuning.cc hwLatencies) — independent of rank count,
// but NOT low: NVLS wins on bandwidth for large messages, not on latency.

// =============================================================================
// hasNvLink — check if the system has NVLink interconnects
// =============================================================================
function hasNvLink(system: TopoSystem): boolean {
  return system.links.some((link) => link.type === LinkType.NVL)
}

// =============================================================================
// selectProtocol — choose LL, LL128, or SIMPLE based on message size and hardware
//
// From tuning.cc:
//   - Small messages (<= 4KB): LL protocol (low-latency, minimal overhead)
//   - Medium messages (4KB-512KB): LL128 if NVLink present, else LL
//   - Large messages (> 512KB): SIMPLE protocol (high throughput)
// =============================================================================
function selectProtocol(
  messageSize: number,
  nvlink: boolean,
  forcedProto: number,
  log: DecisionLog,
): Protocol {
  // Check for forced protocol via NCCL_PROTO env var
  if (forcedProto >= 0 && forcedProto <= 2) {
    const protoNames: Record<number, string> = { 0: 'LL', 1: 'LL128', 2: 'SIMPLE' }
    log.emit(
      'channelSetup',
      `Protocol forced to ${protoNames[forcedProto]} via NCCL_PROTO=${forcedProto}`,
      'User override — skipping automatic protocol selection',
      'tuning.cc:552',
      ['LL', 'LL128', 'SIMPLE'].filter((p) => p !== protoNames[forcedProto]),
    )
    return forcedProto as Protocol
  }

  if (messageSize <= SMALL_MSG_THRESHOLD) {
    log.emit(
      'channelSetup',
      `Protocol: LL (message size ${messageSize} <= ${SMALL_MSG_THRESHOLD})`,
      'Small messages use LL protocol for minimum latency',
      'tuning.cc:480',
      ['LL128', 'SIMPLE'],
      { messageSize, threshold: SMALL_MSG_THRESHOLD },
    )
    return Protocol.LL
  }

  if (messageSize <= MEDIUM_MSG_THRESHOLD) {
    if (nvlink) {
      log.emit(
        'channelSetup',
        `Protocol: LL128 (message size ${messageSize}, NVLink present)`,
        'Medium messages with NVLink use LL128 for 128B granularity and low overhead',
        'tuning.cc:490',
        ['LL', 'SIMPLE'],
        { messageSize, nvlink },
      )
      return Protocol.LL128
    }

    log.emit(
      'channelSetup',
      `Protocol: LL (message size ${messageSize}, no NVLink)`,
      'Medium messages without NVLink use LL (LL128 requires NVLink)',
      'tuning.cc:495',
      ['LL128', 'SIMPLE'],
      { messageSize, nvlink },
    )
    return Protocol.LL
  }

  // Large messages
  log.emit(
    'channelSetup',
    `Protocol: SIMPLE (message size ${messageSize} > ${MEDIUM_MSG_THRESHOLD})`,
    'Large messages use SIMPLE protocol for maximum throughput',
    'tuning.cc:500',
    ['LL', 'LL128'],
    { messageSize, threshold: MEDIUM_MSG_THRESHOLD },
  )
  return Protocol.SIMPLE
}

// =============================================================================
// selectAlgo — choose RING or TREE based on rank count and message size
//
// Simplified heuristic from tuning.cc:
//   - Ring preferred for > 8 ranks or large messages (ring scales better)
//   - Tree preferred for <= 8 ranks and medium messages (lower latency at depth)
// =============================================================================
function selectAlgo(
  messageSize: number,
  nRanks: number,
  forcedAlgo: number,
  ringGraph: TopoGraph | null,
  treeGraph: TopoGraph | null,
  nvlsGraph: TopoGraph | null,
  isInter: boolean,
  log: DecisionLog,
): Algorithm {
  // Check for forced algorithm via NCCL_ALGO env var
  if (forcedAlgo >= 0 && forcedAlgo <= 5) {
    const algoNames: Record<number, string> = {
      0: 'RING', 1: 'TREE', 2: 'COLLNET_DIRECT',
      3: 'COLLNET_CHAIN', 4: 'NVLS', 5: 'NVLS_TREE',
    }
    log.emit(
      'channelSetup',
      `Algorithm forced to ${algoNames[forcedAlgo]} via NCCL_ALGO=${forcedAlgo}`,
      'User override — skipping automatic algorithm selection',
      'tuning.cc:540',
      Object.values(algoNames).filter((a) => a !== algoNames[forcedAlgo]),
    )
    return forcedAlgo as Algorithm
  }

  // NVLS / NVLS_TREE: when a supported NVLS graph exists it delivers the highest
  // all-reduce bandwidth on a Hopper+ NVSwitch fabric (the switch reduces
  // in-network). NVLS targets medium/large messages; the tiniest messages still
  // favor a low-latency tree, so gate on the small-message threshold.
  // Multi-node systems use NVLS_TREE (NVLS intra-node + tree across nodes).
  // ("NVLS/NVLStree needs at least 2 channels" — tuning.cc:309.)
  if (nvlsGraph && nvlsGraph.nChannels >= 2 && messageSize > SMALL_MSG_THRESHOLD) {
    const algo = isInter ? Algorithm.NVLS_TREE : Algorithm.NVLS
    log.emit(
      'channelSetup',
      `Algorithm: ${Algorithm[algo]} (NVLS supported, messageSize=${messageSize})`,
      'NVLink SHARP reduces in-network at the NVSwitch — highest all-reduce ' +
        'bandwidth and lowest latency for medium/large messages',
      'tuning.cc:ncclTopoTuneModel',
      ['RING', 'TREE'],
      { messageSize, isInter, nvlsChannels: nvlsGraph.nChannels },
    )
    return algo
  }

  // If only one graph is available, use that
  if (ringGraph && !treeGraph) {
    log.emit(
      'channelSetup',
      'Algorithm: RING (no tree graph available)',
      'Tree graph was not computed; defaulting to ring algorithm',
      'tuning.cc:550',
      ['TREE'],
    )
    return Algorithm.RING
  }

  if (!ringGraph && treeGraph) {
    log.emit(
      'channelSetup',
      'Algorithm: TREE (no ring graph available)',
      'Ring graph was not computed; defaulting to tree algorithm',
      'tuning.cc:555',
      ['RING'],
    )
    return Algorithm.TREE
  }

  // Heuristic selection
  if (nRanks > 8) {
    log.emit(
      'channelSetup',
      `Algorithm: RING (nRanks=${nRanks} > 8)`,
      'Ring algorithm preferred for larger rank counts — better bandwidth scaling',
      'tuning.cc:560',
      ['TREE'],
      { nRanks },
    )
    return Algorithm.RING
  }

  if (messageSize > MEDIUM_MSG_THRESHOLD) {
    log.emit(
      'channelSetup',
      `Algorithm: RING (large message size ${messageSize} > ${MEDIUM_MSG_THRESHOLD})`,
      'Ring algorithm preferred for large messages — higher sustained throughput',
      'tuning.cc:565',
      ['TREE'],
      { messageSize, threshold: MEDIUM_MSG_THRESHOLD },
    )
    return Algorithm.RING
  }

  // Small/medium messages with <= 8 ranks: tree is better
  log.emit(
    'channelSetup',
    `Algorithm: TREE (nRanks=${nRanks} <= 8, message size ${messageSize})`,
    'Tree algorithm preferred for small rank counts with small/medium messages — lower latency',
    'tuning.cc:570',
    ['RING'],
    { nRanks, messageSize },
  )
  return Algorithm.TREE
}

// =============================================================================
// computeThreadCount — determine nThreads for the selected protocol
// =============================================================================
function computeThreadCount(protocol: Protocol, forcedThreads: number): number {
  if (forcedThreads > 0) {
    // Clamp to valid range
    return Math.max(NCCL_MIN_NTHREADS, Math.min(forcedThreads, NCCL_MAX_NTHREADS))
  }

  switch (protocol) {
    case Protocol.LL:
      return NCCL_LL_MAX_NTHREADS
    case Protocol.LL128:
      return NCCL_LL128_MAX_NTHREADS
    case Protocol.SIMPLE:
      return NCCL_SIMPLE_MAX_NTHREADS
    default:
      return NCCL_SIMPLE_MAX_NTHREADS
  }
}

// =============================================================================
// estimateBandwidth — estimate effective bandwidth for the algorithm/protocol
// =============================================================================
function estimateBandwidth(
  algorithm: Algorithm,
  protocol: Protocol,
  nChannels: number,
  nRanks: number,
  graphBandwidth: number,
  nvls?: { efficiency: number; runtimeChannels: number },
): number {
  // Bus bandwidth: for ring, effective BW = (nRanks-1)/nRanks * nChannels * linkBW
  // For tree, effective BW = nChannels * linkBW / 2 (binary tree overhead)
  let busBw: number

  if ((algorithm === Algorithm.NVLS || algorithm === Algorithm.NVLS_TREE) && nvls) {
    // NCCL (tuning.cc:306-325): per-channel NVLS bw =
    //   bwIntra × nvlsEfficiency × (nHeads-1)/nHeads, then ×2 for AllReduce
    //   ("AllReduce pipelines two operations" — reduce + broadcast overlap in
    //   the switch); total busBw = nHeads(graph channels) × that.
    // DGX H100: 8 × 40 × 0.85 × 7/8 × 2 = 476 GB/s ≈ real-world NVLS AllReduce.
    // Note the multiplier is the GRAPH head count, not the runtime CTA count.
    const headFactor = nChannels > 1 ? (nChannels - 1) / nChannels : 1
    busBw = nChannels * graphBandwidth * nvls.efficiency * headFactor * 2
  } else if (algorithm === Algorithm.RING) {
    busBw = graphBandwidth * nChannels * (nRanks > 1 ? (nRanks - 1) / nRanks : 1)
  } else {
    busBw = graphBandwidth * nChannels * 0.5
  }

  // Protocol overhead factor
  switch (protocol) {
    case Protocol.LL:
      return busBw * 0.5    // LL uses 50% of bandwidth for flags
    case Protocol.LL128:
      return busBw * 0.875  // LL128 uses 120/128 bytes for data
    case Protocol.SIMPLE:
      return busBw           // SIMPLE uses full bandwidth
    default:
      return busBw
  }
}

// =============================================================================
// estimateLatency — estimate latency for the algorithm/protocol combination
// =============================================================================
function estimateLatency(
  algorithm: Algorithm,
  protocol: Protocol,
  nRanks: number,
): number {
  let baseLatency: number
  switch (protocol) {
    case Protocol.LL:
      baseLatency = BASE_LATENCY_LL
      break
    case Protocol.LL128:
      baseLatency = BASE_LATENCY_LL128
      break
    case Protocol.SIMPLE:
      baseLatency = BASE_LATENCY_SIMPLE
      break
    default:
      baseLatency = BASE_LATENCY_SIMPLE
  }

  if (algorithm === Algorithm.RING) {
    // Ring latency scales linearly with nRanks
    return baseLatency + PER_RANK_LATENCY_RING * nRanks
  }

  const depth = nRanks > 1 ? Math.ceil(Math.log2(nRanks)) : 0

  // NVLS (tuning.cc:424): latency = the NVLink Simple hop (~25 us), independent
  // of rank count. NVLS_TREE adds a logarithmic inter-node tree term. Note this
  // is NOT lower than tree/ring — NVLS is a bandwidth win, not a latency win.
  if (algorithm === Algorithm.NVLS) {
    return NVLS_SIMPLE_HW_LATENCY
  }
  if (algorithm === Algorithm.NVLS_TREE) {
    return NVLS_SIMPLE_HW_LATENCY + PER_RANK_LATENCY_TREE * depth
  }

  // Tree latency scales logarithmically
  return baseLatency + PER_RANK_LATENCY_TREE * depth
}

// =============================================================================
// selectAlgorithm — main tuning entry point (tuning.cc)
//
// Combines protocol selection, algorithm selection, and bandwidth/latency
// estimation into a single TuningResult.
// =============================================================================
export function selectAlgorithm(
  system: TopoSystem,
  ringGraph: TopoGraph | null,
  treeGraph: TopoGraph | null,
  nvlsGraph: TopoGraph | null,
  messageSize: number,
  nRanks: number,
  ccMin: number,
  env: EnvConfig,
  log: DecisionLog,
): TuningResult {
  log.emit(
    'channelSetup',
    `Tuning: selecting algorithm/protocol for ${nRanks} ranks, messageSize=${messageSize}`,
    'Evaluating ring vs. tree algorithm and LL/LL128/SIMPLE protocol',
    'tuning.cc:300',
    [],
    { nRanks, messageSize },
  )

  // Read forced env vars (-2 = auto)
  const forcedAlgo = getEnvInt(env, 'NCCL_ALGO')
  const forcedProto = getEnvInt(env, 'NCCL_PROTO')
  const forcedThreads = getEnvInt(env, 'NCCL_NTHREADS')

  // Check for NVLink
  const nvlink = hasNvLink(system)

  // Select algorithm first — NVLS constrains the protocol.
  const algorithm = selectAlgo(
    messageSize, nRanks, forcedAlgo, ringGraph, treeGraph, nvlsGraph, system.inter, log,
  )
  const isNvls = algorithm === Algorithm.NVLS || algorithm === Algorithm.NVLS_TREE

  // Select protocol. NVLS/NVLS_TREE are SIMPLE-only (tuning.cc:301).
  let protocol = selectProtocol(messageSize, nvlink, forcedProto, log)
  if (isNvls && protocol !== Protocol.SIMPLE) {
    log.emit(
      'channelSetup',
      'Protocol: SIMPLE (forced — NVLS supports SIMPLE only)',
      'NVLS/NVLS_TREE run only over the SIMPLE protocol (tuning.cc:301)',
      'tuning.cc:301',
      ['LL', 'LL128'],
    )
    protocol = Protocol.SIMPLE
  }

  // Determine channel count and bandwidth from the selected graph
  const selectedGraph = isNvls
    ? nvlsGraph
    : algorithm === Algorithm.TREE
      ? treeGraph
      : ringGraph
  const graphChannels = selectedGraph?.nChannels ?? 1
  const graphBandwidth = selectedGraph?.speedIntra ?? 0

  // NVLS runtime CTA count (nvls.cc:203-213): SM90=16, SM100 single=24 / multi=32,
  // overridable by NCCL_NVLS_NCHANNELS. This is the channel count that actually
  // drives the collective — distinct from the graph's per-GPU head count.
  let nvlsCtx: { efficiency: number; runtimeChannels: number } | undefined
  let reportedChannels = graphChannels
  if (isNvls) {
    let runtimeChannels = nvlsRuntimeChannels(ccMin, system.inter)
    const nvlsOverride = getEnvInt(env, 'NCCL_NVLS_NCHANNELS')
    if (nvlsOverride > 0) runtimeChannels = nvlsOverride
    nvlsCtx = { efficiency: nvlsEfficiency(ccMin), runtimeChannels }
    reportedChannels = runtimeChannels
  }

  // Compute threads
  const nThreads = computeThreadCount(protocol, forcedThreads)

  // Estimate bandwidth and latency
  const bandwidth = estimateBandwidth(algorithm, protocol, graphChannels, nRanks, graphBandwidth, nvlsCtx)
  const latency = estimateLatency(algorithm, protocol, nRanks)
  const nChannels = reportedChannels

  const result: TuningResult = {
    algorithm,
    protocol,
    bandwidth,
    latency,
    nChannels,
    nThreads,
  }

  const algoName = Algorithm[algorithm]
  const protoName = Protocol[protocol]

  log.emit(
    'channelSetup',
    `Tuning result: ${algoName} + ${protoName}`,
    `BW=${bandwidth.toFixed(2)} GB/s, latency=${latency.toFixed(1)} us, ` +
      `nChannels=${nChannels}, nThreads=${nThreads}`,
    'tuning.cc:600',
    [],
    {
      algorithm: algoName,
      protocol: protoName,
      bandwidth,
      latency,
      nChannels,
      nThreads,
      forcedAlgo,
      forcedProto,
      forcedThreads,
    },
  )

  return result
}
