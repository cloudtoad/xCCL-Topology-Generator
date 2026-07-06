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
import { MAXCHANNELS, nvlsRuntimeChannels } from './constants/nccl'
import { buildTopoSystem } from './topo'
import { createMultiNodeTopology } from './multi-node'
import { computeAllPaths, trimSystem } from './paths'
import { ncclTopoCompute } from './search'
import { buildTreeGraph } from './trees'
import { setupRings } from './rings'
import { setupChannels } from './connect'
import { nvlsSupport, computeNvlsGraph } from './nvls'
import { selectAlgorithm } from './tuning'
import type { TuningResult } from './tuning'
import { formatTopoGraph } from './log-replay'
import { buildClusterChannels, intraOrdersFromRingGraph } from './cluster'
import type { ClusterTopology } from './cluster'
import { buildQPs } from './qp'
import type { QPPlan } from './qp'
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
  nvlsGraph: TopoGraph | null // NVLS multicast graph (null when unsupported)
  nvlsSupported: boolean
  nvlsReason: string          // why NVLS is / isn't supported
  nvlsRuntimeChannels: number // runtime CTA count (16/24/32), 0 when unsupported
  tuning: TuningResult | null // representative large-message algorithm choice
  clusterTopo: ClusterTopology | null // true multi-node channel rings (multi-node only)
  qpPlan: QPPlan | null // network queue pairs derived from inter-node ring edges
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
      `Multi-node fast path: skipping full-cluster SPFA/search for ${suConfig.serverCount} servers`,
      'Per-server ring/tree deferred to node view; cluster rails/QPs built from the rail-optimized fabric',
      'init.ts',
      [],
      { serverCount: suConfig.serverCount, totalNodes: system.nodes.length, totalLinks: system.links.length },
    )

    // Intra-node ring cycles from one representative server (all servers are
    // identical) — the real single-server search supplies the per-channel
    // orderings that the cluster rings are built from.
    const oneLog = new DecisionLog()
    const oneServer = buildTopoSystem(config, env, oneLog)
    computeAllPaths(oneServer, env, oneLog)
    trimSystem(oneServer, env, oneLog)
    computeAllPaths(oneServer, env, oneLog)
    const intraRing = ncclTopoCompute(
      oneServer, GraphPattern.RING, 1, Math.max(1, Math.floor(MAXCHANNELS / 2)), env, oneLog,
    )
    let intraOrders = intraOrdersFromRingGraph(intraRing)
    if (intraOrders.length === 0) {
      // Search fallback: a single identity-order channel.
      intraOrders = [Array.from({ length: config.gpu.count }, (_, g) => g)]
    }

    // True multi-node channel rings: one ring per channel spanning every GPU —
    // intra chain per server, exiting via the channel's rail to the next server
    // (search.cc:837, connect.cc:106-109). QPs = nChannels × nNodes × qps/conn.
    const clusterTopo = buildClusterChannels({
      serverCount: suConfig.serverCount,
      gpuPerServer: config.gpu.count,
      nicCount: config.nic.count,
      railCount: suConfig.railCount,
      intraOrders,
    })
    const qpPlan = buildQPs(clusterTopo)

    log.emit(
      'searchInit',
      `Cluster construction: ${clusterTopo.nChannels} channel rings × ${clusterTopo.serverCount * config.gpu.count} GPUs, ${qpPlan.total} QPs`,
      `Each channel is one ring over all GPUs (intra chain per server, rail exit); ` +
        `QPs = ${clusterTopo.nChannels} channels × ${suConfig.serverCount} nodes × ${qpPlan.qpsPerConnection}/conn`,
      'search.cc:837, connect.cc:106-109, net_ib/connect.cc:60',
      [],
      {
        nChannels: clusterTopo.nChannels,
        ringSpan: clusterTopo.serverCount * config.gpu.count,
        totalQPs: qpPlan.total,
        railCount: suConfig.railCount,
      },
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

    return {
      system,
      ringGraph: emptyRing,
      treeGraph: emptyTree,
      nvlsGraph: null,
      nvlsSupported: false,
      nvlsReason: 'Multi-node fast path — NVLS analysis deferred to node view',
      nvlsRuntimeChannels: 0,
      tuning: null,
      clusterTopo,
      qpPlan,
      log,
    }
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
  // Step 9: NVLS (NVLink SHARP) — Hopper+ NVSwitch in-network reduction
  // -------------------------------------------------------------------------
  const gpuNodes = system.nodesByType.get(NodeType.GPU) ?? []
  let ccMin = Infinity
  for (const g of gpuNodes) {
    if (g.gpu && g.gpu.cudaCompCap < ccMin) ccMin = g.gpu.cudaCompCap
  }
  const ccMinVal = Number.isFinite(ccMin) ? ccMin : 0

  log.emit(
    'searchInit',
    'Step 9: NVLS support check + graph',
    'Evaluating NVLink SHARP eligibility (SM90+ GPUs on an NVSwitch fabric)',
    'init.cc:nvlsSupport',
  )

  const nvls = nvlsSupport(system, ccMinVal, env, log)
  let nvlsGraph: TopoGraph | null = null
  let nvlsRuntimeCh = 0
  if (nvls.supported) {
    nvlsGraph = computeNvlsGraph(system, ccMinVal, log)
    // Runtime CTA count (nvls.cc:203-213) — distinct from the graph head count.
    nvlsRuntimeCh = nvlsRuntimeChannels(ccMinVal, system.inter)
    const nvlsOverride = getEnvInt(env, 'NCCL_NVLS_NCHANNELS')
    if (nvlsOverride > 0) nvlsRuntimeCh = nvlsOverride
    // NCCL revokes NVLS support if the graph found no channels (init.cc:1453).
    if (nvlsGraph.nChannels === 0) {
      nvlsGraph = null
      nvls.supported = false
      nvls.reason = 'NVLS graph search found 0 channels'
      nvlsRuntimeCh = 0
    }
  }

  // -------------------------------------------------------------------------
  // Step 10: Tuning — representative large-message algorithm selection.
  // NCCL tunes per collective size; we evaluate a representative 128 MB
  // all-reduce (the bandwidth-bound regime where NVLS is chosen when supported).
  // -------------------------------------------------------------------------
  const REPRESENTATIVE_MSG_SIZE = 128 * 1024 * 1024 // 128 MB
  log.emit(
    'searchInit',
    'Step 10: Algorithm/protocol tuning',
    `Selecting algorithm for a representative ${REPRESENTATIVE_MSG_SIZE / (1024 * 1024)} MB all-reduce`,
    'tuning.cc:ncclTopoTuneModel',
  )

  const tuning = selectAlgorithm(
    system,
    connected.ringGraph,
    connected.treeGraph,
    nvlsGraph,
    REPRESENTATIVE_MSG_SIZE,
    nGpus,
    ccMinVal,
    env,
    log,
  )

  // -------------------------------------------------------------------------
  // GRAPH dump in NCCL's exact log format (ncclTopoPrintGraph, search.cc:1319)
  // — directly diffable against a real NCCL_DEBUG=INFO,GRAPH dump.
  // -------------------------------------------------------------------------
  const graphLines = [
    formatTopoGraph(connected.ringGraph),
    formatTopoGraph(connected.treeGraph),
    ...(nvlsGraph ? [formatTopoGraph(nvlsGraph, { sameChannels: 0 })] : []),
  ]
  log.emit(
    'channelSetup',
    'GRAPH dump (NCCL log format)',
    graphLines.join('  |  '),
    'search.cc:1319 ncclTopoPrintGraph',
    [],
    { graphLines },
  )

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
      nvlsChannels: nvlsGraph?.nChannels ?? 0,
      nvlsSupported: nvls.supported,
      tuningAlgorithm: tuning.algorithm,
      nGpus,
      romeModelMatch,
      logEntries: log.length,
    },
  )

  return {
    system,
    ringGraph: connected.ringGraph,
    treeGraph: connected.treeGraph,
    nvlsGraph,
    nvlsSupported: nvls.supported,
    nvlsReason: nvls.reason,
    nvlsRuntimeChannels: nvlsRuntimeCh,
    tuning,
    clusterTopo: null,
    qpPlan: null,
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
