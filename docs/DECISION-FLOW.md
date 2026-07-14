# The Decision Flow — Pseudo-Code with Loops

*Companion to [ORDER-OF-OPERATIONS.md](ORDER-OF-OPERATIONS.md). The rulebook states
**what each rule says**; this document is the **control flow** — when each rule fires,
what loops back where, and every branch on the road from `ncclCommInitRank()` to a tuned
communicator. Old-school systems-analysis style: numbered stations, labeled GOTOs
(the source really uses them), explicit loops. Line references: NCCL 2.30.7, `ref/src/nccl`.*

---

*Rendered companion: [diagrams/L0-SSA.png](diagrams/L0-SSA.png) — the L0 stage as a
Structured Systems Analysis chart (numbered processes, data stores, external entities,
labeled flows); source in [diagrams/L0-SSA.mmd](diagrams/L0-SSA.mmd). An interactive
version lives in the app's **Atlas** view (the default graph): every process and store
is clickable with its source cite, live value where lineage-backed, and jump buttons —
station 6.0 drills straight into the L2 ladder-machine graphs below.*

## The big picture

```
        ┌──────────────────────────────────────────────────────────────┐
        │ 00 BOOTSTRAP   dial root → TCP ring → address book           │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 05 ALLGATHER-1  peerInfo circulates ring · hostHash → nodes  │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 10 DETECT      sysfs/NVML → XML → typed graph                │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 20 PATHS (SPFA) ─── 30 TRIM ───→ GOTO 20 (recompute once)    │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 40 SEARCH-INIT  maxBw · totalBw ceilings                     │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 50 FOR graph IN [RING, TREE, COLLNET×2, NVLS]:  ◄─────────┐  │
        │      60 COMPUTE(graph)      ← the two-pass ladder machine │  │
        │    NEXT graph ────────────────────────────────────────────┘  │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 75 PRESET      channel skeletons · PRODUCES topoRanks        │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 78 ALLGATHER-3  exchange {graphInfo, topoRanks} · min/max    │
        │                 merge · node ids from ring data              │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 80 POSTSET     cross-node stitch (consumes merged topoRanks) │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 85 TRANSPORTS  per peer: p2p → shm → net (first wins) → QPs  │
        └──────────────────────────────┬───────────────────────────────┘
        ┌──────────────────────────────▼───────────────────────────────┐
        │ 90 TUNE        per (coll × algo × proto) → thresholds        │
        └──────────────────────────────┬───────────────────────────────┘
                                       ▼
                          COMM READY — and this flow NEVER RUNS AGAIN.
                          There is no reconvergence arrow. A fabric event
                          mid-job has no path back into this chart.
```

---

## Station 00 — Bootstrap (once per communicator)

```
00.1  rank0: bind(port=0) → kernel assigns ephemeral port          bootstrap.cc:430-458
      magic ← random64  (or NCCL_COMM_ID: fixed port, magic=NCCL_MAGIC)
00.2  every rank: dial root; send {rank, listen-addrs}             bootstrap.cc:297-390
00.3  root: LOOP until nranks check-ins:
        on check-in(r): IF addr(r+1) known → send it to r
                        ELSE remember r's slot            ← save-for-later branch :361-368
00.4  ring edges complete → root thread EXITS (never returns)
00.5  bootstrapAllGather(address book)  — the ring's first cargo   bootstrap.cc:620-655
```

## Station 05 — AllGather1: discovery

```
05.1  fillInfo: busId, hostHash=hash(hostname+boot_id), compCap    init.cc:711-717
05.2  RING-ALLGATHER: LOOP step = 1 .. ⌈N/2⌉ (bidirectional):      bootstrap.cc:1194+
        send slice(rank−step) to next · recv slice from prev · retain & forward
05.3  FOR i IN ranks:
        IF version(i) ≠ mine → WARN mismatch, FAIL                 init.cc:1042
        IF hostHash(i) = mine → same node                          init.cc:1048
05.4  MNNVL: read fabric clique via NVML → NVLink domain groups    init.cc:744-753
```

## Stations 10–40 — Detect, paths, ceilings

```
10.1  IF NCCL_TOPO_FILE set → parse XML                            topo.cc:1774
      ELSE walk sysfs + NVML → XML → typed graph                   topo.cc:1765
20.1  FOR src IN (GPUs ∪ NICs ∪ NETs): SPFA flood → best-bw paths  paths.cc:67
      classify each: LOC NVL NVB PIX PXB PHB SYS NET  (the ladder)
30.1  trim nodes unreachable from my rank → GOTO 20 (recompute)    init.cc:1145-1147
40.1  maxBw  ← best path bw anywhere                               search.cc:14-53
      totalBw ← one GPU's injection ceiling
```

## Station 50 — The graph loop

```
50.1  FOR graph IN [ RING,                 ← first and MANDATORY   init.cc:1174-1215
                     BALANCED_TREE,        ← maxChannels ≤ ring's result
                     COLLNET_CHAIN?, COLLNET_DIRECT?,   (if collnet)
                     NVLS? ]:              (if SM90+ ∧ NVSwitch)
        CALL 60-COMPUTE(graph)
```

## Station 60 — COMPUTE: the two-pass ladder machine (the heart)

*Rendered companions: [diagrams/L2-CFG.png](diagrams/L2-CFG.png) (control flow) and
[diagrams/L2-DFD.png](diagrams/L2-DFD.png) (level-2 data flow). Interactive versions
with cross-links to the Build view and lineage live in the app's **Atlas** view;
sources in `src/atlas/graphs/`.*

```
PROC COMPUTE(pattern):                                             search.cc:1074+
  tmp    ← STRICTEST(pattern)      # crossNic=0 · sameChannels=1 · best path types
  budget ← 2^19 credits            # one credit pool for ALL attempts   :332, :1175
  pass   ← 1
  speedIndex ← first speed ≤ maxBw in speedArray (descending)

SEARCH:                            # ← literal goto target in source
  attempt ← SEARCH-ONE(tmp)                                    → Station 70
  budget  ← budget − attempt.timeSpent                              :1182, :1211
  IF attempt better than best → best ← attempt        # keep-if-better
  IF best.nChannels × best.bw ≥ totalBw  → GOTO DONE  # optimality short-circuit
  IF budget < 0 AND best exists          → GOTO DONE  # out of patience     :1213

  IF pass = 1:                     # ══ THE RELAXATION LADDER — fixed order ══
    IF tmp.sameChannels = 1        → tmp.sameChannels ← 0 ;      GOTO SEARCH  :1206
    IF pattern = BALANCED_TREE     → pattern ← TREE ;            GOTO SEARCH  :1217
    IF tmp.typeIntra < PATH_SYS    → tmp.typeIntra++ ;           GOTO SEARCH  :1224
    IF inter ∧ typeInter < max     → tmp.typeInter++ ;           GOTO SEARCH  :1231
    IF crossNic allowed ∧ ¬set     → tmp.crossNic ← 1 ;          GOTO SEARCH  :1239
    IF speedIndex < last           → speed ↓ one rung ;          GOTO SEARCH  :1246
    # ladder exhausted, nothing found → fall through to DONE (fallback below)

DONE:                                                              :1254
  IF pass = 1:
    DupChannels(best)              # mirror the rings at half bw        :1257
    tmp ← best ; pass ← 2 ; budget refreshed per-attempt (time=-1)
    # ── pass 2 exists to CLIMB BACK UP: try to improve the found solution ──
  IF pass = 2 ∧ budget remains ∧ speedIndex > 0:                   :1267-1283
    IF pattern = RING  → raise bwIntra+bwInter one rung ;        GOTO SEARCH
    IF pattern = NVLS  → raise bwInter only (heads locked) ;     GOTO SEARCH
    IF tree-family     → raise bwIntra only ;                    GOTO SEARCH

  IF best.nChannels = 0:           # ══ LAST RESORT ══                 :1290
    graph ← identity GPU order · bw 0.1 · PATH_SYS · 1 channel
    "Could not find a path… falling back to simple order"
  PRINT "Pattern %d, crossNic %d, nChannels %d, bw %.1f/%.1f, …"      :1319
```

## Station 70 — SEARCH-ONE: channels, replay, recursion, backtracking

```
PROC SEARCH-ONE(tmp):
  (backToNet, backToFirstRank) ← SearchParams(pattern):          search.cc:1005-1017
      inter:  RING → backToNet = nGpus−1   SPLIT_TREE → 1   TREE → 0
      intra:  backToNet = −1 ;  RING → backToFirstRank = nGpus−1

  IF inter:                        # each node searches its OWN topo + NETs
    FOR channel c = 0, 1, 2, …:
      LOOP net IN nets ROTATED BY c:                 # NIC/rail rotation   :735
        IF net.bw < speedInter → NEXT net            # budget skip         :745
        IF c > 0 ∧ sameChannels=1:
          TRY REPLAY channel 0's order through THIS net           :776-780
          IF bandwidth admits → channel done ; NEXT c
        TRY each of net's local GPUs (PIX first)                  :791-803
          → RECURSE(gpu, step=0)
      IF no net worked → done, nChannels = c
  ELSE (intra):
    TRY forced PCI order first (reference, cheap timeout)         :783
    THEN TRY each first-GPU by score → RECURSE(gpu, 0)

PROC RECURSE(gpu, step):                                          search.cc:622+
  IF step = backToNet:             # exit to the fabric                :646
    exit NET = entry NET  (crossNic=0)  |  may differ  (crossNic=1)
  ELIF step = backToFirstRank:     # close the cycle                   :707
    IF path back to first GPU admits bw → RING CLOSED ✓
  ELSE:
    cand ← neighbors SORTED BY L3 CASCADE                         :202-211
           interBw → interPciBw → interNhops → intraBw → intraNhops → index
    LOOP c IN cand:                            ┐
      consume bw on EVERY physical link        │ followPath        :79-91
        of path(gpu → c)                       │
      RECURSE(c, step+1)                       │  ← recursion
      IF subtree dead-ends:                    │
        RESTORE the bandwidth                  │  ← THE BACKTRACK LOOP
        time−− ; IF time exhausted → abort attempt (bubbles up)
      NEXT c                                   ┘
```

## Station 75 — Preset (BEFORE the exchange — it builds the payload)

```
75.1  comm->nChannels ← MIN(ring.nChannels, tree.nChannels)        init.cc:1279
75.2  PRESET: FOR ch IN channels: FOR rank: stamp ring.prev/next   connect.cc:20
        → writes topoRanks (ringRecv/ringSend per channel) INTO
          allGather3Data[rank] — the exchange's payload            init.cc:1280
```

## Station 78 — AllGather3: exchange + the consensus merge loop

```
78.1  publish {pattern, nChannels, sameChannels, bwIntra, bwInter,
               typeIntra, typeInter, crossNic} × topoRanks         init.cc:983-996, 1257-1275
78.2  bootstrapAllGather(allGather3Data)                           init.cc:1282
      RING-ALLGATHER (same relay as 05.2)
78.3  FOR r IN ranks:              # node numbering FROM RING DATA init.cc:1291-1300
        firstRank ← topoRanks(r).ringRecv[0]
        IF firstRank unseen → node[next++] ← firstRank
78.4  FOR r IN ranks:              # ══ capability negotiation ══  init.cc:1438-1446
        nChannels    ← MIN   sameChannels ← MIN
        bwIntra      ← MIN   bwInter      ← MIN
        typeIntra    ← MAX   typeInter    ← MAX   crossNic ← MAX
78.5  IF NVLS graph merged to 0 channels → nvlsSupport ← 0         init.cc:1446
```

## Stations 80–90 — Install, connect, tune

```
80.1  POSTSET: FOR ch: FOR node n: stitch exit(n) → entry(n+1)     connect.cc:380
      (consumes merged allTopoRanks + nodesFirstRank)              init.cc:1480
      trees FOLD from the same intra orders — no second search
85.1  FOR ch: FOR peer IN {prev, next, tree up/down}:
        LOOP t IN [p2p, shm, net]:                                 transport.cc:15-42
          IF t.canConnect(me, peer) → use t ; BREAK   # first wins — admin distance
        IF none → WARN "No transport found" ; FAIL                 :38
      NET pairs → QPs = nChannels × nNodes × NCCL_IB_QPS_PER_CONNECTION
90.1  FOR coll: FOR algo: FOR proto:
        latency/bw model → thresholds                              tuning.cc
END:  comm ready. Return to application.
      ┌────────────────────────────────────────────────────────┐
      │ NOTE THE ABSENT ARROW: nothing loops from steady state │
      │ back into this chart. Reconvergence = job restart.     │
      └────────────────────────────────────────────────────────┘
```

---

## Every loop in the protocol, one table

| # | Loop | Kind | Bound | Where |
|---|------|------|-------|-------|
| 1 | root check-in collection | until-count | nranks | bootstrap.cc:297-390 |
| 2 | ring allgather relay | counted | ⌈N/2⌉ steps (bidirectional) | bootstrap.cc:1194+ |
| 3 | SPFA flood | queue-drain | per source node | paths.cc:67 |
| 4 | paths → trim → paths | one retry | exactly once | init.cc:1145-1147 |
| 5 | graph loop | counted | ≤ 5 graphs, RING first | init.cc:1174-1215 |
| 6 | relaxation ladder | GOTO retry | 6 rungs, fixed order | search.cc:1206-1246 |
| 7 | speed ladder ↓ (pass 1) | index walk | speedArray | search.cc:1246 |
| 8 | speed climb ↑ (pass 2) | index walk | back toward maxBw | search.cc:1267-1283 |
| 9 | search credit pool | budget | 2^19 shared across attempts | search.cc:332, 1175-1213 |
| 10 | channel loop | until-fail | maxChannels | search.cc:726+ |
| 11 | NIC rotation | modular | netCount, offset by channel | search.cc:735 |
| 12 | replay-first | conditional try | once per channel | search.cc:776-780 |
| 13 | candidate loop + backtrack | recursion | nGpus deep, bw-restoring | search.cc:622+, 79-91 |
| 14 | AllGather3 merge | counted | nranks, min/max fold | init.cc:1438-1446 |
| 15 | stitch loop | counted | channels × nodes | connect.cc:380 |
| 16 | transport selection | first-match | ≤ 4 transports per peer | transport.cc:27-42 |
| 17 | tuning sweep | triple loop | colls × algos × protos | tuning.cc |
| — | **reconvergence** | **does not exist** | — | — |
