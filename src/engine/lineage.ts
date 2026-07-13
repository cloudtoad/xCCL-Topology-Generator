// =============================================================================
// Lineage — the datapoint derivation graph.
//
// "Every system is a giant graph of datapoints with connecting functions.
//  As a mechanic rather than a scientist, I want to know the map."
//
// Every value the engine derives is a node: { value, producedBy, sourceRef,
// upstream[] }. Roots are operator inputs (config, env); everything else
// dangles from something. Diagnosis = walk upstream from a wrong value to the
// first node that disagrees with reality.
//
// NCCL's init is purely functional — no clocks, no feedback — so this graph
// is COMPLETE: every downstream value is reachable from the roots. The DFD
// discipline is enforced at build time: an upstream reference to a node that
// doesn't exist throws ("no arrow from nowhere").
//
// v1 records the derivation spine declaratively, bound to the real computed
// results (values are read from the engine's actual outputs, never recomputed
// here). Each edge cites where real NCCL performs that mapping.
// =============================================================================

import type { HardwareConfig, SUConfig, TopoSystem } from './types'
import { NodeType, LinkType, Algorithm, Protocol } from './types'
import type { InitResult } from './init'
import type { EnvConfig } from './env'
import { getEnvInt } from './env'
import { PATH_TYPE_STR } from './log-replay'

export type LineagePhase = 'roots' | 'topology' | 'search' | 'graphs' | 'cluster' | 'tuning'

export interface LineageNode {
  id: string
  label: string
  value: string
  kind: 'root' | 'derived'
  /** The connecting function — how upstream became this value. */
  producedBy: string
  sourceRef: string
  upstream: string[]
  phase: LineagePhase
}

export interface LineageGraph {
  nodes: Map<string, LineageNode>
}

/** Ancestor closure, nearest-first (BFS upstream, deduped). */
export function ancestors(graph: LineageGraph, id: string): LineageNode[] {
  const out: LineageNode[] = []
  const seen = new Set<string>([id])
  let frontier = graph.nodes.get(id)?.upstream ?? []
  while (frontier.length > 0) {
    const next: string[] = []
    for (const uid of frontier) {
      if (seen.has(uid)) continue
      seen.add(uid)
      const n = graph.nodes.get(uid)
      if (n) {
        out.push(n)
        next.push(...n.upstream)
      }
    }
    frontier = next
  }
  return out
}

/** Direct dependents — who reads this value. */
export function dependents(graph: LineageGraph, id: string): LineageNode[] {
  return [...graph.nodes.values()].filter((n) => n.upstream.includes(id))
}

/** Render the whole graph (or the ancestry of `focusId`) as mermaid. */
export function toMermaid(graph: LineageGraph, focusId?: string): string {
  let nodes = [...graph.nodes.values()]
  if (focusId) {
    const keep = new Set([focusId, ...ancestors(graph, focusId).map((n) => n.id)])
    nodes = nodes.filter((n) => keep.has(n.id))
  }
  const lines = ['flowchart LR']
  for (const n of nodes) {
    const text = `${n.label}<br/>${n.value}`.replace(/"/g, "'")
    lines.push(n.kind === 'root' ? `  ${mid(n.id)}["${text}"]` : `  ${mid(n.id)}(["${text}"])`)
  }
  for (const n of nodes) {
    for (const u of n.upstream) {
      if (!focusId || nodes.some((x) => x.id === u)) lines.push(`  ${mid(u)} --> ${mid(n.id)}`)
    }
  }
  return lines.join('\n')
}

function mid(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_')
}

// =============================================================================
// buildLineage — declarative derivation map bound to real results
// =============================================================================

export function buildLineage(
  config: HardwareConfig,
  env: EnvConfig,
  suConfig: SUConfig | undefined,
  result: Pick<
    InitResult,
    | 'system' | 'buildSystem' | 'ringGraph' | 'treeGraph' | 'nvlsGraph'
    | 'nvlsSupported' | 'nvlsReason' | 'nvlsRuntimeChannels' | 'tuning'
    | 'clusterTopo' | 'qpPlan' | 'ringBuildTrace'
  >,
): LineageGraph {
  const nodes = new Map<string, LineageNode>()
  const add = (n: LineageNode) => {
    for (const u of n.upstream) {
      if (!nodes.has(u)) {
        throw new Error(`lineage: node '${n.id}' references unknown upstream '${u}' — no arrow from nowhere`)
      }
    }
    nodes.set(n.id, n)
  }

  const searched: TopoSystem = result.buildSystem ?? result.system
  const multiNode = !!suConfig && suConfig.serverCount > 1
  const inter = searched.inter

  // ── roots ──────────────────────────────────────────────────────────────────
  add({
    id: 'cfg.gpu', label: 'GPUs (config)', kind: 'root', phase: 'roots',
    value: `${config.gpu.count}× ${config.gpu.type} (cc ${config.gpu.cudaCompCap})`,
    producedBy: 'operator template selection', sourceRef: 'config', upstream: [],
  })
  add({
    id: 'cfg.nvlinks', label: 'NVLinks per GPU', kind: 'root', phase: 'roots',
    value: String(config.gpu.nvlinksPerPair),
    producedBy: 'operator template selection', sourceRef: 'config', upstream: [],
  })
  add({
    id: 'cfg.nvswitch', label: 'NVSwitches', kind: 'root', phase: 'roots',
    value: String(config.nvswitch.count),
    producedBy: 'operator template selection', sourceRef: 'config', upstream: [],
  })
  add({
    id: 'cfg.nic', label: 'NICs (config)', kind: 'root', phase: 'roots',
    value: `${config.nic.count}× ${config.nic.speed} GB/s`,
    producedBy: 'operator template selection', sourceRef: 'config', upstream: [],
  })
  add({
    id: 'cfg.pcie', label: 'PCIe (config)', kind: 'root', phase: 'roots',
    value: `Gen${config.pcie.gen} x${config.pcie.width}`,
    producedBy: 'operator template selection', sourceRef: 'config', upstream: [],
  })
  const minCh = getEnvInt(env, 'NCCL_MIN_NCHANNELS')
  const maxCh = getEnvInt(env, 'NCCL_MAX_NCHANNELS')
  add({
    id: 'env.channelBounds', label: 'Channel bounds (env)', kind: 'root', phase: 'roots',
    value: `${minCh < 0 ? 'auto' : minCh} .. ${maxCh < 0 ? 'auto' : maxCh}`,
    producedBy: 'NCCL_MIN_NCHANNELS / NCCL_MAX_NCHANNELS', sourceRef: 'init.cc:1060-1072', upstream: [],
  })
  if (multiNode) {
    add({
      id: 'su.serverCount', label: 'Servers', kind: 'root', phase: 'roots',
      value: String(suConfig!.serverCount),
      producedBy: 'operator scalable-unit config', sourceRef: 'config', upstream: [],
    })
    add({
      id: 'su.railCount', label: 'Rails', kind: 'root', phase: 'roots',
      value: String(suConfig!.railCount),
      producedBy: 'operator scalable-unit config (RA cabling plan)', sourceRef: 'config', upstream: [],
    })
  }

  // ── topology ───────────────────────────────────────────────────────────────
  const nvsNode = (searched.nodesByType.get(NodeType.NVS) ?? [])[0]
  const nvLink = nvsNode
    ? searched.links.find((l) => l.type === LinkType.NVL && l.toId === nvsNode.id)
    : searched.links.find((l) => l.type === LinkType.NVL)
  if (nvLink) {
    add({
      id: 'topo.nvBw', label: 'NVLink BW (aggregate)', kind: 'derived', phase: 'topology',
      value: `${nvLink.bandwidth.toFixed(1)} GB/s per GPU`,
      producedBy: 'links × per-link BW, aggregated onto one logical NVS',
      sourceRef: 'topo.ts:220-241 · NVIDIA/nccl#1197 ("NVS/0 @ 360")',
      upstream: ['cfg.gpu', 'cfg.nvlinks', 'cfg.nvswitch'],
    })
  }
  const pciLink = searched.links.find(
    (l) => l.type === LinkType.PCI && l.fromId.startsWith('gpu'),
  )
  if (pciLink) {
    add({
      id: 'topo.pciBw', label: 'PCIe BW', kind: 'derived', phase: 'topology',
      value: `${pciLink.bandwidth.toFixed(1)} GB/s`,
      producedBy: 'generation × width lane math',
      sourceRef: 'topo.ts pcieBandwidth', upstream: ['cfg.pcie'],
    })
  }
  const topoUp = [nvLink ? 'topo.nvBw' : null, pciLink ? 'topo.pciBw' : null].filter(
    (x): x is string => !!x,
  )
  add({
    id: 'paths.matrix', label: 'Paths matrix', kind: 'derived', phase: 'topology',
    value: `${searched.paths.size} pairs, classified LOC..NET`,
    producedBy: 'SPFA best-bandwidth flood + locality classification (×2: pre/post trim)',
    sourceRef: 'paths.cc:67 · init.cc:1143-1147', upstream: [...topoUp, 'cfg.nvswitch'],
  })
  add({
    id: 'topo.totalBw', label: 'totalBw (injection ceiling)', kind: 'derived', phase: 'topology',
    value: `${searched.totalBw.toFixed(1)} GB/s`,
    producedBy: 'max(pciBw, Σ NVLink bw) for one GPU',
    sourceRef: 'search.cc:24-46', upstream: topoUp,
  })
  add({
    id: 'topo.maxBw', label: 'maxBw (best path)', kind: 'derived', phase: 'topology',
    value: `${searched.maxBw.toFixed(1)} GB/s`,
    producedBy: 'best path bandwidth anywhere',
    sourceRef: 'search.cc:14-53', upstream: ['paths.matrix'],
  })

  // ── search + ring graph (absent on the multi-node fast path) ──────────────
  const ring = result.ringGraph
  const haveRing = ring.nChannels > 0
  if (haveRing) {
    add({
      id: 'search.speed', label: 'Per-channel speed', kind: 'derived', phase: 'search',
      value: `${ring.speedIntra.toFixed(1)} GB/s`,
      producedBy: 'speed ladder descent bounded by ceilings (two-pass: descend, then climb)',
      sourceRef: 'search.cc:1074+ · 1246 · 1267-1283', upstream: ['topo.maxBw', 'topo.totalBw'],
    })
    add({
      id: 'search.typeIntra', label: 'typeIntra (accepted)', kind: 'derived', phase: 'search',
      value: PATH_TYPE_STR[ring.typeIntra] ?? String(ring.typeIntra),
      producedBy: 'relaxation ladder rung 3 (typeIntra++ until feasible)',
      sourceRef: 'search.cc:1224', upstream: ['paths.matrix'],
    })
    if (inter) {
      add({
        id: 'search.typeInter', label: 'typeInter (accepted)', kind: 'derived', phase: 'search',
        value: PATH_TYPE_STR[ring.typeInter] ?? String(ring.typeInter),
        producedBy: 'relaxation ladder rung 4 (typeInter++ until feasible)',
        sourceRef: 'search.cc:1231', upstream: ['paths.matrix'],
      })
      const crossNic = ring.channels.some((c) => c.netIn && c.netOut && c.netIn !== c.netOut)
      add({
        id: 'search.crossNic', label: 'crossNic', kind: 'derived', phase: 'search',
        value: crossNic ? '1 (exit ≠ entry NIC)' : '0 (exit = entry NIC)',
        producedBy: 'relaxation ladder rung 5 (only if rungs 1-4 failed)',
        sourceRef: 'search.cc:1239', upstream: ['paths.matrix', 'cfg.nic'],
      })
    }
    const dupEvent = result.ringBuildTrace?.events.find((e) => e.kind === 'dup') as
      | { kind: 'dup'; fromChannels: number; toChannels: number } | undefined
    if (dupEvent) {
      add({
        id: 'search.preDupChannels', label: 'Channels found (pre-dup)', kind: 'derived', phase: 'search',
        value: String(dupEvent.fromChannels),
        producedBy: 'ring search: channels until bandwidth exhausted',
        sourceRef: 'search.cc:1074+', upstream: ['search.speed', 'paths.matrix'],
      })
    }
    add({
      id: 'ring.nChannels', label: 'Ring channels', kind: 'derived', phase: 'search',
      value: String(ring.nChannels),
      producedBy: dupEvent
        ? `DupChannels: ${dupEvent.fromChannels} rings mirrored → ${dupEvent.toChannels} at half bw`
        : inter
          ? 'one channel per NIC until NET budgets exhausted (NIC rotation)'
          : 'channels found at accepted speed',
      sourceRef: dupEvent ? 'search.cc:1257 (ncclTopoDupChannels)' : 'search.cc:726+ · 1074+',
      upstream: [
        ...(dupEvent ? ['search.preDupChannels'] : ['search.speed', 'paths.matrix']),
        ...(inter ? ['cfg.nic'] : []),
        'env.channelBounds',
      ],
    })
    const ch0 = ring.channels[0]
    if (inter && ch0?.netIn) {
      add({
        id: 'ring.ch0.netIn', label: 'Channel 0 entry NET', kind: 'derived', phase: 'search',
        value: ch0.netIn,
        producedBy: 'NIC rotation: nets[(channel + i) % netCount]',
        sourceRef: 'search.cc:735', upstream: ['cfg.nic'],
      })
    }
    if (ch0) {
      add({
        id: 'ring.ch0.order', label: 'Channel 0 ring order', kind: 'derived', phase: 'search',
        value: ch0.ringOrder.map((g) => g.replace('gpu-', '')).join('→'),
        producedBy: 'per-hop tiebreaker cascade + backtracking recursion',
        sourceRef: 'search.cc:202-211 (cmpScore) · 622+ (recursion)',
        upstream: [
          'search.typeIntra', 'paths.matrix',
          ...(inter && ch0.netIn ? ['ring.ch0.netIn'] : []),
        ],
      })
    }
  }

  // ── graphs ─────────────────────────────────────────────────────────────────
  if (result.treeGraph.nChannels > 0 && haveRing) {
    add({
      id: 'tree.nChannels', label: 'Tree channels', kind: 'derived', phase: 'graphs',
      value: String(result.treeGraph.nChannels),
      producedBy: 'tree search bounded by ring result, then channel doubling',
      sourceRef: 'init.cc:1084 · connect.ts', upstream: ['ring.nChannels'],
    })
    if (nodes.has('ring.ch0.order')) {
      add({
        id: 'tree.structure', label: 'Tree structure', kind: 'derived', phase: 'graphs',
        value: `${result.treeGraph.channels.length} trees, folded (not searched)`,
        producedBy: 'trees FOLD from the ring intra order',
        sourceRef: 'L5 · search.cc:835 · connect.cc', upstream: ['ring.ch0.order'],
      })
    }
  }
  add({
    id: 'nvls.supported', label: 'NVLS support', kind: 'derived', phase: 'graphs',
    value: result.nvlsSupported ? 'yes' : `no — ${result.nvlsReason}`,
    producedBy: 'SM90+ gate ∧ NVSwitch present ∧ env enable ∧ graph found channels',
    sourceRef: 'init.cc nvlsSupport · :1446 (revoke-on-empty)',
    upstream: ['cfg.nvswitch', 'cfg.gpu'],
  })
  if (result.nvlsSupported && result.nvlsGraph) {
    add({
      id: 'nvls.heads', label: 'NVLS heads', kind: 'derived', phase: 'graphs',
      value: `${result.nvlsGraph.nChannels} (1/GPU)`,
      producedBy: 'min(MAX_NVLS_ARITY=32, nGPUs) heads',
      sourceRef: 'search.cc:450', upstream: ['cfg.gpu', 'nvls.supported'],
    })
    add({
      id: 'nvls.ctas', label: 'NVLS CTAs (runtime)', kind: 'derived', phase: 'graphs',
      value: String(result.nvlsRuntimeChannels),
      producedBy: 'compCap + single/multi-node table (distinct from graph heads)',
      sourceRef: 'nvls.cc:203-213',
      upstream: ['nvls.supported', ...(multiNode ? ['su.serverCount'] : [])],
    })
  }

  // ── cluster ────────────────────────────────────────────────────────────────
  if (result.clusterTopo && result.qpPlan) {
    add({
      id: 'cluster.nChannels', label: 'Cluster channel rings', kind: 'derived', phase: 'cluster',
      value: `${result.clusterTopo.nChannels} rings × ${result.clusterTopo.serverCount * result.clusterTopo.gpuPerServer} GPUs`,
      producedBy: haveRing
        ? 'one global ring per searched channel: intra chain per server, rail exit, stitched'
        : 'stitched from a representative server\'s intra search (fast path)',
      sourceRef: 'search.cc:837 · connect.cc:106-109 · connect.cc:380',
      upstream: haveRing ? ['ring.nChannels', 'su.serverCount'] : ['cfg.gpu', 'cfg.nic', 'su.serverCount'],
    })
    add({
      id: 'qp.total', label: 'IB queue pairs', kind: 'derived', phase: 'cluster',
      value: `${result.qpPlan.total} = ${result.clusterTopo.nChannels}ch × ${result.clusterTopo.serverCount} nodes × ${result.qpPlan.qpsPerConnection}/conn`,
      producedBy: 'nChannels × nNodes × NCCL_IB_QPS_PER_CONNECTION (default 1)',
      sourceRef: 'net_ib/connect.cc:60', upstream: ['cluster.nChannels', 'su.serverCount'],
    })
  }

  // ── tuning ─────────────────────────────────────────────────────────────────
  if (result.tuning) {
    add({
      id: 'tuning.algorithm', label: 'Algorithm (128 MB all-reduce)', kind: 'derived', phase: 'tuning',
      value: `${Algorithm[result.tuning.algorithm]} / ${Protocol[result.tuning.protocol]} · ${result.tuning.bandwidth.toFixed(0)} GB/s est`,
      producedBy: 'bus-bandwidth model comparison across available graphs',
      sourceRef: 'tuning.cc:306-325',
      upstream: [
        ...(haveRing ? ['ring.nChannels'] : []),
        ...(nodes.has('tree.nChannels') ? ['tree.nChannels'] : []),
        'nvls.supported', 'topo.totalBw',
      ],
    })
  }

  return { nodes }
}
