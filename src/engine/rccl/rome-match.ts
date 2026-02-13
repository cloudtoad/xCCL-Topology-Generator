// =============================================================================
// RCCL Rome Model Matching — mirrors rome_models.cc matching algorithm
//
// When RCCL detects an AMD GPU topology, it attempts to match against a set
// of pre-computed models. If a match is found, the pre-computed ring/tree
// orderings are used directly, bypassing the expensive graph search.
//
// The matching process:
//   1. Extract topology info from the system (parseRomeSystem equivalent)
//   2. For each model, check if basic properties match (nGpus, nCpus, nNics, nLinks)
//   3. If basic props match, check pattern string
//   4. Attempt GPU permutation matching (permuteGpuIds)
//   5. If GPUs match, attempt NIC permutation matching (permuteNetIds)
//   6. If all match, parse the model's ring/tree orderings
// =============================================================================

import type { TopoSystem, HardwareConfig, TopoGraph, GraphChannel } from '../types'
import { NodeType, LinkType, GraphPattern } from '../types'
import type { RcclRomeModel } from './rome-models'
import { romeTopoModels } from './rome-models'
import { DecisionLog } from '../decision-log'
import type { EnvConfig } from '../env'
import { getEnvInt } from '../env'

// =============================================================================
// Types
// =============================================================================

export interface RomeMatchResult {
  model: RcclRomeModel
  gpuPermutation: number[]   // Maps model GPU index -> system GPU index
  nicPermutation: number[]   // Maps model NIC index -> system NIC index
  ringGraph: TopoGraph
}

// =============================================================================
// Topology extraction — equivalent to parseRomeSystem (rome_models.cc:2189-2357)
// =============================================================================

interface ExtractedTopology {
  nGpus: number
  nCpus: number
  nNics: number
  nLinks: number
  gpuNuma: number[]
  nicNuma: number[]
  connMatrix: number[]
  pattern: string
}

/**
 * Extract topology characteristics from system in the format needed for
 * model matching. This replaces parseRomeSystem which probes real hardware.
 */
function extractTopology(config: HardwareConfig): ExtractedTopology {
  const nGpus = config.gpu.count
  const nCpus = config.cpu.count
  const nNics = config.nic.count

  // Determine link count from nvlinksPerPair
  // For all-to-all xGMI: nLinks = nGpus - 1
  // For partial mesh: nLinks = nvlinksPerPair (but capped at actual connections)
  const nLinks = Math.min(config.gpu.nvlinksPerPair, nGpus - 1)

  // GPU NUMA mapping
  const gpuNuma = config.numaMapping.slice(0, nGpus)

  // NIC NUMA mapping (round-robin across CPUs)
  const nicNuma: number[] = []
  for (let i = 0; i < nNics; i++) {
    nicNuma.push(i % nCpus)
  }

  // Connectivity matrix — for all-to-all, every pair is connected
  const connMatrix: number[] = new Array(nGpus * nGpus).fill(0)
  if (nLinks >= nGpus - 1) {
    // All-to-all topology
    for (let i = 0; i < nGpus; i++) {
      for (let j = 0; j < nGpus; j++) {
        if (i !== j) connMatrix[i * nGpus + j] = 1
      }
    }
  } else {
    // Partial mesh — we construct a symmetric connectivity pattern
    // based on typical AMD topologies
    for (let i = 0; i < nGpus; i++) {
      let linksUsed = 0
      for (let j = 0; j < nGpus && linksUsed < nLinks; j++) {
        if (i === j) continue
        if (connMatrix[i * nGpus + j] === 0) {
          connMatrix[i * nGpus + j] = 1
          connMatrix[j * nGpus + i] = 1
          linksUsed++
        }
      }
    }
  }

  // Build pattern string: two digits per NUMA node (gpu_count + nic_count)
  // e.g. "4040" means NUMA0 has 4 GPUs + 0 NICs, NUMA1 has 4 GPUs + 0 NICs
  const numaGpuCount: number[] = new Array(nCpus).fill(0)
  const numaNicCount: number[] = new Array(nCpus).fill(0)
  for (const numa of gpuNuma) numaGpuCount[numa]++
  for (const numa of nicNuma) numaNicCount[numa]++

  let pattern = ''
  for (let i = 0; i < nCpus; i++) {
    pattern += `${numaGpuCount[i]}${numaNicCount[i]}`
  }

  return { nGpus, nCpus, nNics, nLinks, gpuNuma, nicNuma, connMatrix, pattern }
}

// =============================================================================
// Permutation matching — mirrors permuteGpuIds (rome_models.cc:2359-2399)
// =============================================================================

const MAX_PERMUTE_TIME = 100000 // Timeout for permutation search

/**
 * Try all permutations of GPU indices to find one that makes the system
 * topology match the reference model.
 *
 * Checks: NUMA assignment, xGMI connectivity matrix.
 */
function permuteGpuIds(
  perm: number[],
  pos: number,
  last: number,
  ref: RcclRomeModel,
  topo: ExtractedTopology,
  time: { count: number },
): boolean {
  time.count++
  if (time.count > MAX_PERMUTE_TIME) return false

  if (pos === last) {
    // Base case: check if this permutation produces a valid match

    // 1. Check NUMA assignment match
    for (let i = 0; i < ref.nGpus; i++) {
      if (ref.gpuNuma[i] !== topo.gpuNuma[perm[i]]) return false
    }

    // 2. Check connectivity matrix match
    for (let i = 0; i < ref.nGpus; i++) {
      for (let j = 0; j < ref.nGpus; j++) {
        if (ref.connMatrix[i * ref.nGpus + j] !== topo.connMatrix[perm[i] * ref.nGpus + perm[j]]) {
          return false
        }
      }
    }

    return true
  }

  // Recursive case: try all swaps at position pos
  for (let i = pos; i <= last; i++) {
    // Swap perm[pos] and perm[i]
    const tmp = perm[pos]
    perm[pos] = perm[i]
    perm[i] = tmp

    if (permuteGpuIds(perm, pos + 1, last, ref, topo, time)) return true

    // Swap back
    perm[i] = perm[pos]
    perm[pos] = tmp
  }

  return false
}

/**
 * Try all permutations of NIC indices to find one that matches GDR levels.
 */
function permuteNetIds(
  perm: number[],
  gpuPerm: number[],
  pos: number,
  last: number,
  ref: RcclRomeModel,
  topo: ExtractedTopology,
  time: { count: number },
): boolean {
  time.count++
  if (time.count > MAX_PERMUTE_TIME) return false

  if (pos === last) {
    // Check NIC NUMA assignment
    for (let i = 0; i < ref.nNics; i++) {
      if (ref.nicNuma[i] !== topo.nicNuma[perm[i]]) return false
    }

    // For GDR level matching, we'd need actual path data which our
    // config-driven builder doesn't have at this stage. Accept if
    // NUMA matches for now.
    return true
  }

  for (let i = pos; i <= last; i++) {
    const tmp = perm[pos]
    perm[pos] = perm[i]
    perm[i] = tmp

    if (permuteNetIds(perm, gpuPerm, pos + 1, last, ref, topo, time)) return true

    perm[i] = perm[pos]
    perm[pos] = tmp
  }

  return false
}

// =============================================================================
// Ring parsing — parse pre-computed ring orderings from model data
// =============================================================================

/**
 * Parse a ring base string like "0 1 2 3 4 5 6 7|7 6 5 4 3 2 1 0"
 * into arrays of GPU indices. NIC references (N0, N1, etc.) are stripped
 * since we only need the GPU ordering for ring construction.
 *
 * The gpuPermutation maps model indices to actual system GPU indices.
 */
function parseRingBase(
  ringBase: string,
  gpuPermutation: number[],
): string[][] {
  const rings: string[][] = []

  for (const ringStr of ringBase.split('|')) {
    const tokens = ringStr.trim().split(/\s+/)
    const gpuOrder: string[] = []

    for (const token of tokens) {
      // Skip NIC references (N0, N1, etc.)
      if (token.startsWith('N')) continue

      const modelIdx = parseInt(token, 10)
      if (isNaN(modelIdx)) continue

      // Map model GPU index -> system GPU index via permutation
      const systemIdx = gpuPermutation[modelIdx]
      gpuOrder.push(`gpu-${systemIdx}`)
    }

    if (gpuOrder.length > 0) {
      rings.push(gpuOrder)
    }
  }

  return rings
}

// =============================================================================
// Main entry point: matchRomeModel
// =============================================================================

/**
 * Attempt to match the current topology against all known Rome models.
 *
 * Returns a RomeMatchResult with the matched model and pre-computed ring graph,
 * or null if no model matches.
 *
 * This is the equivalent of RCCL's rome_models.cc matching flow that runs
 * before the generic graph search.
 */
export function matchRomeModel(
  config: HardwareConfig,
  system: TopoSystem,
  env: EnvConfig,
  log: DecisionLog,
): RomeMatchResult | null {
  // Check if model matching is disabled
  const matchingDisable = getEnvInt(env, 'RCCL_MODEL_MATCHING_DISABLE')
  if (matchingDisable === 1) {
    log.emit(
      'romeModelMatch',
      'Rome model matching disabled (RCCL_MODEL_MATCHING_DISABLE=1)',
      'Falling through to dynamic graph search',
      'rome_models.cc:1811',
    )
    return null
  }

  const topo = extractTopology(config)

  log.emit(
    'romeModelMatch',
    `Attempting Rome model match: ${topo.nGpus} GPUs, ${topo.nCpus} CPUs, ${topo.nNics} NICs, ${topo.nLinks} links`,
    `Pattern: "${topo.pattern}", connMatrix density: ${topo.connMatrix.filter(v => v > 0).length}`,
    'rome_models.cc:2440',
    [],
    { ...topo, connMatrix: undefined },
  )

  // Try each model
  for (let mi = 0; mi < romeTopoModels.length; mi++) {
    const model = romeTopoModels[mi]

    // Quick property check
    if (model.nGpus !== topo.nGpus) continue
    if (model.nCpus !== topo.nCpus) continue
    if (model.nNics !== topo.nNics) continue
    if (model.nLinks !== topo.nLinks) continue

    // Pattern check
    if (model.pattern !== topo.pattern) continue

    log.emit(
      'romeModelMatch',
      `Trying model ${model.id} (index ${mi})`,
      `Pattern matches: "${model.pattern}", attempting GPU permutation`,
      'rome_models.cc:2450',
      [`Skip ${model.id} and try next`],
    )

    // GPU permutation matching
    const gpuPerm = Array.from({ length: topo.nGpus }, (_, i) => i)
    const gpuTime = { count: 0 }

    if (!permuteGpuIds(gpuPerm, 0, topo.nGpus - 1, model, topo, gpuTime)) {
      log.emit(
        'romeModelMatch',
        `GPU permutation failed for ${model.id} (${gpuTime.count} attempts)`,
        'Connectivity matrix does not match under any GPU permutation',
        'rome_models.cc:2399',
      )
      continue
    }

    // NIC permutation matching (if there are NICs)
    let nicPerm = Array.from({ length: topo.nNics }, (_, i) => i)
    if (topo.nNics > 0) {
      const nicTime = { count: 0 }
      if (!permuteNetIds(nicPerm, gpuPerm, 0, topo.nNics - 1, model, topo, nicTime)) {
        log.emit(
          'romeModelMatch',
          `NIC permutation failed for ${model.id} (${nicTime.count} attempts)`,
          'NIC NUMA assignments do not match under any permutation',
          'rome_models.cc:2437',
        )
        continue
      }
    } else {
      nicPerm = []
    }

    // Match found! Parse ring orderings
    log.emit(
      'romeModelMatch',
      `Model matched: ${model.id}`,
      `GPU permutation: [${gpuPerm.join(', ')}], NIC permutation: [${nicPerm.join(', ')}]`,
      'rome_models.cc:2460',
      [],
      { modelId: model.id, gpuPerm, nicPerm },
    )

    const rings = parseRingBase(model.ringBase, gpuPerm)

    log.emit(
      'romeModelMatch',
      `Parsed ${rings.length} pre-computed rings from model`,
      `Ring orderings: ${rings.map(r => r.map(id => id.replace('gpu-', '')).join('→')).join(' | ')}`,
      'rome_models.cc:2470',
      [],
      { nRings: rings.length },
    )

    // Determine bandwidth from system paths
    const gpus = system.nodesByType.get(NodeType.GPU) ?? []
    let ringBw = 0
    if (gpus.length >= 2) {
      // Use the bandwidth of the first ring's first hop
      const firstPath = system.paths.get(`${rings[0]?.[0]}->${rings[0]?.[1]}`)
      if (firstPath) {
        ringBw = firstPath.bandwidth
      }
    }
    // Fallback to system maxBw
    if (ringBw === 0) ringBw = system.maxBw

    // Build TopoGraph from matched rings
    const channels: GraphChannel[] = rings.map((ring, idx) => ({
      id: idx,
      bandwidth: ringBw,
      ringOrder: ring,
    }))

    const ringGraph: TopoGraph = {
      id: `rome-match-${model.id}`,
      pattern: GraphPattern.RING,
      nChannels: channels.length,
      channels,
      speedIntra: ringBw,
      speedInter: 0,
      typeIntra: LinkType.NVL,
      typeInter: LinkType.NET,
    }

    log.emit(
      'romeModelMatch',
      `Rome model ring graph: ${ringGraph.nChannels} channels at ${ringBw} GB/s`,
      'Using pre-computed orderings, skipping dynamic search',
      'rome_models.cc:2480',
      ['Fall through to dynamic search instead'],
      { nChannels: ringGraph.nChannels, speedIntra: ringBw },
    )

    return { model, gpuPermutation: gpuPerm, nicPermutation: nicPerm, ringGraph }
  }

  log.emit(
    'romeModelMatch',
    'No Rome model matched',
    `Tried ${romeTopoModels.length} models, none matched the topology`,
    'rome_models.cc:2490',
  )

  return null
}
