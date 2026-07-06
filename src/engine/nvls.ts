// =============================================================================
// NVLS (NVLink SHARP) — mirrors nvls.cc / the NVLS path of search.cc + init.cc
//
// NVLS offloads the reduction of collectives (all-reduce, reduce-scatter,
// all-gather) into the NVSwitch fabric itself. Instead of GPUs exchanging data
// around a ring, every GPU writes its contribution once into a hardware
// multicast group on the NVSwitch; the switch reduces in-network (SHARP) and
// multicasts the result back to every GPU. This collapses an O(N) ring into a
// single switch hop, so NVLS delivers the highest all-reduce bandwidth and the
// lowest latency of any algorithm — but only on hardware that supports it.
//
// Requirements (matching NCCL's nvlsSupport):
//   1. SM90+ (Hopper) GPUs                — hardware multicast/SHARP
//   2. A 3rd-generation NVSwitch fabric   — every GPU reaches a common switch
//   3. NCCL_NVLS_ENABLE != 0              — not disabled by the operator
// =============================================================================

import { NodeType, LinkType, PathType, GraphPattern } from './types'
import type {
  TopoSystem,
  TopoGraph,
  GraphChannel,
  TopoNode,
  TopoPath,
} from './types'
import {
  nvlinkBw,
  getSpeedArrays,
  NVLS_MIN_COMPUTE_CAP,
  NCCL_MAX_NVLS_ARITY,
} from './constants/nccl'
import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'

// =============================================================================
// Types
// =============================================================================

export interface NvlsSupport {
  supported: boolean
  reason: string
  /** Number of GPUs in the NVLink domain (the multicast group size). */
  nGpus: number
  /** Number of NVSwitches the GPUs share. */
  nSwitches: number
}

// =============================================================================
// Helpers
// =============================================================================

function pathKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`
}

/** Best NVLink path from a GPU to any NVSwitch (the switch it will anchor on). */
function bestSwitchPath(
  system: TopoSystem,
  gpu: TopoNode,
  switches: TopoNode[],
): { nvs: TopoNode; bw: number } | null {
  let best: { nvs: TopoNode; bw: number } | null = null
  for (const nvs of switches) {
    const p: TopoPath | undefined = system.paths.get(pathKey(gpu.id, nvs.id))
    // NVLS only forms over a direct NVLink hop to the switch (PATH_NVL).
    if (p && p.type === PathType.NVL) {
      if (!best || p.bandwidth > best.bw) best = { nvs, bw: p.bandwidth }
    }
  }
  // Fall back to a direct NVL link if paths weren't computed for GPU→NVS pairs.
  if (!best) {
    for (const nvs of switches) {
      const link = system.links.find(
        (l) => l.fromId === gpu.id && l.toId === nvs.id && l.type === LinkType.NVL,
      )
      if (link && (!best || link.bandwidth > best.bw)) best = { nvs, bw: link.bandwidth }
    }
  }
  return best
}

// =============================================================================
// nvlsSupport — mirrors NCCL's nvlsSupport gating (init.cc / nvls.cc)
// =============================================================================

export function nvlsSupport(
  system: TopoSystem,
  ccMin: number,
  env: EnvConfig,
  log: DecisionLog,
): NvlsSupport {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []
  const switches = system.nodesByType.get(NodeType.NVS) ?? []
  const result = (supported: boolean, reason: string): NvlsSupport => {
    log.emit(
      'nvlsSearch',
      supported ? 'NVLS supported' : 'NVLS not supported',
      reason,
      'init.cc:nvlsSupport',
      [],
      { supported, ccMin, nGpus: gpus.length, nSwitches: switches.length },
    )
    return { supported, reason, nGpus: gpus.length, nSwitches: switches.length }
  }

  // (1) Operator override — NCCL_NVLS_ENABLE: -2/auto or 1 = on, 0 = off.
  const enable = getEnvInt(env, 'NCCL_NVLS_ENABLE')
  if (enable === 0) {
    return result(false, 'Disabled by NCCL_NVLS_ENABLE=0')
  }

  // (2) SM90+ (Hopper) — hardware multicast / SHARP support.
  if (ccMin < NVLS_MIN_COMPUTE_CAP) {
    // compCap 0 means a non-NVIDIA (e.g. AMD) topology — NVLS is NVIDIA-only.
    const reason =
      ccMin === 0
        ? 'NVLS is NVIDIA-only (NVLink SHARP); this is a non-NVIDIA topology'
        : `Requires SM${NVLS_MIN_COMPUTE_CAP}+ (Hopper) for hardware multicast; ` +
          `min compute cap is ${ccMin}`
    return result(false, reason)
  }

  // (3) An NVSwitch fabric must be present.
  if (switches.length === 0) {
    return result(
      false,
      'No NVSwitch present — NVLink SHARP requires a 3rd-gen NVSwitch fabric',
    )
  }

  // (4) Every GPU must reach a common switch over a direct NVLink hop.
  if (gpus.length < 2) {
    return result(false, `NVLS needs at least 2 GPUs; found ${gpus.length}`)
  }
  for (const gpu of gpus) {
    if (!bestSwitchPath(system, gpu, switches)) {
      return result(
        false,
        `${gpu.label ?? gpu.id} has no direct NVLink path to any NVSwitch`,
      )
    }
  }

  return result(
    true,
    `SM${ccMin} GPUs on ${switches.length}-way NVSwitch fabric; ` +
      (enable === 1 ? 'forced on by NCCL_NVLS_ENABLE=1' : 'enabled by auto-detection'),
  )
}

// =============================================================================
// computeNvlsGraph — the NVLS "graph" is a multicast star, not a ring
//
// Each channel is a reduction group anchored on one NVSwitch. Per-channel
// injection speed is drawn from the same compute-cap speed table used for the
// ring/tree search (the highest tabulated speed a single GPU→switch NVLink can
// sustain). The channel count is bounded by the GPU's aggregate NVLink
// bandwidth into the fabric, then capped like NCCL does (ncclParamNvlsChannels,
// default 16) or overridden by NCCL_NVLS_NCHANNELS.
// =============================================================================

export function computeNvlsGraph(
  system: TopoSystem,
  ccMin: number,
  log: DecisionLog,
): TopoGraph {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []
  const switches = system.nodesByType.get(NodeType.NVS) ?? []
  const switchIds = new Set(switches.map((s) => s.id))
  const nGpus = gpus.length

  // NVLS graph channel count = one head per GPU (search.cc:450 "NVLS channels
  // correspond to GPUs pulling from NVLS"), capped at NCCL_MAX_NVLS_ARITY.
  // Single-node forces minChannels=maxChannels to "pull evenly from all GPUs"
  // (search.cc:1126,1135) → exactly nGPUs. (This is distinct from the runtime
  // CTA count in nvlsRuntimeChannels(), which is 16/24/32 by arch.)
  const nChannels = Math.max(1, Math.min(NCCL_MAX_NVLS_ARITY, nGpus))

  // Aggregate GPU→fabric NVLink bandwidth (sum of a GPU's switch uplinks).
  // Every head channel moves data on EVERY GPU's uplink (ncclTopoSearchTryNvls
  // follows GPU↔NVS for all GPUs per channel), so nHeads channels share the
  // aggregate: per-channel speed = highest table entry ≤ aggregate / nHeads.
  // DGX H100: 370.8 / 8 = 46.35 → 40 — matching the real GRAPH dump in
  // NVIDIA/nccl#1197 ("Pattern 5 … bw 40.000000/…").
  let aggregate = Infinity
  for (const gpu of gpus) {
    let sum = 0
    for (const link of system.links) {
      if (link.fromId === gpu.id && link.type === LinkType.NVL && switchIds.has(link.toId)) {
        sum += link.bandwidth
      }
    }
    if (sum > 0 && sum < aggregate) aggregate = sum
  }
  if (!Number.isFinite(aggregate)) aggregate = nvlinkBw(ccMin)
  const perChannelCap = aggregate / nChannels

  const speedArray = getSpeedArrays(ccMin, false)
  let speed = speedArray[speedArray.length - 1]
  for (const s of speedArray) {
    if (s <= perChannelCap) {
      speed = s
      break
    }
  }

  log.emit(
    'nvlsSearch',
    `NVLS graph: ${nChannels} head channel(s) @ ${speed} GB/s`,
    `One channel per GPU head (cap NCCL_MAX_NVLS_ARITY=${NCCL_MAX_NVLS_ARITY}; single-node ` +
      `forces nChannels=nGPUs, search.cc:1126,1135). Aggregate uplink ${aggregate.toFixed(1)} ` +
      `GB/s ÷ ${nChannels} heads = ${perChannelCap.toFixed(1)} cap → table speed ${speed}`,
    'search.cc:NCCL_TOPO_PATTERN_NVLS / ncclTopoSearchTryNvls',
    ['Ring', 'Tree'],
    { nChannels, speed, aggregate, perChannelCap, nGpus, ccMin },
  )

  // Each channel is one GPU's head; every GPU is a member of the multicast
  // group, and heads round-robin across the NVSwitch fabric.
  const gpuIds = gpus.map((g) => g.id)
  const channels: GraphChannel[] = []
  for (let c = 0; c < nChannels; c++) {
    const anchorSwitch = switches.length > 0 ? switches[c % switches.length].id : undefined
    channels.push({
      id: c,
      bandwidth: speed,
      ringOrder: [...gpuIds], // consumers that expect an intra order still work
      nvlsSwitch: anchorSwitch,
      nvlsGpus: [...gpuIds],
      nvlsHead: gpuIds[c % Math.max(1, nGpus)],
    })
  }

  return {
    id: 'nvls',
    pattern: GraphPattern.NVLS,
    nChannels,
    channels,
    speedIntra: speed,
    speedInter: system.inter ? speed : 0,
    typeIntra: LinkType.NVL,
    typeInter: system.inter ? LinkType.NET : LinkType.NVL,
  }
}
