// =============================================================================
// Initialization Orchestrator — mirrors init.cc:1024-1102 from NCCL source
//
// Runs the full topology initialization pipeline:
//   1. Build topology system from hardware config
//   2. Compute paths (SPFA shortest paths)
//   3. Trim unreachable nodes
//   4. Recompute paths after trim
//   5. (RCCL mode) Attempt Rome model match before expensive search
//   6. Ring graph search
//   7. Tree graph search + construction
//   8. Setup ring connections
//   9. Setup channels (doubling tree channels, wiring prev/next and up/down)
// =============================================================================

import type { TopoSystem, TopoGraph, HardwareConfig, SUConfig } from './types'
import { GraphPattern, NodeType } from './types'
import { MAXCHANNELS } from './constants/nccl'
import { buildTopoSystem } from './topo'
import { createMultiNodeTopology } from './multi-node'
import { computeAllPaths, trimSystem } from './paths'
import { ncclTopoCompute } from './search'
import { buildTreeGraph } from './trees'
import { setupRings } from './rings'
import { setupChannels } from './connect'
import { matchRomeModel } from './rccl/rome-match'
import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'
import { gpuTypeToGcnArch } from './constants/rccl'

// =============================================================================
// Types
// =============================================================================

export interface InitResult {
  system: TopoSystem
  ringGraph: TopoGraph
  treeGraph: TopoGraph
  log: DecisionLog
  romeModelMatch?: string // Model ID if matched
}

// =============================================================================
// Helpers
// =============================================================================

function isRcclMode(config: HardwareConfig): boolean {
  return config.gpu.type in gpuTypeToGcnArch
}

// =============================================================================
// runInit — full initialization orchestrator (init.cc:1024-1102)
// =============================================================================

export function runInit(
  config: HardwareConfig,
  env: EnvConfig,
  suConfig?: SUConfig,
): InitResult {
  const log = new DecisionLog()
  const rcclMode = isRcclMode(config)

  log.emit(
    'searchInit',
    `Starting ${rcclMode ? 'RCCL' : 'NCCL'} topology initialization`,
    `Config: ${config.name}, ${config.gpu.count} GPUs (${config.gpu.type}), ` +
      `${config.cpu.count} CPUs, ${config.nic.count} NICs`,
    'init.cc:1024',
    [],
    {
      configName: config.name,
      gpuCount: config.gpu.count,
      gpuType: config.gpu.type,
      cpuCount: config.cpu.count,
      nicCount: config.nic.count,
      rcclMode,
    },
  )

  // -------------------------------------------------------------------------
  // Step 1: Build topology system (init.cc:1030)
  // For multi-node, builds replicated servers connected by network
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 1: Building topology system',
    suConfig && suConfig.serverCount > 1
      ? `Multi-node: ${suConfig.serverCount} servers, ${suConfig.railCount} rails`
      : 'Single server topology',
    'init.cc:1030',
  )

  const isMultiNode = suConfig && suConfig.serverCount > 1
  const system = isMultiNode
    ? createMultiNodeTopology(config, suConfig, env, log)
    : buildTopoSystem(config, env, log)

  // -------------------------------------------------------------------------
  // Multi-node fast path: skip expensive SPFA and search for visualization.
  // Path computation is O(n²) on GPU count; 128 servers × 16 GPUs = 2048 GPUs
  // would produce ~4M path entries. Instead, return the topology for rendering
  // and defer per-server analysis to node view.
  // -------------------------------------------------------------------------
  if (isMultiNode) {
    log.emit(
      'searchInit',
      `Multi-node fast path: skipping SPFA/search for ${suConfig.serverCount} servers`,
      'Path computation and ring/tree search are deferred to per-server node view',
      'init.ts',
      [],
      { serverCount: suConfig.serverCount, totalNodes: system.nodes.length, totalLinks: system.links.length },
    )

    // Build minimal empty graphs
    const emptyRing: TopoGraph = {
      id: 'ring-multi-deferred',
      pattern: GraphPattern.RING,
      nChannels: 0,
      channels: [],
      speedIntra: 0,
      speedInter: 0,
      typeIntra: 0 as any,
      typeInter: 0 as any,
    }
    const emptyTree: TopoGraph = {
      id: 'tree-multi-deferred',
      pattern: GraphPattern.BALANCED_TREE,
      nChannels: 0,
      channels: [],
      speedIntra: 0,
      speedInter: 0,
      typeIntra: 0 as any,
      typeInter: 0 as any,
    }

    return { system, ringGraph: emptyRing, treeGraph: emptyTree, log }
  }

  // -------------------------------------------------------------------------
  // Step 2: Compute paths — first pass (init.cc:1042)
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 2: Computing all paths (first pass)',
    'Running SPFA to find shortest paths between all GPU/NIC pairs',
    'init.cc:1042',
  )

  computeAllPaths(system, env, log)

  // -------------------------------------------------------------------------
  // Step 3: Trim system (init.cc:1048)
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 3: Trimming system',
    'Removing unreachable nodes, determining inter-node connectivity',
    'init.cc:1048',
  )

  trimSystem(system, env, log)

  // -------------------------------------------------------------------------
  // Step 4: Recompute paths after trim (init.cc:1055)
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 4: Recomputing paths after trim',
    'Paths may have changed after unreachable nodes were removed',
    'init.cc:1055',
  )

  computeAllPaths(system, env, log)

  // -------------------------------------------------------------------------
  // Determine channel bounds from env vars (init.cc:1060-1072)
  // -------------------------------------------------------------------------
  const nGpus = (system.nodesByType.get(NodeType.GPU) ?? []).length

  let minChannels = getEnvInt(env, 'NCCL_MIN_NCHANNELS')
  let maxChannels = getEnvInt(env, 'NCCL_MAX_NCHANNELS')

  if (minChannels < 0) minChannels = 1
  if (maxChannels < 0) maxChannels = MAXCHANNELS

  minChannels = Math.max(1, Math.min(minChannels, MAXCHANNELS))
  maxChannels = Math.max(minChannels, Math.min(maxChannels, MAXCHANNELS))

  log.emit(
    'searchInit',
    `Channel bounds: min=${minChannels}, max=${maxChannels}`,
    `From NCCL_MIN_NCHANNELS=${getEnvInt(env, 'NCCL_MIN_NCHANNELS')}, ` +
      `NCCL_MAX_NCHANNELS=${getEnvInt(env, 'NCCL_MAX_NCHANNELS')} (auto=-2)`,
    'init.cc:1060',
    [],
    { minChannels, maxChannels, MAXCHANNELS },
  )

  // -------------------------------------------------------------------------
  // Step 5: RCCL Rome model match (before ring search)
  // In RCCL mode, try to match against pre-computed Rome models first.
  // If a match is found, use the pre-computed ring orderings.
  // -------------------------------------------------------------------------
  let ringGraph: TopoGraph
  let romeModelMatch: string | undefined

  if (rcclMode) {
    log.emit(
      'searchInit',
      'Step 5a: Attempting RCCL Rome model match',
      'RCCL mode: checking pre-computed models before expensive search',
      'rome_models.cc:2440',
    )

    const match = matchRomeModel(config, system, env, log)

    if (match) {
      ringGraph = match.ringGraph
      romeModelMatch = match.model.id

      log.emit(
        'searchInit',
        `Rome model matched: ${match.model.id} — using pre-computed rings`,
        `${ringGraph.nChannels} channels at ${ringGraph.speedIntra} GB/s`,
        'rome_models.cc:2480',
        ['Fall through to dynamic search'],
        { modelId: match.model.id, nChannels: ringGraph.nChannels },
      )
    } else {
      log.emit(
        'searchInit',
        'No Rome model matched — falling through to dynamic ring search',
        'Will use generic NCCL-style ring search for RCCL topology',
        'rome_models.cc:2490',
      )

      ringGraph = performRingSearch(system, minChannels, maxChannels, nGpus, env, log)
    }
  } else {
    // -----------------------------------------------------------------------
    // NCCL mode: standard ring search
    // -----------------------------------------------------------------------
    ringGraph = performRingSearch(system, minChannels, maxChannels, nGpus, env, log)
  }

  // -------------------------------------------------------------------------
  // Step 6: Tree search + construction (init.cc:1084-1092)
  // -------------------------------------------------------------------------
  const treeMinChannels = 1
  const treeMaxChannels = Math.max(1, ringGraph.nChannels)

  log.emit(
    'searchInit',
    `Step 6: Tree search (minCh=${treeMinChannels}, maxCh=${treeMaxChannels})`,
    'Searching for tree topology, then building double binary tree',
    'init.cc:1084',
    [],
    { treeMinChannels, treeMaxChannels, nGpus },
  )

  const treeSearchGraph = ncclTopoCompute(
    system,
    GraphPattern.BALANCED_TREE,
    treeMinChannels,
    treeMaxChannels,
    env,
    log,
  )

  const treeGraph = buildTreeGraph(ringGraph, nGpus, log)

  treeGraph.speedIntra = treeSearchGraph.speedIntra || ringGraph.speedIntra
  treeGraph.speedInter = treeSearchGraph.speedInter || ringGraph.speedInter
  treeGraph.typeIntra = treeSearchGraph.typeIntra || ringGraph.typeIntra
  treeGraph.typeInter = treeSearchGraph.typeInter || ringGraph.typeInter

  log.emit(
    'searchInit',
    `Tree construction result: ${treeGraph.nChannels} channels, speedIntra=${treeGraph.speedIntra}`,
    `Tree built as intra-node chains for ${nGpus} GPUs`,
    'init.cc:1092',
    [],
    { nChannels: treeGraph.nChannels, speedIntra: treeGraph.speedIntra },
  )

  // -------------------------------------------------------------------------
  // Step 7: Setup rings (init.cc:1094)
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 7: Setting up ring connections',
    'Building prev/next maps from ring orderings',
    'init.cc:1094',
  )

  setupRings(ringGraph, log)

  // -------------------------------------------------------------------------
  // Step 8: Setup channels (init.cc:1096-1100)
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Step 8: Setting up channels (connect)',
    'Doubling tree channels, finalizing ring and tree connections',
    'init.cc:1096',
  )

  const connected = setupChannels(system, ringGraph, treeGraph, log)

  // -------------------------------------------------------------------------
  // Final summary
  // -------------------------------------------------------------------------
  log.emit(
    'searchInit',
    'Initialization complete',
    `Ring: ${connected.ringGraph.nChannels} channels, ` +
      `Tree: ${connected.treeGraph.nChannels} channels, ` +
      `GPUs: ${nGpus}, ` +
      (romeModelMatch ? `Rome model: ${romeModelMatch}, ` : '') +
      `Decision log entries: ${log.length}`,
    'init.cc:1102',
    [],
    {
      ringChannels: connected.ringGraph.nChannels,
      treeChannels: connected.treeGraph.nChannels,
      nGpus,
      romeModelMatch,
      logEntries: log.length,
    },
  )

  return {
    system,
    ringGraph: connected.ringGraph,
    treeGraph: connected.treeGraph,
    log,
    romeModelMatch,
  }
}

// =============================================================================
// performRingSearch — standard NCCL-style ring search
// =============================================================================

function performRingSearch(
  system: TopoSystem,
  minChannels: number,
  maxChannels: number,
  nGpus: number,
  env: EnvConfig,
  log: DecisionLog,
): TopoGraph {
  const ringMaxChannels = Math.max(1, Math.floor(maxChannels / 2))

  log.emit(
    'searchInit',
    `Step 5: Ring search (minCh=${minChannels}, maxCh=${ringMaxChannels})`,
    'Searching for Hamiltonian ring(s) through all GPUs',
    'init.cc:1074',
    [],
    { minChannels, ringMaxChannels, nGpus },
  )

  const ringGraph = ncclTopoCompute(
    system,
    GraphPattern.RING,
    minChannels,
    ringMaxChannels,
    env,
    log,
  )

  log.emit(
    'searchInit',
    `Ring search result: ${ringGraph.nChannels} channels, speedIntra=${ringGraph.speedIntra}`,
    `Ring graph ID: ${ringGraph.id}`,
    'init.cc:1082',
    [],
    {
      nChannels: ringGraph.nChannels,
      speedIntra: ringGraph.speedIntra,
      speedInter: ringGraph.speedInter,
    },
  )

  return ringGraph
}
