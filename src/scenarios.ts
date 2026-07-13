// =============================================================================
// Canonical scenarios — the two worked examples the whole app runs on.
//
// No builder, no Generate button: each view auto-loads the example that fits
// its content. Both are DGX H100 based:
//
//   'two-node'  — 2 servers, NICx↔NICx rail pairing; the TRUE traced
//                 inter-node search (Build/Ring/Tree/NVLS views — node-level
//                 detail, rendered on the searched local view + NETs).
//   'four-node' — 4 servers, rail-optimized cluster fast path (Physical
//                 cluster view, rails/QPs, the 32-GPU origin AllGather sim).
//
// Results are computed once and cached; switching views swaps the store.
// =============================================================================
import { runInit } from './engine/init'
import type { InitResult } from './engine/init'
import { dgxH100Config } from './engine/templates/dgx-h100'
import { createDefaultEnvConfig } from './engine/env'
import { useTopologyStore } from './store/topology-store'
import { useDecisionStore } from './store/decision-store'
import { buildLineage } from './engine/lineage'
import type { ViewMode } from './store/ui-store'

export type ScenarioKind = 'two-node' | 'four-node'

const cache = new Map<ScenarioKind, InitResult>()
let active: ScenarioKind | null = null

export function scenarioFor(viewMode: ViewMode): ScenarioKind | null {
  switch (viewMode) {
    case 'build':
    case 'ring':
    case 'tree':
    case 'nvls':
    case 'atlas': // the atlas reads the trace-rich scenario
      return 'two-node'
    case 'physical':
    case 'sim':
      return 'four-node'
    default:
      return null // walkthrough: keep whatever is loaded
  }
}

export function activeScenario(): ScenarioKind | null {
  return active
}

export function loadScenario(kind: ScenarioKind): void {
  if (active === kind) return
  let result = cache.get(kind)
  if (!result) {
    result = runInit(dgxH100Config, createDefaultEnvConfig(), {
      serverCount: kind === 'two-node' ? 2 : 4,
      railCount: 8,
      networkType: 'rail-optimized',
    })
    cache.set(kind, result)
  }
  active = kind

  const t = useTopologyStore.getState()
  t.setHardwareConfig(dgxH100Config)
  t.setSUConfig({ serverCount: kind === 'two-node' ? 2 : 4, railCount: 8 })
  t.setSystem(result.system)
  t.setRingGraph(result.ringGraph)
  t.setTreeGraph(result.treeGraph)
  t.setNvls(result.nvlsGraph, result.nvlsSupported, result.nvlsReason, result.nvlsRuntimeChannels)
  t.setTuning(result.tuning)
  t.setCluster(result.clusterTopo, result.qpPlan)
  t.setRingBuildTrace(result.ringBuildTrace)
  t.setBuildSystem(result.buildSystem)
  t.setLineage(buildLineage(dgxH100Config, createDefaultEnvConfig(), {
    serverCount: kind === 'two-node' ? 2 : 4,
    railCount: 8,
    networkType: 'rail-optimized',
  }, result))

  const d = useDecisionStore.getState()
  d.clear()
  d.addEntries(result.log.getEntries())
}
