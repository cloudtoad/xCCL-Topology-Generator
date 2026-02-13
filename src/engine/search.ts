// =============================================================================
// Ring/Tree Graph Search — mirrors NCCL search.cc ncclTopoCompute
// =============================================================================

import {
  NodeType,
  LinkType,
  PathType,
  GraphPattern,
} from './types'

import type {
  TopoSystem,
  TopoGraph,
  GraphChannel,
  TopoNode,
  TopoPath,
} from './types'

import {
  getSpeedArrays,
  SEARCH_GLOBAL_TIMEOUT,
  SEARCH_TIMEOUT,
  SEARCH_TIMEOUT_TREE,
  SEARCH_TIMEOUT_SAMECHANNELS,
  MAXCHANNELS,
  NCCL_TOPO_PATTERN_RING,
  NCCL_TOPO_PATTERN_BALANCED_TREE,
  compareGpuScores,
  type GpuScore,
} from './constants/nccl'

import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'

// =============================================================================
// Internal types
// =============================================================================

/** Intermediate search state tracking bandwidth consumed on each link */
interface SearchState {
  /** Remaining bandwidth on each path (key = "fromId->toId") */
  remainingBw: Map<string, number>
  /** Channels found so far */
  channels: GraphChannel[]
  /** Iteration counter for timeout */
  iterations: number
  /** Global iteration counter across all speeds */
  globalIterations: number
  /** Whether the search timed out */
  timedOut: boolean
}

/** Result from a single search attempt at a given speed */
interface SearchResult {
  nChannels: number
  channels: GraphChannel[]
  speedIntra: number
  speedInter: number
  typeIntra: number // PathType numeric value
  typeInter: number // PathType numeric value
  time: number // -1 means optimal, 0 means none found
}

// =============================================================================
// Helpers
// =============================================================================

/** Get all GPU nodes from the system */
function getGpuNodes(system: TopoSystem): TopoNode[] {
  return system.nodesByType.get(NodeType.GPU) ?? []
}

/** Get the minimum compute capability across all GPUs */
function getMinComputeCap(gpus: TopoNode[]): number {
  if (gpus.length === 0) return 80 // default to Ampere
  let minCc = Infinity
  for (const gpu of gpus) {
    if (gpu.gpu && gpu.gpu.cudaCompCap < minCc) {
      minCc = gpu.gpu.cudaCompCap
    }
  }
  return minCc === Infinity ? 80 : minCc
}

/** Path key helper */
function pathKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`
}

/** Get the path between two nodes, if it exists */
function getPath(system: TopoSystem, fromId: string, toId: string): TopoPath | undefined {
  return system.paths.get(pathKey(fromId, toId))
}

/** Determine the min and max path types used within the system for intra-node paths */
function getIntraPathTypeRange(
  system: TopoSystem,
  gpus: TopoNode[],
): { minType: number; maxType: number } {
  let minType: number = PathType.DIS
  let maxType: number = PathType.LOC
  for (let i = 0; i < gpus.length; i++) {
    for (let j = i + 1; j < gpus.length; j++) {
      const p = getPath(system, gpus[i].id, gpus[j].id)
      if (p) {
        const pt = p.type as number
        if (pt < minType) minType = pt
        if (pt > maxType) maxType = pt
      }
    }
  }
  // If no paths found, default to PCI range
  if (minType === PathType.DIS) {
    minType = PathType.PIX
    maxType = PathType.PHB
  }
  return { minType, maxType }
}

/** Determine inter-node path type range (for multi-node setups) */
function getInterPathTypeRange(
  system: TopoSystem,
  gpus: TopoNode[],
): { minType: number; maxType: number } {
  const nics = system.nodesByType.get(NodeType.NIC) ?? []
  if (nics.length === 0) {
    return { minType: PathType.SYS, maxType: PathType.NET }
  }
  let minType: number = PathType.DIS
  let maxType: number = PathType.LOC
  for (const gpu of gpus) {
    for (const nic of nics) {
      const p = getPath(system, gpu.id, nic.id)
      if (p) {
        const pt = p.type as number
        if (pt < minType) minType = pt
        if (pt > maxType) maxType = pt
      }
    }
  }
  if (minType === PathType.DIS) {
    minType = PathType.NET
    maxType = PathType.NET
  }
  return { minType, maxType }
}

/** Map PathType numeric value to LinkType for reporting */
function pathTypeToLinkType(pt: number): LinkType {
  if (pt === PathType.LOC) return LinkType.LOC
  if (pt === PathType.NVL || pt === PathType.NVB) return LinkType.NVL
  if (pt === PathType.C2C) return LinkType.C2C
  if (
    pt === PathType.PIX ||
    pt === PathType.PXB ||
    pt === PathType.PXN ||
    pt === PathType.PHB ||
    pt === PathType.P2C
  ) {
    return LinkType.PCI
  }
  if (pt === PathType.SYS) return LinkType.SYS
  if (pt === PathType.NET) return LinkType.NET
  return LinkType.PCI
}

/** Score a GPU candidate for the next step in the ring search (search.cc:191-210) */
function scoreGpu(
  system: TopoSystem,
  fromGpu: TopoNode,
  candidate: TopoNode,
  firstGpu: TopoNode,
  isLast: boolean,
): GpuScore {
  const pathForward = getPath(system, fromGpu.id, candidate.id)

  const intraBw = pathForward ? pathForward.bandwidth : 0
  const intraNhops = pathForward ? pathForward.count : 999

  // For inter-node scoring, use the path to NICs if available
  let interBw = 0
  let interPciBw = 0
  let interNhops = 999

  const nics = system.nodesByType.get(NodeType.NIC) ?? []
  if (nics.length > 0) {
    for (const nic of nics) {
      const nicPath = getPath(system, candidate.id, nic.id)
      if (nicPath) {
        if (nicPath.bandwidth > interBw) {
          interBw = nicPath.bandwidth
          interNhops = nicPath.count
          interPciBw = nicPath.bandwidth
        }
      }
    }
  }

  return {
    g: candidate.index,
    startIndex: candidate.index,
    intraNhops,
    intraBw,
    interNhops,
    interPciBw,
    interBw,
  }
}

// =============================================================================
// Core ring search — recursive backtracking (search.cc:335-500)
// =============================================================================

/**
 * Attempt to build a Hamiltonian cycle through all GPUs.
 * Uses recursive backtracking with GPU scoring for candidate ordering.
 *
 * @returns ring order as array of GPU IDs, or null if no ring found
 */
function searchRingRec(
  system: TopoSystem,
  gpus: TopoNode[],
  visited: Set<string>,
  current: TopoNode,
  first: TopoNode,
  path: string[],
  requiredBw: number,
  state: SearchState,
  timeout: number,
): string[] | null {
  state.iterations++
  state.globalIterations++

  if (state.iterations > timeout || state.globalIterations > SEARCH_GLOBAL_TIMEOUT) {
    state.timedOut = true
    return null
  }

  // All GPUs visited — check ring closure
  if (path.length === gpus.length) {
    const closePath = getPath(system, current.id, first.id)
    if (!closePath) return null

    const closeKey = pathKey(current.id, first.id)
    const closeRemaining = state.remainingBw.get(closeKey) ?? closePath.bandwidth
    if (closeRemaining < requiredBw) return null

    return [...path]
  }

  // Score and sort candidates
  const isLast = path.length === gpus.length - 1
  const candidates: GpuScore[] = []

  for (const gpu of gpus) {
    if (visited.has(gpu.id)) continue

    const p = getPath(system, current.id, gpu.id)
    if (!p) continue

    // Check bandwidth availability
    const key = pathKey(current.id, gpu.id)
    const remaining = state.remainingBw.get(key) ?? p.bandwidth
    if (remaining < requiredBw) continue

    // If last GPU, also check closure path feasibility
    if (isLast) {
      const closePath = getPath(system, gpu.id, first.id)
      if (!closePath) continue
      const closeKey = pathKey(gpu.id, first.id)
      const closeRemaining = state.remainingBw.get(closeKey) ?? closePath.bandwidth
      if (closeRemaining < requiredBw) continue
    }

    candidates.push(scoreGpu(system, current, gpu, first, isLast))
  }

  // Sort by score (best first) — search.cc:191-201
  candidates.sort(compareGpuScores)

  // Try each candidate via backtracking
  for (const score of candidates) {
    const nextGpu = gpus[score.g]
    const fwdKey = pathKey(current.id, nextGpu.id)
    const fwdPath = getPath(system, current.id, nextGpu.id)!

    // Consume bandwidth
    const prevBw = state.remainingBw.get(fwdKey) ?? fwdPath.bandwidth
    state.remainingBw.set(fwdKey, prevBw - requiredBw)

    visited.add(nextGpu.id)
    path.push(nextGpu.id)

    const result = searchRingRec(
      system,
      gpus,
      visited,
      nextGpu,
      first,
      path,
      requiredBw,
      state,
      timeout,
    )

    if (result) return result

    // Backtrack
    path.pop()
    visited.delete(nextGpu.id)
    state.remainingBw.set(fwdKey, prevBw)

    if (state.timedOut) return null
  }

  return null
}

/**
 * Try to find a ring starting from a specific GPU.
 */
function searchRingFromStart(
  system: TopoSystem,
  gpus: TopoNode[],
  startGpu: TopoNode,
  requiredBw: number,
  state: SearchState,
  timeout: number,
): string[] | null {
  const visited = new Set<string>([startGpu.id])
  const path = [startGpu.id]

  return searchRingRec(system, gpus, visited, startGpu, startGpu, path, requiredBw, state, timeout)
}

// =============================================================================
// searchForChannels — search.cc:850-970
// =============================================================================

/**
 * Search for ring channels at a given speed and configuration.
 *
 * @param sameChannels If 1, all channels must use the same ring ordering.
 *   If 0, different orderings per channel are allowed.
 * @returns Number of channels found, with channels added to state.
 */
function searchForChannels(
  system: TopoSystem,
  gpus: TopoNode[],
  pattern: number,
  speed: number,
  maxChannels: number,
  _minChannels: number,
  sameChannels: number,
  _typeIntra: number,
  _typeInter: number,
  _crossNic: number,
  state: SearchState,
): number {
  if (gpus.length <= 1) {
    // Single GPU: trivial channels
    const nCh = Math.min(maxChannels, MAXCHANNELS)
    for (let c = 0; c < nCh; c++) {
      state.channels.push({
        id: c,
        bandwidth: speed,
        ringOrder: gpus.length === 1 ? [gpus[0].id] : [],
      })
    }
    return nCh
  }

  const timeout =
    sameChannels === 1
      ? SEARCH_TIMEOUT_SAMECHANNELS
      : pattern === NCCL_TOPO_PATTERN_BALANCED_TREE
        ? SEARCH_TIMEOUT_TREE
        : SEARCH_TIMEOUT

  let channelsFound = 0

  // For ring patterns, find Hamiltonian cycles
  if (pattern === NCCL_TOPO_PATTERN_RING || pattern === NCCL_TOPO_PATTERN_BALANCED_TREE) {
    let firstRing: string[] | null = null

    for (let ch = 0; ch < maxChannels && ch < MAXCHANNELS; ch++) {
      state.iterations = 0

      let ring: string[] | null = null

      if (sameChannels === 1 && firstRing) {
        // Reuse the same ring ordering, but check bandwidth
        ring = tryReusedRing(system, firstRing, speed, state)
      } else {
        // Try each GPU as starting point
        for (let startIdx = 0; startIdx < gpus.length; startIdx++) {
          ring = searchRingFromStart(
            system,
            gpus,
            gpus[startIdx],
            speed,
            state,
            timeout,
          )
          if (ring) break
          if (state.timedOut) break
        }
      }

      if (!ring) break

      if (ch === 0) firstRing = ring

      // Consume bandwidth for this ring
      consumeRingBandwidth(system, ring, speed, state)

      state.channels.push({
        id: ch,
        bandwidth: speed,
        ringOrder: [...ring],
      })
      channelsFound++

      if (state.globalIterations > SEARCH_GLOBAL_TIMEOUT) {
        state.timedOut = true
        break
      }
    }
  }

  return channelsFound
}

/**
 * Try to reuse a previous ring ordering for a new channel,
 * checking that sufficient bandwidth remains.
 */
function tryReusedRing(
  system: TopoSystem,
  ring: string[],
  speed: number,
  state: SearchState,
): string[] | null {
  // Verify all links still have enough bandwidth
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]
    const to = ring[(i + 1) % ring.length]
    const p = getPath(system, from, to)
    if (!p) return null
    const key = pathKey(from, to)
    const remaining = state.remainingBw.get(key) ?? p.bandwidth
    if (remaining < speed) return null
  }
  return [...ring]
}

/**
 * Consume bandwidth along a ring for one channel.
 */
function consumeRingBandwidth(
  system: TopoSystem,
  ring: string[],
  speed: number,
  state: SearchState,
): void {
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]
    const to = ring[(i + 1) % ring.length]
    const p = getPath(system, from, to)
    if (!p) continue
    const key = pathKey(from, to)
    const prev = state.remainingBw.get(key) ?? p.bandwidth
    state.remainingBw.set(key, prev - speed)
  }
}

/**
 * Copy entries from a Map into another Map.
 * Used instead of for-of on Map to avoid downlevelIteration requirement.
 */
function initRemainingBw(state: SearchState, paths: Map<string, TopoPath>): void {
  paths.forEach((path, key) => {
    state.remainingBw.set(key, path.bandwidth)
  })
}

// =============================================================================
// Main entry point: ncclTopoCompute — search.cc:1014-1238
// =============================================================================

/**
 * Compute optimal ring/tree topology graph.
 *
 * Mirrors NCCL's ncclTopoCompute (search.cc:1014-1238).
 * Performs a two-phase search:
 *   Phase 1: Find any valid solution, relaxing constraints as needed.
 *   Phase 2: Optimize by trying higher bandwidths.
 */
export function ncclTopoCompute(
  system: TopoSystem,
  pattern: GraphPattern,
  minChannels: number,
  maxChannels: number,
  env: EnvConfig,
  log: DecisionLog,
): TopoGraph {
  const patternNum = pattern as number
  const gpus = getGpuNodes(system)
  const nGpus = gpus.length
  const ccMin = getMinComputeCap(gpus)

  // --- Determine crossNic policy (search.cc:1040-1044) ---
  let crossNic = getEnvInt(env, 'NCCL_CROSS_NIC')
  if (crossNic === -2) crossNic = 2 // auto

  // --- Determine min/max path types (search.cc:1060-1080) ---
  const intraRange = getIntraPathTypeRange(system, gpus)
  const interRange = system.inter
    ? getInterPathTypeRange(system, gpus)
    : { minType: PathType.SYS as number, maxType: PathType.NET as number }

  const typeIntra = intraRange.minType
  const typeInter = interRange.minType
  const typeIntraMax = intraRange.maxType
  const typeInterMax = interRange.maxType

  log.emit(
    'searchInit',
    `Intra path type range: ${typeIntra}-${typeIntraMax}, Inter: ${typeInter}-${typeInterMax}`,
    `Determined from GPU-to-GPU and GPU-to-NIC paths in the topology`,
    'search.cc:1060',
    [],
    { typeIntra, typeIntraMax, typeInter, typeInterMax, ccMin, nGpus },
  )

  // --- Select speed array (search.cc:1089-1094) ---
  const speedArray = getSpeedArrays(ccMin, system.inter)

  log.emit(
    'searchInit',
    `Selected speed array for CC ${ccMin}, inter=${system.inter}: [${speedArray.slice(0, 5).join(', ')}${speedArray.length > 5 ? ', ...' : ''}]`,
    system.inter
      ? `Using inter-node speed array for CC>=${ccMin >= 100 ? 100 : ccMin >= 90 ? 90 : 'default'}`
      : `Using intra-node speed array for CC>=${ccMin >= 100 ? 100 : ccMin >= 90 ? 90 : 'default'}`,
    'search.cc:1089',
    [],
    { speedArray: [...speedArray], ccMin, isInter: system.inter },
  )

  // --- Find starting speed index (search.cc:1096-1106) ---
  // Start at the first speed that is <= maxBw and where
  // speed * nGpus <= totalBw (for rings, each link carries speed)
  let speedIndex = 0
  for (let i = 0; i < speedArray.length; i++) {
    const s = speedArray[i]
    if (s <= system.maxBw && s * nGpus <= system.totalBw) {
      speedIndex = i
      break
    }
    speedIndex = i // keep advancing if nothing fits yet
  }

  // Clamp channels
  if (maxChannels > MAXCHANNELS) maxChannels = MAXCHANNELS
  if (minChannels < 1) minChannels = 1

  log.emit(
    'searchInit',
    `Starting speed index=${speedIndex} (speed=${speedArray[speedIndex]}), channels=${minChannels}-${maxChannels}`,
    `maxBw=${system.maxBw}, totalBw=${system.totalBw}, first viable speed=${speedArray[speedIndex]}`,
    'search.cc:1096',
    [],
    { speedIndex, speed: speedArray[speedIndex], maxBw: system.maxBw, totalBw: system.totalBw },
  )

  // =========================================================================
  // Phase 1 — Find a solution (search.cc:1108-1190)
  // =========================================================================

  let bestResult: SearchResult | null = null
  let globalIterations = 0

  log.emit(
    'ringSearch',
    'Phase 1: Searching for initial solution',
    'Try speeds from high to low, relaxing constraints until a valid ring is found',
    'search.cc:1108',
  )

  // Outer loop: try decreasing speeds
  let phase1Done = false
  let si = speedIndex

  while (si < speedArray.length && !phase1Done) {
    const speed = speedArray[si]
    let sameChannels = 1 // start by requiring same ordering per channel

    // Inner relaxation loop (search.cc:1118-1180)
    let localTypeIntra = typeIntra
    let localTypeInter = typeInter
    let localCrossNic = crossNic === 2 ? 0 : crossNic
    let localPattern = patternNum

    while (!phase1Done) {
      const state: SearchState = {
        remainingBw: new Map(),
        channels: [],
        iterations: 0,
        globalIterations,
        timedOut: false,
      }

      // Initialize remaining bandwidth from system paths
      initRemainingBw(state, system.paths)

      const nChannels = searchForChannels(
        system,
        gpus,
        localPattern,
        speed,
        maxChannels,
        minChannels,
        sameChannels,
        localTypeIntra,
        localTypeInter,
        localCrossNic,
        state,
      )

      globalIterations = state.globalIterations

      if (nChannels >= minChannels) {
        // Found a valid solution
        const totalBw = speed * nChannels

        log.emit(
          'ringSearch',
          `Found ${nChannels} channels at speed=${speed} (totalBw=${totalBw})`,
          `sameChannels=${sameChannels}, typeIntra=${localTypeIntra}, typeInter=${localTypeInter}`,
          'search.cc:1130',
          [],
          { nChannels, speed, totalBw, sameChannels, localTypeIntra, localTypeInter },
        )

        bestResult = {
          nChannels,
          channels: state.channels,
          speedIntra: speed,
          speedInter: system.inter ? speed : 0,
          typeIntra: localTypeIntra,
          typeInter: localTypeInter,
          time: state.timedOut ? 0 : -1,
        }

        // Check optimality: time == -1 means the search completed without timeout
        // and totalBw >= system.totalBw means we saturate available bandwidth
        if (!state.timedOut && totalBw >= system.totalBw) {
          log.emit(
            'ringSearch',
            `Optimal solution found: ${nChannels}ch x ${speed} = ${totalBw} >= totalBw=${system.totalBw}`,
            'Search completed without timeout and saturates available bandwidth',
            'search.cc:1135',
          )
          phase1Done = true
          break
        }

        // Not optimal yet — try relaxations to find better solution
        // But if we already have enough channels, move to phase 2
        if (nChannels >= maxChannels) {
          phase1Done = true
          break
        }
      }

      // --- Relaxation cascade (search.cc:1140-1180) ---

      // (a) Try sameChannels=0 — allow different orderings per channel
      if (sameChannels === 1) {
        sameChannels = 0
        log.emit(
          'ringSearch',
          'Relaxation: sameChannels=0 (allow different orderings per channel)',
          nChannels < minChannels
            ? `Only found ${nChannels} channels, need ${minChannels}`
            : 'Trying to find more channels with different orderings',
          'search.cc:1145',
          ['Keep sameChannels=1 and try lower speed'],
        )
        continue
      }

      // (b) For Hopper+, try simpler TREE pattern if currently BALANCED_TREE
      if (
        ccMin >= 90 &&
        localPattern === NCCL_TOPO_PATTERN_BALANCED_TREE
      ) {
        localPattern = NCCL_TOPO_PATTERN_RING
        sameChannels = 1
        log.emit(
          'ringSearch',
          'Relaxation: Switch from BALANCED_TREE to RING pattern (Hopper+)',
          'Hopper and newer GPUs may find better rings with simpler pattern',
          'search.cc:1152',
          ['Keep BALANCED_TREE and try lower speed'],
        )
        continue
      }

      // (c) Increase typeIntra — allow worse intra-node path types
      if (localTypeIntra < typeIntraMax) {
        localTypeIntra++
        sameChannels = 1
        log.emit(
          'ringSearch',
          `Relaxation: Increase typeIntra to ${localTypeIntra} (max=${typeIntraMax})`,
          'Allow worse intra-node link types to find more channels',
          'search.cc:1160',
          ['Skip to lower speed instead'],
        )
        continue
      }

      // (d) Increase typeInter — allow worse inter-node path types
      if (system.inter && localTypeInter < typeInterMax) {
        localTypeInter++
        sameChannels = 1
        log.emit(
          'ringSearch',
          `Relaxation: Increase typeInter to ${localTypeInter} (max=${typeInterMax})`,
          'Allow worse inter-node link types to find more channels',
          'search.cc:1167',
          ['Skip to lower speed instead'],
        )
        continue
      }

      // (e) Try crossNic
      if (system.inter && crossNic === 2 && localCrossNic === 0) {
        localCrossNic = 1
        sameChannels = 1
        log.emit(
          'ringSearch',
          'Relaxation: Enable crossNic',
          'Allow cross-NIC paths for inter-node communication',
          'search.cc:1173',
          ['Skip to lower speed instead'],
        )
        continue
      }

      // (f) All relaxations exhausted at this speed — decrease bandwidth
      break
    }

    if (!phase1Done) {
      si++
      if (si < speedArray.length) {
        log.emit(
          'ringSearch',
          `Decreasing speed: ${speedArray[si - 1]} -> ${speedArray[si]}`,
          'All relaxations exhausted at current speed',
          'search.cc:1183',
          [],
          { prevSpeed: speedArray[si - 1], newSpeed: speedArray[si] },
        )
      }
    }
  }

  // =========================================================================
  // Phase 2 — Optimize (search.cc:1192-1230)
  // =========================================================================

  if (bestResult && bestResult.time !== -1 && si > 0) {
    log.emit(
      'ringSearch',
      'Phase 2: Optimizing — trying higher bandwidths',
      `Current solution: ${bestResult.nChannels}ch x ${bestResult.speedIntra}`,
      'search.cc:1192',
    )

    // Try increasing speed from the current solution
    for (let optSi = si - 1; optSi >= speedIndex; optSi--) {
      const optSpeed = speedArray[optSi]

      const state: SearchState = {
        remainingBw: new Map(),
        channels: [],
        iterations: 0,
        globalIterations,
        timedOut: false,
      }

      // Initialize remaining bandwidth
      initRemainingBw(state, system.paths)

      const nChannels = searchForChannels(
        system,
        gpus,
        patternNum,
        optSpeed,
        maxChannels,
        minChannels,
        0, // sameChannels=0 during optimization
        bestResult.typeIntra,
        bestResult.typeInter,
        crossNic === 2 ? 0 : crossNic,
        state,
      )

      globalIterations = state.globalIterations

      if (nChannels >= minChannels) {
        const newTotalBw = optSpeed * nChannels
        const oldTotalBw = bestResult.speedIntra * bestResult.nChannels

        if (newTotalBw > oldTotalBw) {
          log.emit(
            'ringSearch',
            `Phase 2: Improved to ${nChannels}ch x ${optSpeed} = ${newTotalBw} (was ${oldTotalBw})`,
            'Found higher bandwidth solution',
            'search.cc:1210',
            [],
            { nChannels, speed: optSpeed, newTotalBw, oldTotalBw },
          )

          bestResult = {
            nChannels,
            channels: state.channels,
            speedIntra: optSpeed,
            speedInter: system.inter ? optSpeed : 0,
            typeIntra: bestResult.typeIntra,
            typeInter: bestResult.typeInter,
            time: state.timedOut ? 0 : -1,
          }
        }
      }

      if (globalIterations > SEARCH_GLOBAL_TIMEOUT) break
    }
  }

  // =========================================================================
  // Build result TopoGraph
  // =========================================================================

  if (!bestResult || bestResult.nChannels === 0) {
    log.emit(
      'ringSearch',
      'No valid ring found — returning empty graph',
      'Search exhausted all speeds and relaxations without finding a valid ring',
      'search.cc:1235',
    )

    return buildEmptyGraph(pattern, gpus)
  }

  log.emit(
    'channelSetup',
    `Final result: ${bestResult.nChannels} channels, speed=${bestResult.speedIntra}, typeIntra=${bestResult.typeIntra}`,
    'Search complete',
    'search.cc:1238',
    [],
    {
      nChannels: bestResult.nChannels,
      speedIntra: bestResult.speedIntra,
      speedInter: bestResult.speedInter,
      typeIntra: bestResult.typeIntra,
      typeInter: bestResult.typeInter,
    },
  )

  const graph: TopoGraph = {
    id: `graph-${patternNum === NCCL_TOPO_PATTERN_RING ? 'ring' : 'tree'}-${Date.now()}`,
    pattern,
    nChannels: bestResult.nChannels,
    channels: bestResult.channels.map((ch, idx) => ({
      ...ch,
      id: idx,
    })),
    speedIntra: bestResult.speedIntra,
    speedInter: bestResult.speedInter,
    typeIntra: pathTypeToLinkType(bestResult.typeIntra),
    typeInter: pathTypeToLinkType(bestResult.typeInter),
  }

  return graph
}

// =============================================================================
// Fallback: empty graph when search fails
// =============================================================================

function buildEmptyGraph(
  pattern: GraphPattern,
  gpus: TopoNode[],
): TopoGraph {
  // Return a single channel with GPUs in index order as fallback
  const fallbackOrder = gpus.map((g) => g.id)
  const channels: GraphChannel[] =
    gpus.length > 0
      ? [
          {
            id: 0,
            bandwidth: 0,
            ringOrder: fallbackOrder,
          },
        ]
      : []

  return {
    id: `graph-empty-${Date.now()}`,
    pattern,
    nChannels: channels.length,
    channels,
    speedIntra: 0,
    speedInter: 0,
    typeIntra: LinkType.PCI,
    typeInter: LinkType.NET,
  }
}
