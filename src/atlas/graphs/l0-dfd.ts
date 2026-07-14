// L0 DFD — the whole init pipeline (initTransportsRank) as Structured Systems
// Analysis: numbered processes, data stores, external entities, labeled flows.
// Browser twin of docs/diagrams/L0-SSA.mmd (which caught the preset-before-
// exchange ordering bug in our own rulebook — the map audits the territory).
import { mid } from '../ids'

const n = mid

export const L0_DFD_TITLE = 'L0 · The init pipeline — every process, every store, every flow'

export const L0_DFD = `flowchart TB
  ${n('L0.e.hw')}["sysfs + NVML<br/>hardware truth"]
  ${n('L0.e.env')}["Environment<br/>NCCL_TOPO_FILE · MIN/MAX_NCHANNELS<br/>NCCL_ALGO · NCCL_GRAPH_FILE"]
  ${n('L0.e.boot')}["Bootstrap ring<br/>peer ranks 0..N-1"]

  ${n('L0.d.peerInfo')}[("peerInfo<br/>hostHash · fabricInfo<br/>from AllGather1")]
  ${n('L0.d.topo')}[("comm->topo<br/>ncclTopoSystem<br/>GPU·PCI·NVS·CPU·NIC·NET")]
  ${n('L0.d.paths')}[("paths matrix<br/>type + bw per pair")]
  ${n('L0.d.graphs')}[("graphs array<br/>ncclTopoGraph per algo")]
  ${n('L0.d.ag3')}[("allGather3Data 0..N-1<br/>graphInfo × algos + topoRanks")]
  ${n('L0.d.firstRank')}[("nodesFirstRank<br/>rankToNode")]
  ${n('L0.d.channels')}[("comm->channels<br/>ring prev/next · tree up/down")]
  ${n('L0.d.qps')}[("connectors + QPs")]
  ${n('L0.d.tuning')}[("tuning thresholds<br/>latency tables")]

  ${n('L0.p1')}(["1.0 BUILD TOPOLOGY<br/>ncclTopoGetSystem<br/>init.cc:1141 · topo.cc:1765"])
  ${n('L0.p2')}(["2.0 COMPUTE PATHS — SPFA<br/>ncclTopoComputePaths<br/>init.cc:1143 / :1147"])
  ${n('L0.p3')}(["3.0 TRIM UNREACHABLE<br/>ncclTopoTrimSystem<br/>init.cc:1145"])
  ${n('L0.p5')}(["5.0 SEARCH INIT<br/>maxBw · totalBw ceilings<br/>search.cc:14-53"])
  ${n('L0.p6')}(["6.0 COMPUTE GRAPHS<br/>ncclTopoCompute — two-pass ladder<br/>(click, then drill into L2)<br/>init.cc:1174-1215"])
  ${n('L0.p7')}(["7.0 PRESET<br/>stamps skeletons,<br/>FILLS topoRanks payload<br/>init.cc:1279-1280 · connect.cc:20"])
  ${n('L0.p7b')}(["7b EXCHANGE + MERGE<br/>bootstrapAllGather · min/max fold<br/>init.cc:1282 · 1291-1300 · 1438-1446"])
  ${n('L0.p8')}(["8.0 POSTSET<br/>cross-node stitch<br/>init.cc:1480 · connect.cc:380"])
  ${n('L0.p9')}(["9.0 TRANSPORTS<br/>p2p>shm>net first-wins → QPs<br/>init.cc:1631 · transport.cc:15-42"])
  ${n('L0.p10')}(["10.0 TUNE<br/>ncclTopoTuneModel<br/>init.cc:1644 · tuning.cc"])

  ${n('L0.done')}[/"COMM READY — this flow never runs again<br/>(no reconvergence edge exists)"/]

  ${n('L0.e.hw')} -- "PCIe tree · NVLink regs" --> ${n('L0.p1')}
  ${n('L0.e.env')} -- "NCCL_TOPO_FILE override" --> ${n('L0.p1')}
  ${n('L0.d.peerInfo')} -- "fabricInfo MNNVL · hostHashes" --> ${n('L0.p1')}
  ${n('L0.p1')} -- "typed graph" --> ${n('L0.d.topo')}

  ${n('L0.d.topo')} --> ${n('L0.p2')}
  ${n('L0.p2')} -- "best-bw paths, classified<br/>LOC..NVL..PIX..PXB..PXN..PHB..SYS" --> ${n('L0.d.paths')}
  ${n('L0.d.paths')} --> ${n('L0.p3')}
  ${n('L0.p3')} -- "trimmed system" --> ${n('L0.d.topo')}
  ${n('L0.p3')} -. "LOOP: recompute after trim<br/>(2nd and final pass)" .-> ${n('L0.p2')}

  ${n('L0.d.topo')} --> ${n('L0.p5')}
  ${n('L0.d.paths')} --> ${n('L0.p5')}
  ${n('L0.p5')} -- "maxBw · totalBw" --> ${n('L0.p6')}
  ${n('L0.e.env')} -- "channel bounds · overrides" --> ${n('L0.p6')}
  ${n('L0.d.paths')} -- "path types + bw budgets" --> ${n('L0.p6')}
  ${n('L0.p6')} -- "one ncclTopoGraph per algo" --> ${n('L0.d.graphs')}
  ${n('L0.p6')} -. "LOOP ×5: RING first and mandatory ·<br/>TREE bounded by ring · CollNet/NVLS conditional" .-> ${n('L0.p6')}

  ${n('L0.d.graphs')} -- "graphInfo tuples (8 fields)" --> ${n('L0.p7')}
  ${n('L0.p7')} -- "ring prev/next skeletons" --> ${n('L0.d.channels')}
  ${n('L0.p7')} -- "topoRanks: ringRecv/ringSend" --> ${n('L0.d.ag3')}

  ${n('L0.d.ag3')} --> ${n('L0.p7b')}
  ${n('L0.p7b')} -- "my row out · all rows in" --- ${n('L0.e.boot')}
  ${n('L0.p7b')} -- "merged graphs: MIN channels/bw ·<br/>MAX path types/crossNic" --> ${n('L0.d.graphs')}
  ${n('L0.p7b')} -- "node numbering" --> ${n('L0.d.firstRank')}

  ${n('L0.d.graphs')} --> ${n('L0.p8')}
  ${n('L0.d.ag3')} -- "allTopoRanks" --> ${n('L0.p8')}
  ${n('L0.d.firstRank')} --> ${n('L0.p8')}
  ${n('L0.p8')} -- "stitched rings · folded trees" --> ${n('L0.d.channels')}

  ${n('L0.d.channels')} --> ${n('L0.p9')}
  ${n('L0.d.topo')} -- "path types per peer pair" --> ${n('L0.p9')}
  ${n('L0.e.boot')} -- "ncclConnect handshakes" --> ${n('L0.p9')}
  ${n('L0.p9')} -- "QPs = nChannels × nNodes × qpsPerConn" --> ${n('L0.d.qps')}
  ${n('L0.p8')} -- "control: next (init.cc:1631)" --> ${n('L0.p9')}

  ${n('L0.p9')} -- "control: next (init.cc:1644)" --> ${n('L0.p10')}
  ${n('L0.d.graphs')} --> ${n('L0.p10')}
  ${n('L0.p10')} -- "algo/proto per size" --> ${n('L0.d.tuning')}
  ${n('L0.p10')} --> ${n('L0.done')}

  classDef process fill:#12121a,stroke:#00ffff,stroke-width:1.2px,color:#e5e5e5
  classDef store fill:#221f00,stroke:#ffff00,stroke-width:1px,color:#e5e5e5
  classDef entity fill:#1a1a25,stroke:#8888aa,stroke-width:1.4px,color:#e5e5e5
  classDef terminal fill:#0a2a0a,stroke:#00ff88,stroke-width:1.5px,color:#e5e5e5
  class ${n('L0.p1')},${n('L0.p2')},${n('L0.p3')},${n('L0.p5')},${n('L0.p6')},${n('L0.p7')},${n('L0.p7b')},${n('L0.p8')},${n('L0.p9')},${n('L0.p10')} process
  class ${n('L0.d.peerInfo')},${n('L0.d.topo')},${n('L0.d.paths')},${n('L0.d.graphs')},${n('L0.d.ag3')},${n('L0.d.firstRank')},${n('L0.d.channels')},${n('L0.d.qps')},${n('L0.d.tuning')} store
  class ${n('L0.e.hw')},${n('L0.e.env')},${n('L0.e.boot')} entity
  class ${n('L0.done')} terminal
`
