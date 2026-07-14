// =============================================================================
// Atlas registry — the shared keys of the graph atlas.
//
// Every node in every atlas graph (CFG, DFD, lineage) is registered here with
// its cross-links: where it lives in the lineage, which Build-view trace event
// demonstrates it, which Guide beat teaches it, where the docs discuss it.
// One id, many views — the artifacts stay separate; the keys make them one map.
// =============================================================================
import { mid } from '../engine/lineage'
import type { RingBuildEvent } from '../engine/ring-build-trace'

export interface AtlasEntry {
  id: string
  title: string
  blurb: string
  sourceRef: string
  /** Lineage datapoint this node corresponds to (opens in the Lineage tab). */
  lineageId?: string
  /** First matching Build-view trace event demonstrates this node live. */
  buildEvent?: { kind: RingBuildEvent['kind']; includes?: string }
  /** Guide beat id that teaches this concept. */
  guideBeat?: string
  /** Anchor into docs/DECISION-FLOW.md. */
  docAnchor?: string
  /** Drill into another atlas graph (the atlas linking to itself). */
  drill?: { graph: 'l0-dfd' | 'l2-cfg' | 'l2-dfd'; label: string }
}

export const ATLAS: Record<string, AtlasEntry> = {
  // ── L0 DFD (the whole init pipeline, Structured Systems Analysis) ──────────
  'L0.e.hw': {
    id: 'L0.e.hw', title: 'Entity: sysfs + NVML',
    blurb: 'Hardware ground truth — the PCIe tree and NVLink registers. Everything downstream is a transformation of what these report.',
    sourceRef: 'topo.cc:1765 (ncclTopoGetSystem)', guideBeat: 'detect',
  },
  'L0.e.env': {
    id: 'L0.e.env', title: 'Entity: environment',
    blurb: 'NCCL_TOPO_FILE, MIN/MAX_NCHANNELS, NCCL_ALGO, NCCL_GRAPH_FILE — the library\'s only "CLI". Env vars enter the pipeline at exactly two points: topology override and search bounds.',
    sourceRef: 'env.cc', lineageId: 'env.channelBounds',
  },
  'L0.e.boot': {
    id: 'L0.e.boot', title: 'Entity: bootstrap ring',
    blurb: 'The TCP management plane from station 00. The pipeline touches it twice: AllGather3 (consensus) and the connect handshakes.',
    sourceRef: 'bootstrap.cc:514-527', docAnchor: 'station-00',
  },
  'L0.p1': {
    id: 'L0.p1', title: '1.0 BUILD TOPOLOGY',
    blurb: 'Parse hardware into the typed graph: GPU, PCI, NVS, CPU, NIC, NET nodes with link bandwidths. The map every later station reads.',
    sourceRef: 'init.cc:1141 · topo.cc:1765', guideBeat: 'graph-build', docAnchor: 'stations-10-40',
  },
  'L0.p2': {
    id: 'L0.p2', title: '2.0 COMPUTE PATHS (SPFA)',
    blurb: 'Best-bandwidth path between every node pair, classified LOC→NVL→PIX→PXB→PXN→PHB→SYS→NET. One pair, one path — fixed here, never revisited by the search.',
    sourceRef: 'init.cc:1143 · paths.cc:67', guideBeat: 'spfa', lineageId: 'paths.matrix',
  },
  'L0.p3': {
    id: 'L0.p3', title: '3.0 TRIM UNREACHABLE',
    blurb: 'Drop nodes no GPU can reach, then LOOP back: recompute paths on the trimmed system (second and final pass).',
    sourceRef: 'init.cc:1145', guideBeat: 'trim',
  },
  'L0.p5': {
    id: 'L0.p5', title: '5.0 SEARCH INIT — ceilings',
    blurb: 'maxBw (best single link out of a GPU) and totalBw (aggregate injection). The optimality short-circuit inside the search compares against these.',
    sourceRef: 'search.cc:14-53', guideBeat: 'ceilings', lineageId: 'topo.totalBw',
  },
  'L0.p6': {
    id: 'L0.p6', title: '6.0 COMPUTE GRAPHS',
    blurb: 'The two-pass ladder machine, once per algorithm (LOOP ×5: RING first and mandatory, TREE bounded by ring, CollNet/NVLS conditional). The densest decision code in NCCL.',
    sourceRef: 'init.cc:1174-1215', docAnchor: 'station-60', lineageId: 'search.accepted',
    buildEvent: { kind: 'phase' },
    drill: { graph: 'l2-cfg', label: 'drill into L2: the ladder machine' },
  },
  'L0.p7': {
    id: 'L0.p7', title: '7.0 PRESET',
    blurb: 'Stamps channel skeletons and FILLS topoRanks — the exchange\'s payload. This is why preset runs BEFORE AllGather3: the order the L0 chart caught wrong in our own rulebook.',
    sourceRef: 'init.cc:1279-1280 · connect.cc:20', guideBeat: 'preset', docAnchor: 'station-75',
  },
  'L0.p7b': {
    id: 'L0.p7b', title: '7b EXCHANGE + MERGE',
    blurb: 'bootstrapAllGather over the mgmt ring, then the consensus fold: MIN of channels/bw, MAX of path types/crossNic; node ids from ringRecv[0]. Every rank arrives at the same answer without a master.',
    sourceRef: 'init.cc:1282 · 1291-1300 · 1438-1446', docAnchor: 'station-78', guideBeat: 'cascade',
  },
  'L0.p8': {
    id: 'L0.p8', title: '8.0 POSTSET',
    blurb: 'Cross-node stitch: rings spliced through their NET legs, trees folded across nodes. The global ring finally exists as prev/next per rank.',
    sourceRef: 'init.cc:1480 · connect.cc:380', guideBeat: 'postset', lineageId: 'tree.structure',
  },
  'L0.p9': {
    id: 'L0.p9', title: '9.0 TRANSPORTS',
    blurb: 'First-wins transport ladder per peer pair (p2p > shm > net), then the QP fan-out. Handshakes ride the bootstrap ring.',
    sourceRef: 'init.cc:1631 · transport.cc:15-42', guideBeat: 'transport-select', lineageId: 'qp.total',
  },
  'L0.p10': {
    id: 'L0.p10', title: '10.0 TUNE',
    blurb: 'Latency/bandwidth model per algorithm × protocol × size; fills the thresholds the steady state consults on every collective.',
    sourceRef: 'init.cc:1644 · tuning.cc', guideBeat: 'tune', lineageId: 'tuning.algorithm',
  },
  'L0.done': {
    id: 'L0.done', title: 'COMM READY',
    blurb: 'This flow never runs again — there is no reconvergence edge. Topology change means tear down and re-init: the routing layer is coupled to the application\'s lifetime.',
    sourceRef: 'init.cc (initTransportsRank returns)', guideBeat: 'first-collective',
  },
  'L0.d.peerInfo': {
    id: 'L0.d.peerInfo', title: 'Store: peerInfo',
    blurb: 'hostHash + fabricInfo per rank, from AllGather1 — who is on my board, my host, my NVLink fabric.',
    sourceRef: 'init.cc (AllGather1)', docAnchor: 'station-05',
  },
  'L0.d.topo': {
    id: 'L0.d.topo', title: 'Store: comm->topo',
    blurb: 'The ncclTopoSystem — the typed hardware graph. Written by 1.0, trimmed by 3.0, read by everything.',
    sourceRef: 'topo.h (ncclTopoSystem)',
  },
  'L0.d.paths': {
    id: 'L0.d.paths', title: 'Store: paths matrix',
    blurb: 'Path type + bandwidth per node pair. The roads. The search picks node orders over these — never alternate routes between a pair.',
    sourceRef: 'paths.cc:67', lineageId: 'paths.matrix',
  },
  'L0.d.graphs': {
    id: 'L0.d.graphs', title: 'Store: graphs array',
    blurb: 'One ncclTopoGraph per algorithm: pattern, nChannels, bwIntra/Inter, types, crossNic, the intra order and inter legs.',
    sourceRef: 'init.cc:1174-1215', lineageId: 'ring.nChannels',
  },
  'L0.d.ag3': {
    id: 'L0.d.ag3', title: 'Store: allGather3Data',
    blurb: 'My graphInfo tuples + topoRanks out; all N ranks\' rows in. The consensus exchange payload — filled by preset, merged by 7b.',
    sourceRef: 'init.cc:1282', docAnchor: 'station-78',
  },
  'L0.d.firstRank': {
    id: 'L0.d.firstRank', title: 'Store: nodesFirstRank',
    blurb: 'Node numbering derived from each node\'s ringRecv[0] — rank order becomes node order becomes ring order.',
    sourceRef: 'init.cc:1291-1300',
  },
  'L0.d.channels': {
    id: 'L0.d.channels', title: 'Store: comm->channels',
    blurb: 'Ring prev/next and tree up/down per channel per rank. What the data plane will actually walk.',
    sourceRef: 'connect.cc:380+',
  },
  'L0.d.qps': {
    id: 'L0.d.qps', title: 'Store: connectors + QPs',
    blurb: 'The RDMA state: nChannels × nNodes × qpsPerConn queue pairs.',
    sourceRef: 'transport.cc', lineageId: 'qp.total', guideBeat: 'qps',
  },
  'L0.d.tuning': {
    id: 'L0.d.tuning', title: 'Store: tuning thresholds',
    blurb: 'Algorithm/protocol choice per message size — the steady state\'s lookup table.',
    sourceRef: 'tuning.cc', lineageId: 'tuning.algorithm',
  },

  // ── L2 CFG (station 60 control flow) ───────────────────────────────────────
  'S60.entry': {
    id: 'S60.entry', title: 'COMPUTE entry — strictest params',
    blurb: 'tmpGraph starts at the strictest constraints: crossNic=0, sameChannels=1, best path types, speed from the top of the ladder (bounded by maxBw).',
    sourceRef: 'search.cc:1074+', docAnchor: 'station-60', guideBeat: 'ceilings',
    drill: { graph: 'l0-dfd', label: '↑ up to the L0 pipeline' },
  },
  'S60.attempt': {
    id: 'S60.attempt', title: 'SEARCH — run one attempt',
    blurb: 'One full ring/tree search at the current constraint set. The literal goto target in the source. Each attempt debits the shared credit pool.',
    sourceRef: 'search.cc:1074+ (goto search)', buildEvent: { kind: 'attempt' }, docAnchor: 'station-60',
  },
  'S60.keep': {
    id: 'S60.keep', title: 'Keep-if-better',
    blurb: 'A candidate replaces the incumbent only when nChannels × bw improves — descending the ladder never clobbers a good solution with a worse one.',
    sourceRef: 'search.cc:445-461 (ncclTopoCompareGraphs)',
  },
  'S60.optimal': {
    id: 'S60.optimal', title: 'Optimality short-circuit',
    blurb: 'If nChannels × bw ≥ totalBw, no better solution exists — stop searching. This is why totalBw (the injection ceiling) had to be computed first.',
    sourceRef: 'search.cc:1135', lineageId: 'topo.totalBw',
  },
  'S60.budget': {
    id: 'S60.budget', title: 'Credit pool check',
    blurb: 'All attempts share one 2^19-credit patience budget. Overdrawn AND holding any solution → give up the ladder and take what you have.',
    sourceRef: 'search.cc:332 · 1175-1213',
  },
  'S60.rungSame': {
    id: 'S60.rungSame', title: 'Rung 1: sameChannels → 0',
    blurb: 'Allow each channel its own ordering. First sacrifice — identical rings are preferred but never required. The 2-node experiment fires this rung.',
    sourceRef: 'search.cc:1206', buildEvent: { kind: 'relax', includes: 'sameChannels' },
  },
  'S60.rungPattern': {
    id: 'S60.rungPattern', title: 'Rung 2: BALANCED_TREE → TREE',
    blurb: 'Tree searches fall back to the simpler pattern before giving up bandwidth.',
    sourceRef: 'search.cc:1217', buildEvent: { kind: 'relax', includes: 'TREE' },
  },
  'S60.rungIntra': {
    id: 'S60.rungIntra', title: 'Rung 3: typeIntra++',
    blurb: 'Accept a worse intra-node path class (NVL → PIX → PXB → PHB → SYS). Every "why is type SYS" answer starts here.',
    sourceRef: 'search.cc:1224', buildEvent: { kind: 'relax', includes: 'typeIntra' },
    lineageId: 'search.typeIntra',
  },
  'S60.rungInter': {
    id: 'S60.rungInter', title: 'Rung 4: typeInter++',
    blurb: 'Accept a worse inter-node path class for the NIC legs.',
    sourceRef: 'search.cc:1231', buildEvent: { kind: 'relax', includes: 'typeInter' },
  },
  'S60.rungXnic': {
    id: 'S60.rungXnic', title: 'Rung 5: crossNic → 1',
    blurb: 'Allow a ring to exit a different NIC than it entered. Fires only when rungs 1-4 failed.',
    sourceRef: 'search.cc:1239', buildEvent: { kind: 'relax', includes: 'crossNic' },
  },
  'S60.rungSpeed': {
    id: 'S60.rungSpeed', title: 'Rung 6: speed ↓ one rung',
    blurb: 'All relaxations exhausted at this speed — drop to the next table speed and start the cascade over with strict constraints.',
    sourceRef: 'search.cc:1246', buildEvent: { kind: 'speed', includes: 'exhausted' },
  },
  'S60.accepted': {
    id: 'S60.accepted', title: 'DONE — solution accepted',
    blurb: 'The parameters are locked. Everything downstream — speed, types, channel count — dangles from this moment.',
    sourceRef: 'search.cc:1254 (done:)', buildEvent: { kind: 'accepted' }, lineageId: 'search.accepted',
  },
  'S60.dup': {
    id: 'S60.dup', title: 'DupChannels',
    blurb: 'Mirror the found rings at half bandwidth to saturate both directions of every link (6@60 → 12@30 on H100).',
    sourceRef: 'search.cc:1257 · 961-974', buildEvent: { kind: 'dup' }, lineageId: 'ring.nChannels',
  },
  'S60.pass2': {
    id: 'S60.pass2', title: 'Phase 2 — the climb',
    blurb: 'Start from the solution and climb the speed ladder back UP, channel count locked. Three-way branch: RING raises both bws; NVLS raises bwInter only; trees raise bwIntra only. Fixed as ledger #17.',
    sourceRef: 'search.cc:1255-1283', buildEvent: { kind: 'improve' }, lineageId: 'search.climb',
  },
  'S60.fallback': {
    id: 'S60.fallback', title: 'Last resort',
    blurb: 'Ladder exhausted with nothing found: identity GPU order, bw 0.1, PATH_SYS, one channel. The protocol never returns "no route" — it returns a terrible one and logs its shame.',
    sourceRef: 'search.cc:1290',
  },
  'S60.exit': {
    id: 'S60.exit', title: 'GRAPH line printed',
    blurb: 'The tuple the whole world sees: "Pattern %d, crossNic %d, nChannels %d, bw %f/%f, type %s/%s, sameChannels %d" — and the tuple AllGather3 will merge.',
    sourceRef: 'search.cc:1319 (ncclTopoPrintGraph)', guideBeat: 'cascade',
    drill: { graph: 'l0-dfd', label: '↑ up to the L0 pipeline' },
  },

  // ── L2 DFD (station 60 data flow) ──────────────────────────────────────────
  'S60.d.initParams': {
    id: 'S60.d.initParams', title: '6.1 INIT PARAMS',
    blurb: 'Seed tmpParams with the strictest constraint set and the ladder start speed.',
    sourceRef: 'search.cc:1074+',
  },
  'S60.d.searchAttempt': {
    id: 'S60.d.searchAttempt', title: '6.2 SEARCH ATTEMPT',
    blurb: 'Consume tmpParams + paths, produce candidate channels; debit the credit pool.',
    sourceRef: 'search.cc:622+ · 726+', buildEvent: { kind: 'attempt' },
  },
  'S60.d.keepBest': {
    id: 'S60.d.keepBest', title: '6.3 KEEP BEST',
    blurb: 'Compare candidate vs incumbent on nChannels × bw; write the winner to bestResult.',
    sourceRef: 'search.cc:445-461',
  },
  'S60.d.relaxSelect': {
    id: 'S60.d.relaxSelect', title: '6.4 RELAX SELECT',
    blurb: 'Pick the next rung in fixed order and update tmpParams; the control heart of the ladder.',
    sourceRef: 'search.cc:1206-1246',
  },
  'S60.d.dup': {
    id: 'S60.d.dup', title: '6.5 DUP CHANNELS',
    blurb: 'Read bestResult, mirror rings at half bandwidth, write back.',
    sourceRef: 'search.cc:961-974', buildEvent: { kind: 'dup' }, lineageId: 'ring.nChannels',
  },
  'S60.d.climb': {
    id: 'S60.d.climb', title: '6.6 PASS-2 CLIMB',
    blurb: 'Re-run attempts at higher speeds with the channel floor locked to the solution.',
    sourceRef: 'search.cc:1255-1283', buildEvent: { kind: 'improve' }, lineageId: 'search.climb',
  },
  'S60.d.fallback': {
    id: 'S60.d.fallback', title: '6.7 FALLBACK',
    blurb: 'Write the identity-order minimal graph when nothing was found.',
    sourceRef: 'search.cc:1290',
  },
  'S60.d.tmpParams': {
    id: 'S60.d.tmpParams', title: 'Store: tmpParams',
    blurb: 'The current constraint set: speed, sameChannels, pattern, typeIntra/Inter, crossNic. Mutated by RELAX SELECT, read by every attempt.',
    sourceRef: 'search.cc (tmpGraph)',
  },
  'S60.d.best': {
    id: 'S60.d.best', title: 'Store: bestResult',
    blurb: 'The incumbent solution. Only KEEP BEST writes it; DUP and CLIMB refine it; the exit reads it.',
    sourceRef: 'search.cc (graph/saveGraph)', lineageId: 'search.accepted',
  },
  'S60.d.budget': {
    id: 'S60.d.budget', title: 'Store: credit pool',
    blurb: '2^19 credits shared by every attempt in both passes. The search runs on a budget of patience.',
    sourceRef: 'search.cc:332 · 1175-1213',
  },
  'S60.d.speedArray': {
    id: 'S60.d.speedArray', title: 'Store: speed ladder',
    blurb: 'The per-architecture speed table. Phase 1 walks it down; phase 2 climbs it back up.',
    sourceRef: 'search.cc (speedArray)', lineageId: 'search.speed',
  },
  'S60.d.paths': {
    id: 'S60.d.paths', title: 'Entity: paths matrix',
    blurb: 'The SPFA product from station 20 — read-only here; every feasibility question is answered against it.',
    sourceRef: 'paths.cc:67', lineageId: 'paths.matrix',
  },
  'S60.d.graphs': {
    id: 'S60.d.graphs', title: 'Entity: graphs array',
    blurb: 'Where the finished ncclTopoGraph lands — the tuple AllGather3 merges and preset consumes.',
    sourceRef: 'init.cc:1174-1215', lineageId: 'ring.nChannels',
  },
}

/** mermaid-sanitized id → registry entry (mermaid node ids must round-trip). */
export const ATLAS_BY_MID: Record<string, AtlasEntry> = Object.fromEntries(
  Object.values(ATLAS).map((e) => [mid(e.id), e]),
)

export { mid }
