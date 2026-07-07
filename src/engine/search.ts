// =============================================================================
// Ring/Tree Graph Search — mirrors NCCL search.cc ncclTopoCompute
// =============================================================================

import {
  NodeType,
  LinkType,
  PathType,
  GraphPattern,
  CPUArch,
  CPUVendor,
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
  intelP2POverhead,
  type GpuScore,
} from './constants/nccl'

import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'
import { RingBuildTracer } from './ring-build-trace'

// =============================================================================
// Internal types
// =============================================================================

/** Intermediate search state tracking bandwidth consumed on each link */
interface SearchState {
  /**
   * Remaining bandwidth per PHYSICAL LINK (key = "fromId>toId"). NCCL's
   * followPath (search.cc:79-91) consumes bandwidth on the links a path
   * traverses — links shared by many GPU pairs deplete for all of them.
   * (A per-pair budget would let rings oversubscribe shared switch links.)
   */
  remainingBw: Map<string, number>
  /** Path key ("a->b") → the physical link keys that path traverses. */
  pathLinks: Map<string, string[]>
  /** NET node budgets — RecNet's net->bw (search.cc:745: skip if bw < speed). */
  netBw: Map<string, number>
  /** Channels found so far */
  channels: GraphChannel[]
  /** Iteration counter for timeout */
  iterations: number
  /** Global iteration counter across all speeds */
  globalIterations: number
  /** Whether the search timed out */
  timedOut: boolean
  /** Path keys that require Intel P2P overhead during bandwidth consumption (search.cc:79-91) */
  intelOverheadPaths: Set<string>
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

/** Directed physical-link key. */
function linkKey(fromId: string, toId: string): string {
  return `${fromId}>${toId}`
}

/** Map every computed path to the physical links it traverses (via hops). */
function buildPathLinks(system: TopoSystem): Map<string, string[]> {
  const map = new Map<string, string[]>()
  system.paths.forEach((path, key) => {
    const links: string[] = []
    let prev = path.fromId
    for (const hop of path.hops) {
      links.push(linkKey(prev, hop.nodeId))
      prev = hop.nodeId
    }
    map.set(key, links)
  })
  return map
}

/** Bottleneck remaining bandwidth across a path's links (followPath check). */
function pathRemaining(state: SearchState, key: string): number {
  const links = state.pathLinks.get(key)
  if (!links || links.length === 0) return 0
  let min = Infinity
  for (const l of links) {
    const r = state.remainingBw.get(l)
    if (r !== undefined && r < min) min = r
  }
  return min === Infinity ? 0 : min
}

/** Consume (or restore, with negative cost) bandwidth on a path's links. */
function consumePathBw(state: SearchState, key: string, cost: number): void {
  const links = state.pathLinks.get(key)
  if (!links) return
  for (const l of links) {
    const r = state.remainingBw.get(l)
    if (r !== undefined) state.remainingBw.set(l, r - cost)
  }
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
  // Inter range is measured GPU→NET when NET nodes exist (the RecNet entry/
  // exit paths); fall back to GPU→NIC for NET-less systems.
  const netNodes = system.nodesByType.get(NodeType.NET) ?? []
  const nics = netNodes.length > 0 ? netNodes : (system.nodesByType.get(NodeType.NIC) ?? [])
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
  tracer?: RingBuildTracer,
  traceChannel?: number,
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
    const closeRemaining = pathRemaining(state, closeKey)
    const closeCost = effectiveCost(closeKey, requiredBw, state)
    if (closeRemaining < closeCost) return null

    return [...path]
  }

  // Score and sort candidates
  const isLast = path.length === gpus.length - 1
  const candidates: GpuScore[] = []

  for (const gpu of gpus) {
    if (visited.has(gpu.id)) continue

    const p = getPath(system, current.id, gpu.id)
    if (!p) continue

    // Check bandwidth availability (with Intel P2P overhead if applicable)
    const key = pathKey(current.id, gpu.id)
    const remaining = pathRemaining(state, key)
    const cost = effectiveCost(key, requiredBw, state)
    if (remaining < cost) continue

    // If last GPU, also check closure path feasibility
    if (isLast) {
      const closePath = getPath(system, gpu.id, first.id)
      if (!closePath) continue
      const closeKey = pathKey(gpu.id, first.id)
      const closeRemaining = pathRemaining(state, closeKey)
      const lastCloseCost = effectiveCost(closeKey, requiredBw, state)
      if (closeRemaining < lastCloseCost) continue
    }

    candidates.push(scoreGpu(system, current, gpu, first, isLast))
  }

  // Sort by score (best first) — search.cc:191-201
  candidates.sort(compareGpuScores)

  // Record the scored candidate list (the L3 tiebreaker cascade, visible).
  if (tracer && candidates.length > 0 && traceChannel !== undefined) {
    tracer.pushDetail({
      kind: 'consider',
      channel: traceChannel,
      from: current.id,
      candidates: candidates.slice(0, 4).map((s, rank) => ({
        id: gpus[s.g].id,
        intraBw: s.intraBw,
        intraNhops: s.intraNhops,
        rank,
      })),
      chosen: gpus[candidates[0].g].id,
    })
  }

  // Try each candidate via backtracking
  for (const score of candidates) {
    const nextGpu = gpus[score.g]
    const fwdKey = pathKey(current.id, nextGpu.id)

    // Consume bandwidth on the path's LINKS (followPath, search.cc:79-91)
    const prevBw = pathRemaining(state, fwdKey)
    const fwdCost = effectiveCost(fwdKey, requiredBw, state)
    consumePathBw(state, fwdKey, fwdCost)

    if (tracer && traceChannel !== undefined) {
      tracer.pushDetail({
        kind: 'hop',
        channel: traceChannel,
        from: current.id,
        to: nextGpu.id,
        before: prevBw,
        after: prevBw - fwdCost,
      })
    }

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
      tracer,
      traceChannel,
    )

    if (result) return result

    // Backtrack — restore the links
    path.pop()
    visited.delete(nextGpu.id)
    consumePathBw(state, fwdKey, -fwdCost)

    if (tracer && traceChannel !== undefined) {
      tracer.pushDetail({
        kind: 'backtrack',
        channel: traceChannel,
        at: nextGpu.id,
        backTo: current.id,
      })
    }

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
  tracer?: RingBuildTracer,
  traceChannel?: number,
): string[] | null {
  const visited = new Set<string>([startGpu.id])
  const path = [startGpu.id]

  return searchRingRec(
    system, gpus, visited, startGpu, startGpu, path, requiredBw, state, timeout, tracer, traceChannel,
  )
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
  tracer?: RingBuildTracer,
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
      let reused = false

      if (sameChannels === 1 && firstRing) {
        // Reuse the same ring ordering, but check bandwidth
        ring = tryReusedRing(system, firstRing, speed, state)
        reused = ring !== null
      } else {
        // Try each GPU as starting point
        for (let startIdx = 0; startIdx < gpus.length; startIdx++) {
          if (tracer) {
            tracer.push({
              kind: 'channel-start',
              channel: ch,
              startGpu: gpus[startIdx].id,
              speed,
              reused: false,
            })
          }
          ring = searchRingFromStart(
            system,
            gpus,
            gpus[startIdx],
            speed,
            state,
            timeout,
            tracer,
            ch,
          )
          if (ring) break
          if (state.timedOut) break
        }
      }

      if (!ring) break

      if (ch === 0) firstRing = ring

      // Consume bandwidth for this ring.
      //
      // The recursive search already consumed the N-1 descent edges as it
      // built the path (mirroring NCCL's followPath, which consumes during
      // the search and keeps the consumption on success) — so a fresh search
      // only needs the CLOSURE edge charged here. A reused ring skipped the
      // recursion entirely and pays for all N edges.
      if (reused) {
        if (tracer) {
          tracer.push({ kind: 'channel-start', channel: ch, startGpu: ring[0], speed, reused: true })
        }
        consumeRingBandwidth(system, ring, speed, state, tracer, ch)
      } else {
        const closeFrom = ring[ring.length - 1]
        const closeTo = ring[0]
        const closeKey = pathKey(closeFrom, closeTo)
        consumePathBw(state, closeKey, effectiveCost(closeKey, speed, state))
        if (tracer) {
          tracer.push({ kind: 'close', channel: ch, from: closeFrom, to: closeTo })
        }
      }

      if (tracer) {
        tracer.push({ kind: 'channel-done', channel: ch, order: [...ring] })
      }

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
  // Verify all links still have enough bandwidth (with Intel P2P overhead)
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]
    const to = ring[(i + 1) % ring.length]
    const p = getPath(system, from, to)
    if (!p) return null
    const key = pathKey(from, to)
    const remaining = pathRemaining(state, key)
    const cost = effectiveCost(key, speed, state)
    if (remaining < cost) return null
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
  tracer?: RingBuildTracer,
  traceChannel?: number,
): void {
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]
    const to = ring[(i + 1) % ring.length]
    const p = getPath(system, from, to)
    if (!p) continue
    const key = pathKey(from, to)
    const prev = pathRemaining(state, key)
    const cost = effectiveCost(key, speed, state)
    consumePathBw(state, key, cost)
    if (tracer && traceChannel !== undefined) {
      if (i < ring.length - 1) {
        tracer.pushDetail({ kind: 'hop', channel: traceChannel, from, to, before: prev, after: prev - cost })
      } else {
        tracer.push({ kind: 'close', channel: traceChannel, from, to })
      }
    }
  }
}

/**
 * Copy entries from a Map into another Map.
 * Used instead of for-of on Map to avoid downlevelIteration requirement.
 */
function initRemainingBw(state: SearchState, system: TopoSystem): void {
  for (const link of system.links) {
    state.remainingBw.set(linkKey(link.fromId, link.toId), link.bandwidth)
  }
  state.pathLinks = buildPathLinks(system)
  for (const net of system.nodesByType.get(NodeType.NET) ?? []) {
    state.netBw.set(net.id, net.net?.speed ?? 0)
  }
}

/**
 * Build a set of path keys that require Intel P2P overhead during bandwidth
 * consumption. Mirrors NCCL's followPath (search.cc:79-91) which applies
 * INTEL_P2P_OVERHEAD to PCI links when the path type is PHB, the start node
 * is a GPU, and the path goes through an Intel x86 CPU.
 */
function buildIntelOverheadPaths(system: TopoSystem): Set<string> {
  const overheadPaths = new Set<string>()
  const nodeMap = new Map<string, TopoNode>()
  for (const node of system.nodes) nodeMap.set(node.id, node)

  system.paths.forEach((path, key) => {
    if (path.type < PathType.PHB) return

    const fromNode = nodeMap.get(path.fromId)
    if (!fromNode || fromNode.type !== NodeType.GPU) return

    for (const hop of path.hops) {
      const node = nodeMap.get(hop.nodeId)
      if (
        node && node.type === NodeType.CPU &&
        node.cpu?.arch === CPUArch.X86 &&
        node.cpu?.vendor === CPUVendor.INTEL
      ) {
        overheadPaths.add(key)
        break
      }
    }
  })

  return overheadPaths
}

/**
 * Get the effective bandwidth cost for consuming a channel on a path.
 * For Intel PHB paths from GPUs, the cost is bw*6/5 (search.cc:88).
 */
function effectiveCost(key: string, speed: number, state: SearchState): number {
  return state.intelOverheadPaths.has(key) ? intelP2POverhead(speed) : speed
}

// =============================================================================
// Inter-node ring search — the RecNet pattern (search.cc:726-812)
//
// "Ring: NET n -> GPU a -> GPU b -> .. -> GPU x -> NET n (or m if crossNic)"
// (search.cc:816-830). Per channel: NICs are tried in rotation starting at
// (channel + i) % netCount, skipping NETs whose budget is below the channel
// speed (net->bw check, :745) — bandwidth conservation forces channels to
// spread across the rails. Under sameChannels=1 the previous channel's GPU
// order is REPLAYED through the rotated NIC (:776-780) — which only works if
// that NIC can reach the same entry GPU within typeInter. Otherwise the
// relaxation cascade decides what gives (sameChannels before typeInter —
// NCCL reorders rings before degrading NIC locality).
// =============================================================================

/** Is the stored path's type within the allowed maximum? */
function pathTypeOk(system: TopoSystem, key: string, maxType: number): boolean {
  const p = system.paths.get(key)
  return !!p && p.type !== PathType.DIS && (p.type as number) <= maxType
}

interface InterRingResult {
  order: string[]
  netIn: string
  netOut: string
}

/** Recursive Hamiltonian PATH search with a typed exit back to a NET. */
function searchPathRecInter(
  system: TopoSystem,
  gpus: TopoNode[],
  nets: TopoNode[],
  visited: Set<string>,
  current: TopoNode,
  path: string[],
  speed: number,
  state: SearchState,
  timeout: number,
  typeIntra: number,
  typeInter: number,
  entryNetId: string,
  crossNic: number,
  tracer?: RingBuildTracer,
  traceChannel?: number,
): InterRingResult | null {
  state.iterations++
  state.globalIterations++
  if (state.iterations > timeout || state.globalIterations > SEARCH_GLOBAL_TIMEOUT) {
    state.timedOut = true
    return null
  }

  // All GPUs placed — find a feasible exit NET from the LAST GPU.
  if (path.length === gpus.length) {
    // crossNic=0: must exit via the entry NET. Otherwise any NET with budget.
    const exitCandidates = crossNic > 0 ? nets : nets.filter((n) => n.id === entryNetId)
    for (const net of exitCandidates) {
      const exitKey = pathKey(current.id, net.id)
      if (!pathTypeOk(system, exitKey, typeInter)) continue
      if (pathRemaining(state, exitKey) < effectiveCost(exitKey, speed, state)) continue
      return { order: [...path], netIn: entryNetId, netOut: net.id }
    }
    return null
  }

  // Candidates: unvisited GPUs, intra path within typeIntra with bandwidth.
  const candidates: GpuScore[] = []
  for (const gpu of gpus) {
    if (visited.has(gpu.id)) continue
    const key = pathKey(current.id, gpu.id)
    if (!pathTypeOk(system, key, typeIntra)) continue
    if (pathRemaining(state, key) < effectiveCost(key, speed, state)) continue

    // Score with inter fields relative to the ENTRY net (getNetPaths
    // semantics, search.cc:246-252): netPaths = NET node's paths to GPUs.
    const p = system.paths.get(key)
    const netPath = system.paths.get(pathKey(entryNetId, gpu.id))
    candidates.push({
      g: gpu.index,
      startIndex: gpu.index,
      intraNhops: p?.count ?? 999,
      intraBw: p?.bandwidth ?? 0,
      interNhops: netPath?.count ?? 999,
      interPciBw: netPath?.bandwidth ?? 0,
      interBw: netPath?.bandwidth ?? 0,
    })
  }
  candidates.sort(compareGpuScores)
  // Mid-ring, prefer GPUs FAR from the net — save the near ones for the exit
  // (ncclTopoSearchNextGpuSort's sortNet=-1 reversal, search.cc:283-289).
  const lastStep = path.length === gpus.length - 1
  if (!lastStep) candidates.reverse()

  if (tracer && candidates.length > 0 && traceChannel !== undefined) {
    tracer.pushDetail({
      kind: 'consider',
      channel: traceChannel,
      from: current.id,
      candidates: candidates.slice(0, 4).map((c, rank) => ({
        id: gpus.find((g) => g.index === c.g)!.id,
        intraBw: c.intraBw,
        intraNhops: c.intraNhops,
        rank,
      })),
      chosen: gpus.find((g) => g.index === candidates[0].g)!.id,
    })
  }

  for (const score of candidates) {
    const nextGpu = gpus.find((g) => g.index === score.g)!
    const fwdKey = pathKey(current.id, nextGpu.id)
    const before = pathRemaining(state, fwdKey)
    const cost = effectiveCost(fwdKey, speed, state)
    consumePathBw(state, fwdKey, cost)
    if (tracer && traceChannel !== undefined) {
      tracer.pushDetail({ kind: 'hop', channel: traceChannel, from: current.id, to: nextGpu.id, before, after: before - cost })
    }
    visited.add(nextGpu.id)
    path.push(nextGpu.id)

    const result = searchPathRecInter(
      system, gpus, nets, visited, nextGpu, path, speed, state, timeout,
      typeIntra, typeInter, entryNetId, crossNic, tracer, traceChannel,
    )
    if (result) return result

    path.pop()
    visited.delete(nextGpu.id)
    consumePathBw(state, fwdKey, -cost)
    if (tracer && traceChannel !== undefined) {
      tracer.pushDetail({ kind: 'backtrack', channel: traceChannel, at: nextGpu.id, backTo: current.id })
    }
    if (state.timedOut) return null
  }
  return null
}

/** Feasibility-check + return a replay of the previous channel through `net`. */
function tryReplayInter(
  system: TopoSystem,
  prev: InterRingResult,
  net: TopoNode,
  speed: number,
  state: SearchState,
  typeIntra: number,
  typeInter: number,
): InterRingResult | null {
  const entryKey = pathKey(net.id, prev.order[0])
  if (!pathTypeOk(system, entryKey, typeInter)) return null
  if (pathRemaining(state, entryKey) < effectiveCost(entryKey, speed, state)) return null
  for (let i = 0; i < prev.order.length - 1; i++) {
    const key = pathKey(prev.order[i], prev.order[i + 1])
    if (!pathTypeOk(system, key, typeIntra)) return null
    if (pathRemaining(state, key) < effectiveCost(key, speed, state)) return null
  }
  const exitKey = pathKey(prev.order[prev.order.length - 1], net.id)
  if (!pathTypeOk(system, exitKey, typeInter)) return null
  if (pathRemaining(state, exitKey) < effectiveCost(exitKey, speed, state)) return null
  return { order: [...prev.order], netIn: net.id, netOut: net.id }
}

/** Consume the bandwidth of a completed inter channel (entry, hops, exit, NET). */
function consumeInterChannel(
  system: TopoSystem,
  r: InterRingResult,
  speed: number,
  state: SearchState,
  tracer?: RingBuildTracer,
  traceChannel?: number,
  hopsAlreadyConsumed = false,
): void {
  state.netBw.set(r.netIn, (state.netBw.get(r.netIn) ?? 0) - speed)
  consumePathBw(state, pathKey(r.netIn, r.order[0]), effectiveCost(pathKey(r.netIn, r.order[0]), speed, state))
  if (!hopsAlreadyConsumed) {
    for (let i = 0; i < r.order.length - 1; i++) {
      const key = pathKey(r.order[i], r.order[i + 1])
      const before = pathRemaining(state, key)
      const cost = effectiveCost(key, speed, state)
      consumePathBw(state, key, cost)
      if (tracer && traceChannel !== undefined) {
        tracer.pushDetail({ kind: 'hop', channel: traceChannel, from: r.order[i], to: r.order[i + 1], before, after: before - cost })
      }
    }
  }
  const exitKey = pathKey(r.order[r.order.length - 1], r.netOut)
  consumePathBw(state, exitKey, effectiveCost(exitKey, speed, state))
  if (tracer && traceChannel !== undefined) {
    tracer.push({ kind: 'close', channel: traceChannel, from: r.order[r.order.length - 1], to: r.netOut })
  }
}

/**
 * Inter-node ring channels: NET entry → all GPUs → NET exit, per RecNet.
 */
function searchForChannelsInter(
  system: TopoSystem,
  gpus: TopoNode[],
  speed: number,
  maxChannels: number,
  sameChannels: number,
  typeIntra: number,
  typeInter: number,
  crossNic: number,
  state: SearchState,
  tracer?: RingBuildTracer,
): number {
  const nets = system.nodesByType.get(NodeType.NET) ?? []
  if (nets.length === 0 || gpus.length === 0) return 0
  const timeout = sameChannels === 1 ? SEARCH_TIMEOUT_SAMECHANNELS : SEARCH_TIMEOUT

  let found = 0
  let prev: InterRingResult | null = null

  for (let ch = 0; ch < maxChannels && ch < MAXCHANNELS; ch++) {
    state.iterations = 0
    let result: InterRingResult | null = null

    // NIC rotation with budget check (search.cc:735,745).
    for (let i = 0; i < nets.length && !result; i++) {
      const net = nets[(ch + i) % nets.length]
      if ((state.netBw.get(net.id) ?? 0) < speed) continue

      if (sameChannels === 1 && prev) {
        // Replay the previous channel's order through this NIC (:776-780).
        result = tryReplayInter(system, prev, net, speed, state, typeIntra, typeInter)
        if (result) {
          tracer?.push({ kind: 'channel-start', channel: ch, startGpu: result.order[0], speed, reused: true, net: net.id })
          consumeInterChannel(system, result, speed, state, tracer, ch)
        }
        continue
      }

      // Fresh search: try the NET's most local GPUs as entry, best type first
      // (:791-803), honoring typeInter on the entry path.
      const entries = [...gpus]
        .map((g) => ({ g, p: system.paths.get(pathKey(net.id, g.id)) }))
        .filter((e) => e.p && (e.p.type as number) <= typeInter && e.p.type !== PathType.DIS)
        .sort((a, b) => (a.p!.type as number) - (b.p!.type as number) || b.p!.bandwidth - a.p!.bandwidth || a.g.index - b.g.index)

      for (const entry of entries) {
        const entryKey = pathKey(net.id, entry.g.id)
        if (pathRemaining(state, entryKey) < effectiveCost(entryKey, speed, state)) continue
        tracer?.push({ kind: 'channel-start', channel: ch, startGpu: entry.g.id, speed, reused: false, net: net.id })
        const visited = new Set<string>([entry.g.id])
        result = searchPathRecInter(
          system, gpus, nets, visited, entry.g, [entry.g.id], speed, state, timeout,
          typeIntra, typeInter, net.id, crossNic, tracer, ch,
        )
        if (result) {
          consumeInterChannel(system, result, speed, state, tracer, ch, true)
          break
        }
        if (state.timedOut) break
      }
      if (state.timedOut) break
    }

    if (!result) break
    if (ch === 0 || !prev) prev = result

    tracer?.push({ kind: 'channel-done', channel: ch, order: [...result.order], netIn: result.netIn, netOut: result.netOut })
    state.channels.push({
      id: ch,
      bandwidth: speed,
      ringOrder: [...result.order],
      netIn: result.netIn,
      netOut: result.netOut,
    })
    found++
    if (state.globalIterations > SEARCH_GLOBAL_TIMEOUT) {
      state.timedOut = true
      break
    }
  }
  return found
}

// =============================================================================
// ncclTopoSearchInit — search.cc:14-53
//
// Sets system.maxBw / system.totalBw with NCCL's exact semantics:
//   maxBw   = max over GPUs of the best PATH bw to another GPU (intra)
//             or to a NET node (inter) — the per-channel ceiling.
//   totalBw = max over GPUs of that single GPU's aggregate link bandwidth,
//             max(pciBw, Σ nvlinkBw) — the per-GPU injection ceiling.
//
// Real-world anchors: 4× MI300X prints "=== System : maxBw 48.0 totalBw
// 144.0 ===" (3 xGMI × 48 — ROCm/rccl#1210); DGX H100 totalBw = 18 × 20.6
// = 370.8. NOT the sum of every link in the system — totalBw drives the
// starting speed index and the optimality short-circuit
// (nChannels·bw ≥ totalBw), so inflating it prevents the search from ever
// declaring an optimal solution.
// =============================================================================

export function ncclTopoSearchInit(system: TopoSystem): void {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []

  // Single GPU, single node: loopback only (search.cc:43-46).
  if (!system.inter && gpus.length === 1) {
    system.maxBw = 5000.0 // LOC_BW
    system.totalBw = 5000.0
    return
  }

  const nets = system.nodesByType.get(NodeType.NET) ?? []
  let maxBw = 0
  let totalBw = 0

  for (const gpu of gpus) {
    // maxBw: best path to a peer GPU (intra) or to a NET/NIC (inter).
    const targets = system.inter ? nets : gpus
    for (const t of targets) {
      if (t.id === gpu.id) continue
      const p = system.paths.get(`${gpu.id}->${t.id}`)
      if (p && p.count > 0 && p.bandwidth > maxBw) maxBw = p.bandwidth
    }

    // totalBw: this GPU's own links — max(pciBw, Σ nvlinkBw) (search.cc:30-38).
    let nvlinkSum = 0
    let pciBw = 0
    for (const link of system.links) {
      if (link.fromId !== gpu.id) continue
      if (link.type === LinkType.NVL) nvlinkSum += link.bandwidth
      if (link.type === LinkType.PCI) pciBw = link.bandwidth
    }
    totalBw = Math.max(totalBw, Math.max(pciBw, nvlinkSum))
  }

  system.maxBw = maxBw
  system.totalBw = totalBw
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
  tracer?: RingBuildTracer,
): TopoGraph {
  const patternNum = pattern as number
  const gpus = getGpuNodes(system)
  const nGpus = gpus.length
  const ccMin = getMinComputeCap(gpus)

  // Set maxBw/totalBw with NCCL semantics (pipeline step 5, init.cc:1149).
  ncclTopoSearchInit(system)

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

  // --- Determine CPU arch/vendor for AMD sameChannels exception (search.cc:1131-1132) ---
  const cpuNodes = system.nodesByType.get(NodeType.CPU) ?? []
  const cpuArch = cpuNodes.length > 0 && cpuNodes[0].cpu ? cpuNodes[0].cpu.arch : CPUArch.X86
  const cpuVendor = cpuNodes.length > 0 && cpuNodes[0].cpu ? cpuNodes[0].cpu.vendor : CPUVendor.INTEL

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

  // --- Find starting speed index (search.cc:1096-1101) ---
  // Tree patterns adjust totalBw upward: totalBw *= ngpus/(ngpus-1) (search.cc:1100)
  // because trees have N-1 edges vs rings' N edges.
  let totalBw = system.totalBw
  if (nGpus > 1 && patternNum !== NCCL_TOPO_PATTERN_RING) {
    totalBw *= nGpus / (nGpus - 1)
  }
  // Advance speed index while speed exceeds maxBw or speed*minChannels exceeds totalBw (search.cc:1101)
  let speedIndex = 0
  while (
    speedIndex < speedArray.length - 1 &&
    (speedArray[speedIndex] > system.maxBw || speedArray[speedIndex] * minChannels > totalBw)
  ) {
    speedIndex++
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
  // Pre-compute Intel P2P overhead paths (search.cc:79-91)
  // =========================================================================

  const intelOverheadPaths = buildIntelOverheadPaths(system)

  // =========================================================================
  // Phase 1 — Find a solution (search.cc:1108-1190)
  // =========================================================================

  let bestResult: SearchResult | null = null
  let globalIterations = 0

  // Build-trace bookkeeping: the parameters of the ACCEPTED solution (for the
  // deterministic replay) and whether DupChannels doubled it afterwards.
  let acceptedParams: { speed: number; sameChannels: number; pattern: number } | null = null
  let dupInfo: { fromChannels: number; toChannels: number; bwBefore: number; bwAfter: number } | null = null

  tracer?.push({
    kind: 'phase',
    label: 'Phase 1 — find a solution',
    detail: 'Try speeds high→low, relaxing one constraint at a time until rings exist',
    sourceRef: 'search.cc:1197-1246',
  })
  tracer?.push({ kind: 'speed', speed: speedArray[speedIndex], detail: 'starting speed from the table' })

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
        pathLinks: new Map(),
        netBw: new Map(),
        channels: [],
        iterations: 0,
        globalIterations,
        timedOut: false,
        intelOverheadPaths,
      }

      // Initialize remaining bandwidth from system paths
      initRemainingBw(state, system)

      const nChannels =
        system.inter && localPattern === NCCL_TOPO_PATTERN_RING
          ? searchForChannelsInter(
              system, gpus, speed, maxChannels, sameChannels,
              localTypeIntra, localTypeInter, localCrossNic, state,
            )
          : searchForChannels(
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

        // Keep-if-better (ncclTopoCompareGraphs, search.cc:445-461): a candidate
        // replaces the incumbent only when nChannels × bwIntra improves. Without
        // this, descending the speed array clobbers good solutions with worse.
        const incumbentBw = bestResult ? bestResult.speedIntra * bestResult.nChannels : 0
        if (totalBw > incumbentBw) {
          bestResult = {
            nChannels,
            channels: state.channels,
            speedIntra: speed,
            speedInter: system.inter ? speed : 0,
            typeIntra: localTypeIntra,
            typeInter: localTypeInter,
            time: state.timedOut ? 0 : -1,
          }
          acceptedParams = { speed, sameChannels, pattern: localPattern }
          dupInfo = null
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
      // AMD exception (search.cc:1131-1132): block sameChannels=0 when
      // AMD x86 CPU with SYS-level intra paths (dual-socket AMD)
      if (sameChannels === 1 &&
          !(cpuArch === CPUArch.X86 && cpuVendor === CPUVendor.AMD && localTypeIntra === PathType.SYS)) {
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
        tracer?.push({ kind: 'relax', action: 'sameChannels 1 → 0', reason: 'allow different orderings per channel', sourceRef: 'search.cc:1206' })
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
        tracer?.push({ kind: 'relax', action: 'BALANCED_TREE → RING', reason: 'simpler pattern for Hopper+', sourceRef: 'search.cc:1217' })
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
        tracer?.push({ kind: 'relax', action: `typeIntra → ${localTypeIntra}`, reason: 'accept worse intra-node link types', sourceRef: 'search.cc:1224' })
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
        tracer?.push({ kind: 'relax', action: `typeInter → ${localTypeInter}`, reason: 'accept worse inter-node link types', sourceRef: 'search.cc:1231' })
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
        tracer?.push({ kind: 'relax', action: 'crossNic → enabled', reason: 'allow cross-NIC inter-node paths', sourceRef: 'search.cc:1239' })
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
        tracer?.push({ kind: 'speed', speed: speedArray[si], detail: 'all relaxations exhausted — drop to the next table speed' })
      }
    }
  }

  // =========================================================================
  // DupChannels — double channels when bandwidth allows (search.cc:961-974)
  // =========================================================================

  if (bestResult && bestResult.nChannels > 0) {
    const bwIntra = bestResult.speedIntra
    // Skip NVLS pattern (not implemented, but guard for future)
    // Skip if bwIntra < 25.0
    if (bwIntra >= 25.0) {
      // Skip if ccMin > 80 && bwIntra < 50 && nChannels > 4 (search.cc:965)
      const skipDup = ccMin > 80 && bwIntra < 50.0 && bestResult.nChannels > 4
      if (!skipDup) {
        const dupChannels = Math.min(bestResult.nChannels * 2, maxChannels)
        if (dupChannels > bestResult.nChannels) {
          // Duplicate channels: copy ring orderings, halve bandwidth (search.cc:967-972)
          const origChannels = bestResult.channels
          const newChannels: GraphChannel[] = [...origChannels]
          for (let c = origChannels.length; c < dupChannels; c++) {
            const srcCh = origChannels[c - origChannels.length]
            newChannels.push({
              id: c,
              bandwidth: srcCh.bandwidth,
              ringOrder: [...srcCh.ringOrder],
            })
          }

          // DIVUP(dupChannels, origNChannels) — ceiling division for BW scaling (search.cc:970)
          const divup = Math.ceil(dupChannels / bestResult.nChannels)
          const newBwIntra = bwIntra / divup
          const newBwInter = bestResult.speedInter / divup

          log.emit(
            'ringSearch',
            `DupChannels: ${bestResult.nChannels} -> ${dupChannels} channels, bw ${bwIntra} -> ${newBwIntra}`,
            `Channel duplication for high-bandwidth topology (bwIntra=${bwIntra} >= 25.0)`,
            'search.cc:961',
            [],
            { origChannels: bestResult.nChannels, dupChannels, origBw: bwIntra, newBw: newBwIntra },
          )

          dupInfo = {
            fromChannels: bestResult.nChannels,
            toChannels: dupChannels,
            bwBefore: bwIntra,
            bwAfter: newBwIntra,
          }

          bestResult = {
            ...bestResult,
            nChannels: dupChannels,
            channels: newChannels,
            speedIntra: newBwIntra,
            speedInter: newBwInter,
          }
        }
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
        pathLinks: new Map(),
        netBw: new Map(),
        channels: [],
        iterations: 0,
        globalIterations,
        timedOut: false,
        intelOverheadPaths,
      }

      // Initialize remaining bandwidth
      initRemainingBw(state, system)

      const nChannels: number =
        system.inter && patternNum === NCCL_TOPO_PATTERN_RING
          ? searchForChannelsInter(
              system, gpus, optSpeed, maxChannels, 0,
              bestResult.typeIntra, bestResult.typeInter, crossNic === 2 ? 0 : crossNic, state,
            )
          : searchForChannels(
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
          acceptedParams = { speed: optSpeed, sameChannels: 0, pattern: patternNum }
          dupInfo = null
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

  // ---------------------------------------------------------------------------
  // Build trace: deterministic replay of the ACCEPTED search. Same inputs +
  // same ordering rules ⇒ the identical rings, now narrated hop by hop.
  // ---------------------------------------------------------------------------
  if (tracer && acceptedParams) {
    tracer.push({
      kind: 'phase',
      label: 'Construction replay',
      detail:
        `Replaying the accepted search: speed=${acceptedParams.speed}, ` +
        `sameChannels=${acceptedParams.sameChannels}`,
      sourceRef: 'search.cc:850-970',
    })
    const replayState: SearchState = {
      remainingBw: new Map(),
      pathLinks: new Map(),
      netBw: new Map(),
      channels: [],
      iterations: 0,
      globalIterations: 0,
      timedOut: false,
      intelOverheadPaths,
    }
    initRemainingBw(replayState, system)
    if (system.inter && acceptedParams.pattern === NCCL_TOPO_PATTERN_RING) {
      searchForChannelsInter(
        system, gpus, acceptedParams.speed, maxChannels, acceptedParams.sameChannels,
        bestResult.typeIntra, bestResult.typeInter, crossNic === 2 ? 0 : crossNic,
        replayState, tracer,
      )
    } else {
      searchForChannels(
        system,
        gpus,
        acceptedParams.pattern,
        acceptedParams.speed,
        maxChannels,
        minChannels,
        acceptedParams.sameChannels,
        bestResult.typeIntra,
        bestResult.typeInter,
        crossNic === 2 ? 0 : crossNic,
        replayState,
        tracer,
      )
    }
    if (dupInfo) {
      tracer.push({ kind: 'dup', ...dupInfo, sourceRef: 'search.cc:961-974' })
    }
    tracer.push({ kind: 'done', nChannels: bestResult.nChannels, speed: bestResult.speedIntra })
  }

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
