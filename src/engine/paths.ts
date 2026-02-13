// =============================================================================
// paths.ts — SPFA-style shortest path computation (mirrors NCCL paths.cc)
//
// Computes TopoPath between every pair of GPU and NIC nodes using a
// queue-based BFS/SPFA that tracks: path type (worst hop), bottleneck BW
// (min across hops), and hop count.
// =============================================================================

import type {
  TopoSystem,
  TopoNode,
  TopoLink,
  TopoPath,
  TopoPathHop,
} from './types'
import { NodeType, LinkType, PathType } from './types'
import { LOC_BW } from './constants/nccl'
import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvInt, getEnvValue } from './env'

// =============================================================================
// Internal helpers
// =============================================================================

/** Build a bidirectional adjacency list from system.links. */
function buildAdjacency(
  system: TopoSystem,
): Map<string, { link: TopoLink; neighbor: TopoNode }[]> {
  const adj = new Map<string, { link: TopoLink; neighbor: TopoNode }[]>()
  const nodeMap = new Map<string, TopoNode>()

  for (const node of system.nodes) {
    nodeMap.set(node.id, node)
    adj.set(node.id, [])
  }

  for (const link of system.links) {
    const fromNode = nodeMap.get(link.fromId)
    const toNode = nodeMap.get(link.toId)
    if (!fromNode || !toNode) continue

    // Forward direction
    let fromList = adj.get(link.fromId)
    if (!fromList) {
      fromList = []
      adj.set(link.fromId, fromList)
    }
    fromList.push({ link, neighbor: toNode })

    // Reverse direction (bidirectional)
    const reverseLink: TopoLink = {
      fromId: link.toId,
      toId: link.fromId,
      type: link.type,
      bandwidth: link.bandwidth,
    }
    let toList = adj.get(link.toId)
    if (!toList) {
      toList = []
      adj.set(link.toId, toList)
    }
    toList.push({ link: reverseLink, neighbor: fromNode })
  }

  return adj
}

/** Build a map from node id to TopoNode for fast lookup. */
function buildNodeMap(system: TopoSystem): Map<string, TopoNode> {
  const map = new Map<string, TopoNode>()
  for (const node of system.nodes) {
    map.set(node.id, node)
  }
  return map
}

// =============================================================================
// classifyHop — mirrors paths.cc:91-101
// =============================================================================

/**
 * Classify the path type of a single hop given the source/destination nodes,
 * the link type, the path type accumulated so far, and the hop count.
 *
 * Returns the new worst-case path type (max of pathSoFar and hop classification).
 */
function classifyHop(
  fromNode: TopoNode,
  toNode: TopoNode,
  linkType: LinkType,
  pathSoFar: PathType,
  hopCount: number,
): PathType {
  let hopType: PathType

  if (linkType === LinkType.NET) {
    // NET links within the local topology are treated as LOC (paths.cc:92)
    hopType = PathType.LOC
  } else if (fromNode.type === NodeType.PCI && toNode.type === NodeType.PCI) {
    // PCI-to-PCI traversal is a cross-switch hop (paths.cc:93)
    hopType = PathType.PXB
  } else if (
    linkType === LinkType.PCI &&
    (fromNode.type === NodeType.CPU || toNode.type === NodeType.CPU)
  ) {
    // PCI link touching a CPU means host bridge traversal (paths.cc:94)
    hopType = PathType.PHB
  } else if (
    fromNode.type === NodeType.GPU &&
    pathSoFar === PathType.NVL &&
    linkType === LinkType.NVL &&
    hopCount > 1
  ) {
    // NVLink bounce: GPU traversal with NVL path and NVL link, count > 1
    // (paths.cc:99)
    hopType = PathType.NVB
  } else {
    // Default mapping from link type to path type (paths.cc:97-101)
    switch (linkType) {
      case LinkType.LOC:
        hopType = PathType.LOC
        break
      case LinkType.NVL:
        hopType = PathType.NVL
        break
      case LinkType.PCI:
        hopType = PathType.PIX
        break
      case LinkType.C2C:
        hopType = PathType.C2C
        break
      case LinkType.SYS:
        hopType = PathType.SYS
        break
      default:
        hopType = PathType.SYS
        break
    }
  }

  // Path type is the worst (maximum) across all hops
  return Math.max(pathSoFar, hopType) as PathType
}

// =============================================================================
// SPFA shortest path from a single source node
// =============================================================================

interface SPFAEntry {
  nodeId: string
  pathType: PathType
  bandwidth: number
  hops: TopoPathHop[]
  hopCount: number
}

/**
 * Run layered BFS from a single source node, computing shortest (best) paths
 * to all reachable nodes.
 *
 * Mirrors paths.cc ncclTopoSetPaths (lines 36-113):
 *   - Layered BFS: processes all nodes at current depth before advancing
 *     (nodeList/nextNodeList alternation, paths.cc:52-110)
 *   - Domination check uses hop count + bandwidth, NOT pathType (paths.cc:73)
 *   - PathType is computed after domination (paths.cc:91-101)
 *   - Intel P2P overhead is NOT applied here — it's applied during the search
 *     phase in followPath (search.cc:79-91)
 */
function spfaFromSource(
  source: TopoNode,
  system: TopoSystem,
  adj: Map<string, { link: TopoLink; neighbor: TopoNode }[]>,
  nodeMap: Map<string, TopoNode>,
  nvbDisabled: boolean,
): Map<string, SPFAEntry> {
  const best = new Map<string, SPFAEntry>()

  // Initialize source (paths.cc:48-50)
  const sourceEntry: SPFAEntry = {
    nodeId: source.id,
    pathType: PathType.LOC,
    bandwidth: LOC_BW,
    hops: [],
    hopCount: 0,
  }
  best.set(source.id, sourceEntry)

  // Layered BFS (paths.cc:52-110): process all nodes at current depth before
  // advancing, matching NCCL's nodeList/nextNodeList alternation
  let currentLayer: string[] = [source.id]

  while (currentLayer.length > 0) {
    const nextLayerSet = new Set<string>() // dedup (paths.cc:104-106)
    const nextLayer: string[] = []

    for (const currentId of currentLayer) {
      const currentEntry = best.get(currentId)!
      const currentNode = nodeMap.get(currentId)!

      const neighbors = adj.get(currentId)
      if (!neighbors) continue

      for (const { link, neighbor } of neighbors) {
        // GPU passthrough guard (paths.cc:69-71):
        // When traversing through a GPU that is NOT the source, only allow if:
        //   - NVB is not disabled
        //   - Link is NVLink
        //   - Remote (neighbor) is GPU
        //   - Path count (hops so far) <= 1
        if (
          currentNode.type === NodeType.GPU &&
          currentNode.id !== source.id
        ) {
          if (
            nvbDisabled ||
            link.type !== LinkType.NVL ||
            neighbor.type !== NodeType.GPU ||
            currentEntry.hopCount > 1
          ) {
            continue
          }
        }

        // Bottleneck bandwidth: min across all hops (paths.cc:67)
        const newBw = Math.min(currentEntry.bandwidth, link.bandwidth)
        const newCount = currentEntry.hopCount + 1

        // Domination check (paths.cc:73):
        // Replace existing path if:
        //   (existing.bw == 0 || existing.count > current.count) && existing.bw < newBw
        // This uses hop count + bandwidth, NOT pathType.
        const existing = best.get(neighbor.id)

        let dominated = false
        if (existing) {
          const dominated_cond =
            (existing.bandwidth === 0 || existing.hopCount > currentEntry.hopCount) &&
            existing.bandwidth < newBw
          if (!dominated_cond) dominated = true
        }

        if (!dominated) {
          // Classify hop type AFTER domination check (paths.cc:91-101)
          const newPathType = classifyHop(
            currentNode,
            neighbor,
            link.type,
            currentEntry.pathType,
            newCount,
          )

          const newHop: TopoPathHop = {
            linkType: link.type,
            bandwidth: link.bandwidth,
            nodeId: neighbor.id,
          }

          const newEntry: SPFAEntry = {
            nodeId: neighbor.id,
            pathType: newPathType,
            bandwidth: newBw,
            hops: [...currentEntry.hops, newHop],
            hopCount: newCount,
          }

          best.set(neighbor.id, newEntry)

          // Add to next layer if not already there (paths.cc:104-106)
          if (!nextLayerSet.has(neighbor.id)) {
            nextLayerSet.add(neighbor.id)
            nextLayer.push(neighbor.id)
          }
        }
      }
    }

    currentLayer = nextLayer
  }

  return best
}

// =============================================================================
// PXN optimization — mirrors paths.cc:725-749
//
// After SPFA, check if GPU→NIC paths can be improved by routing through an
// NVLink-connected peer GPU that has a better direct path to the NIC.
// Path: GPU_src → NVLink → GPU_local → PCI → NIC
// =============================================================================

function applyPxnPaths(
  system: TopoSystem,
  gpuNodes: TopoNode[],
  nicNodes: TopoNode[],
  env: EnvConfig,
  log: DecisionLog,
): void {
  const pxnDisabled = getEnvInt(env, 'NCCL_PXN_DISABLE') !== 0
  if (pxnDisabled) {
    log.emit(
      'computePaths',
      'PXN optimization disabled',
      'NCCL_PXN_DISABLE is set; GPU→NVLink→GPU→PCI→NIC proxy paths are forbidden',
      'paths.cc:592',
    )
    return
  }

  if (gpuNodes.length === 0 || nicNodes.length === 0) return

  // PXN C2C threshold (paths.cc:735): when NCCL_PXN_C2C is enabled (default=1),
  // allow P2C paths for PXN proxy. Otherwise, require PXB or better.
  const pxnC2c = getEnvInt(env, 'NCCL_PXN_C2C') !== 0
  const pxnType = pxnC2c ? PathType.P2C : PathType.PXB

  let pxnCount = 0

  for (const nic of nicNodes) {
    // Find the "local GPU" for this NIC: the GPU with the best direct path
    // (lowest path type, highest BW). Mirrors ncclTopoGetLocalGpu.
    let localGpu: TopoNode | null = null
    let localType = PathType.DIS
    let localBw = 0

    for (const gpu of gpuNodes) {
      const key = `${gpu.id}->${nic.id}`
      const path = system.paths.get(key)
      if (!path) continue
      if (
        path.type < localType ||
        (path.type === localType && path.bandwidth > localBw)
      ) {
        localGpu = gpu
        localType = path.type
        localBw = path.bandwidth
      }
    }

    if (!localGpu) continue

    // For each other GPU, check if routing through localGpu is better
    for (const gpu of gpuNodes) {
      if (gpu.id === localGpu.id) continue

      const gpuToNicKey = `${gpu.id}->${nic.id}`
      const gpuToNicPath = system.paths.get(gpuToNicKey)
      if (!gpuToNicPath) continue

      // Condition 1: peer (localGpu) connected to NIC with pxnType or better (paths.cc:735-737)
      const peerToNicKey = `${localGpu.id}->${nic.id}`
      const peerToNicPath = system.paths.get(peerToNicKey)
      if (!peerToNicPath || peerToNicPath.type > pxnType) continue

      // Condition 2: peer connected to this GPU through NVLink
      const peerToGpuKey = `${localGpu.id}->${gpu.id}`
      const peerToGpuPath = system.paths.get(peerToGpuKey)
      if (!peerToGpuPath || peerToGpuPath.type > PathType.NVL) continue

      // Condition 3: same node (always true for single-server)

      // Condition 4 (paths.cc:742-743): peer has better BW to NIC or current path goes through CPU
      if (!(peerToNicPath.bandwidth > gpuToNicPath.bandwidth || gpuToNicPath.type > PathType.PXN)) {
        continue
      }

      // Apply PXN: route GPU → (NVSwitch) → localGpu → PCI → NIC
      // Use the real GPU→localGpu path hops (which include NVSwitch intermediates)
      const gpuToPeerKey = `${gpu.id}->${localGpu.id}`
      const gpuToPeerPath = system.paths.get(gpuToPeerKey)

      const nvlinkHops = gpuToPeerPath?.hops ?? [{
        linkType: LinkType.NVL,
        bandwidth: peerToGpuPath.bandwidth,
        nodeId: localGpu.id,
      }]
      const nvlinkHopCount = gpuToPeerPath?.count ?? 1

      const pxnBw = Math.min(peerToGpuPath.bandwidth, peerToNicPath.bandwidth)

      const pxnPath: TopoPath = {
        fromId: gpu.id,
        toId: nic.id,
        type: PathType.PXN,
        bandwidth: pxnBw,
        hops: [...nvlinkHops, ...peerToNicPath.hops],
        count: nvlinkHopCount + peerToNicPath.count,
      }

      system.paths.set(gpuToNicKey, pxnPath)
      pxnCount++
    }
  }

  if (pxnCount > 0) {
    log.emit(
      'computePaths',
      `PXN optimization: upgraded ${pxnCount} GPU→NIC paths`,
      'Routed through NVLink-connected peer GPUs for better NIC access',
      'paths.cc:725',
      [],
      { pxnCount },
    )
  }
}

// =============================================================================
// computeAllPaths — mirrors paths.cc ncclTopoComputePaths
// =============================================================================

/**
 * Compute shortest paths between every pair of GPU and NIC nodes in the
 * topology system. Results are stored in system.paths as a Map keyed by
 * "fromId->toId".
 *
 * Also updates system.maxBw and system.totalBw.
 */
export function computeAllPaths(
  system: TopoSystem,
  env: EnvConfig,
  log: DecisionLog,
): void {
  // Step 1: Clear existing paths
  system.paths.clear()
  system.maxBw = 0
  system.totalBw = 0

  log.emit(
    'computePaths',
    'Clear existing paths',
    'Starting fresh path computation',
    'paths.cc',
  )

  // Step 2: Build adjacency list
  const adj = buildAdjacency(system)
  const nodeMap = buildNodeMap(system)

  // Check NVB disable env var
  const nvbDisabled = getEnvInt(env, 'NCCL_NVB_DISABLE') !== 0

  if (nvbDisabled) {
    log.emit(
      'computePaths',
      'NVB routing disabled',
      'NCCL_NVB_DISABLE is set; NVLink bounce paths through intermediate GPUs are forbidden',
      'paths.cc:34',
      ['Enable NVB for potentially better GPU-GPU routing'],
    )
  }

  // Step 3: Gather source nodes (all GPUs and all NICs)
  const gpuNodes = system.nodesByType.get(NodeType.GPU) || []
  const nicNodes = system.nodesByType.get(NodeType.NIC) || []
  const sourceNodes: TopoNode[] = [...gpuNodes, ...nicNodes]

  log.emit(
    'computePaths',
    `Running SPFA from ${gpuNodes.length} GPUs and ${nicNodes.length} NICs`,
    'Compute paths from every GPU and NIC to all other GPU/NIC nodes',
    'paths.cc',
    [],
    { gpuCount: gpuNodes.length, nicCount: nicNodes.length },
  )

  // Step 4: Run SPFA from each source
  let pathCount = 0

  for (const source of sourceNodes) {
    const results = spfaFromSource(source, system, adj, nodeMap, nvbDisabled)

    // Determine which destination nodes we care about
    // For GPU sources: paths to all other GPUs and all NICs
    // For NIC sources: paths to all GPUs
    const destNodes =
      source.type === NodeType.GPU
        ? [...gpuNodes, ...nicNodes]
        : [...gpuNodes]

    for (const dest of destNodes) {
      if (dest.id === source.id) {
        // Self-path: LOC with LOC_BW (paths.cc:49)
        const selfPath: TopoPath = {
          fromId: source.id,
          toId: dest.id,
          type: PathType.LOC,
          bandwidth: LOC_BW,
          hops: [],
          count: 0,
        }
        const selfKey = `${source.id}->${dest.id}`
        system.paths.set(selfKey, selfPath)
        continue
      }

      const entry = results.get(dest.id)
      if (!entry) {
        // No path found — disconnected
        const disPath: TopoPath = {
          fromId: source.id,
          toId: dest.id,
          type: PathType.DIS,
          bandwidth: 0,
          hops: [],
          count: 0,
        }
        const disKey = `${source.id}->${dest.id}`
        system.paths.set(disKey, disPath)

        log.emit(
          'computePaths',
          `No path found: ${source.id} -> ${dest.id}`,
          'Nodes are disconnected in the topology graph',
          'paths.cc',
          [],
          { from: source.id, to: dest.id },
        )
        continue
      }

      const path: TopoPath = {
        fromId: source.id,
        toId: dest.id,
        type: entry.pathType,
        bandwidth: entry.bandwidth === Infinity ? 0 : entry.bandwidth,
        hops: entry.hops,
        count: entry.hopCount,
      }

      const key = `${source.id}->${dest.id}`
      system.paths.set(key, path)
      pathCount++

      // Update system bandwidth stats
      if (path.bandwidth > system.maxBw) {
        system.maxBw = path.bandwidth
      }
      system.totalBw += path.bandwidth
    }
  }

  log.emit(
    'computePaths',
    `Computed ${pathCount} paths`,
    `Found paths between all GPU/NIC pairs; maxBw=${system.maxBw.toFixed(1)} GB/s, totalBw=${system.totalBw.toFixed(1)} GB/s`,
    'paths.cc',
    [],
    {
      pathCount,
      maxBw: system.maxBw,
      totalBw: system.totalBw,
    },
  )

  // Step 5: Apply PXN optimization (paths.cc:725-749)
  applyPxnPaths(system, gpuNodes, nicNodes, env, log)

  // Log a summary of GPU-GPU path types
  for (const srcGpu of gpuNodes) {
    for (const dstGpu of gpuNodes) {
      if (srcGpu.id === dstGpu.id) continue
      const key = `${srcGpu.id}->${dstGpu.id}`
      const p = system.paths.get(key)
      if (p) {
        log.emit(
          'computePaths',
          `Path ${srcGpu.id} -> ${dstGpu.id}: ${PathType[p.type]} @ ${p.bandwidth.toFixed(1)} GB/s (${p.count} hops)`,
          `Best path type determined by SPFA over topology graph`,
          'paths.cc',
          [],
          {
            from: srcGpu.id,
            to: dstGpu.id,
            pathType: PathType[p.type],
            bandwidth: p.bandwidth,
            hops: p.count,
          },
        )
      }
    }
  }
}

// =============================================================================
// trimSystem — remove unreachable nodes, determine inter-node connectivity
// =============================================================================

/**
 * Trim the topology system by removing nodes that are not graph-reachable
 * from any GPU via the link graph. Uses BFS over system.links (not stored
 * paths, which only cover GPU/NIC pairs).
 *
 * Also sets system.inter based on whether all GPUs are co-located.
 */
export function trimSystem(
  system: TopoSystem,
  env: EnvConfig,
  log: DecisionLog,
): void {
  const gpuNodes = system.nodesByType.get(NodeType.GPU) || []

  if (gpuNodes.length === 0) {
    log.emit(
      'trimSystem',
      'No GPU nodes in system',
      'Nothing to trim',
      'paths.cc',
    )
    return
  }

  // BFS over the link graph starting from all GPU nodes to find all
  // graph-reachable nodes (CPU, PCI, NVS, NIC, etc.)
  const linkAdj = new Map<string, string[]>()
  for (const link of system.links) {
    let fromList = linkAdj.get(link.fromId)
    if (!fromList) { fromList = []; linkAdj.set(link.fromId, fromList) }
    fromList.push(link.toId)

    let toList = linkAdj.get(link.toId)
    if (!toList) { toList = []; linkAdj.set(link.toId, toList) }
    toList.push(link.fromId)
  }

  const reachableIds = new Set<string>()
  const queue: string[] = []

  for (const gpu of gpuNodes) {
    reachableIds.add(gpu.id)
    queue.push(gpu.id)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    const neighbors = linkAdj.get(current)
    if (!neighbors) continue
    for (const nbr of neighbors) {
      if (!reachableIds.has(nbr)) {
        reachableIds.add(nbr)
        queue.push(nbr)
      }
    }
  }

  // Remove unreachable nodes
  const removedNodes: string[] = []
  const originalNodeCount = system.nodes.length

  system.nodes = system.nodes.filter((node) => {
    if (reachableIds.has(node.id)) return true
    removedNodes.push(node.id)
    return false
  })

  // Remove links that reference removed nodes
  const removedSet = new Set(removedNodes)
  system.links = system.links.filter(
    (link) => !removedSet.has(link.fromId) && !removedSet.has(link.toId),
  )

  // Remove paths that reference removed nodes
  for (const key of Array.from(system.paths.keys())) {
    const path = system.paths.get(key)!
    if (removedSet.has(path.fromId) || removedSet.has(path.toId)) {
      system.paths.delete(key)
    }
  }

  // Rebuild nodesByType
  system.nodesByType.clear()
  for (const node of system.nodes) {
    let group = system.nodesByType.get(node.type)
    if (!group) {
      group = []
      system.nodesByType.set(node.type, group)
    }
    group.push(node)
  }

  if (removedNodes.length > 0) {
    log.emit(
      'trimSystem',
      `Removed ${removedNodes.length} unreachable nodes`,
      `Trimmed nodes with no path to any GPU (${originalNodeCount} -> ${system.nodes.length})`,
      'paths.cc',
      [],
      { removedNodes },
    )
  } else {
    log.emit(
      'trimSystem',
      'No unreachable nodes found',
      'All nodes have at least one path to a GPU',
      'paths.cc',
    )
  }

  // Determine inter-node connectivity: check if all GPU-GPU paths are local
  // If any GPU pair has a path type of NET or SYS, we have inter-node connections
  let allLocal = true
  for (const srcGpu of gpuNodes) {
    for (const dstGpu of gpuNodes) {
      if (srcGpu.id === dstGpu.id) continue
      const key = `${srcGpu.id}->${dstGpu.id}`
      const path = system.paths.get(key)
      if (!path || path.type === PathType.DIS || path.type >= PathType.NET) {
        allLocal = false
        break
      }
    }
    if (!allLocal) break
  }

  system.inter = !allLocal

  log.emit(
    'trimSystem',
    `Inter-node connectivity: ${system.inter ? 'yes' : 'no'}`,
    system.inter
      ? 'Some GPU pairs require network-level paths (multi-node setup)'
      : 'All GPUs are reachable within a single node',
    'paths.cc',
    [],
    { inter: system.inter },
  )
}
