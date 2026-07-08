# NCCL / RCCL Ring & Tree Establishment — Order of Operations

*A BGP-best-path-style rulebook for how NCCL and RCCL decide their communication graphs.*

Just as a BGP router walks a fixed, ordered list of tiebreakers to select one best
path (Weight → Local Preference → AS_PATH → Origin → MED → eBGP/iBGP → IGP metric →
router-ID), NCCL walks fixed, ordered cascades to establish its rings and trees. This
document is the authoritative, source-cited statement of those cascades.

- **Reference:** NCCL 2.30.7 (`ref/src/nccl`), RCCL (`ref/src/rccl`) — both gitignored local checkouts.
- **Engine:** every rule below is implemented in `src/engine/` and cross-referenced in the tables.
- **Live trace:** the `DecisionLog` (Decisions tab) emits the *dynamic* firing of these rules for any
  generated topology — the "`show ip bgp`" to this document's "best-path algorithm."

Line numbers are from the referenced checkout and may drift ±a few lines across NCCL versions;
rule *content* is version-stable. There are **five nested cascades**:

```
L0  Pipeline           init.cc          build → paths → trim → paths → searchInit → compute → preset → postset → tune
L1  Which graphs       init.cc:1174     RING → BALANCED_TREE → CollNetChain → CollNetDirect → NVLS
L2  Per-graph search   search.cc:1074   overrides → (RCCL model-match) → speed loop → RELAXATION CASCADE → dup → optimize → fallback
L3  Per-hop GPU pick   search.cc:202    interBw → interPciBw → interNhops → intraBw → intraNhops → startIndex   ← the BGP analog
L4  Best-graph keep    search.cc:445    max(nChannels · bwIntra)   [NVLS: max heads, then nChannels · bwInter]
L5  Closure/derive     search.cc:835    ring closes into a cycle; trees derive from the ring's intra order
L6  Transport → QPs    transport.cc:123 one net send + one net recv per node per channel → IB queue pairs
```

---

## Phase P — Before the search: launch → rendezvous → bootstrap → discovery

Everything in L0–L6 presumes a communicator mid-initialization. Three acts come first —
and this is where the manual/automatic split between frameworks lives.

### P0 — Launch & device binding (outside NCCL entirely)
The launcher (torchrun / mpirun / srun) assigns `RANK`, `WORLD_SIZE`, `LOCAL_RANK`; the
framework binds a device (`cudaSetDevice(LOCAL_RANK)` or equivalent). **The rank↔device
mapping is decided here** — one reason printed ring orders look scrambled relative to
device numbering before NCCL even runs.

### P1 — The rendezvous (`ncclGetUniqueId`, init.cc:183)
Rank 0 creates the unique ID — which is really *the bootstrap root's socket address plus a
magic number*. It must travel to every rank **out-of-band**, and how it travels is the
framework split:

| Framework | Transport for the uniqueId | Manual/automatic |
|---|---|---|
| Raw NCCL + MPI | `MPI_Bcast` of the 128-byte ID | **manual** (you write it) |
| PyTorch (torchrun) | TCPStore rendezvous | automatic |
| `NCCL_COMM_ID=host:port` | env var — every rank dials the address | manual (operator) |
| Single-process (`ncclCommInitAll`) | in-memory | automatic |

### P2 — The bootstrap ring (`bootstrapInit`, init.cc:1916; bootstrap.cc:259-390)
Every rank phones the root; the root collects each rank's listen address and forwards each
rank **its successor's address** as it checks in (bootstrap.cc:361-385) — forming a TCP
socket ring rank→rank+1. **The first ring NCCL builds is made of sockets, before any
topology exists.** All out-of-band collectives (`bootstrapAllGather`) walk this ring.

### P3 — Peer discovery & node detection (AllGather1, init.cc:1034-1067)
Each rank fills `ncclPeerInfo` (busId, **hostHash**, …, init.cc:711-717) and
`bootstrapAllGather`s it. Then the structural facts are *derived*, not configured:
- **"Node" is a hostHash equivalence class** (`fillInfo` sets `hostHash = getHostHash() +
  commHash`, init.cc:717; the multi-node check compares hashes at :1048). Nobody tells
  NCCL the cluster shape — it discovers it.
- Multi-rank-per-GPU detection, MNNVL domain detection (init.cc:1053-1084) follow.
- The *final* node numbering comes even later, from AllGather3: a node is identified by
  `topoRanks.ringRecv[0]` — **the first rank of its ring channel 0** (init.cc:1291-1300
  builds `nodesFirstRank`/`rankToNode` from the exchanged ring data). Node identity is
  literally derived from ring structure.

Only now does topology detection (`ncclTopoGetSystem`) run — entering L0. And one more
cross-rank step lives *between* graph computation and channel wiring, included in the
pipeline table below as step 6b: **AllGather3** (init.cc:969-996, 1257-1275) — every rank
publishes its independently computed graph parameters (`pattern, nChannels, sameChannels,
bwIntra/bwInter, types`) plus `topoRanks`, and the ranks **reconcile to an agreed
communicator-wide plan** before any channel is wired. The merge rule (init.cc:1438-1446)
is a capability negotiation, BGP-style:

| Field | Merge | Meaning |
|---|---|---|
| `nChannels, sameChannels, bwIntra, bwInter` | **min** across ranks | you can't use channels/bandwidth your slowest peer doesn't have |
| `typeIntra, typeInter, crossNic` | **max** across ranks | the worst path type anywhere becomes everyone's path type |

**The communicator is only as strong as its weakest rank.** This is also where NVLS is
revoked if its search found zero channels (`nvlsSupport = 0`, init.cc:1446), and where a
mixed NIC count across ranks warns/errors (`NCCL_IGNORE_NET_MISMATCH`, init.cc:1318-1340).

### P-phase troubleshooting — symptom → phase

Like BGP: nobody debugs best-path until the session is Established. When init "mysteriously
hangs," walk the phases in order — each has a distinct failure signature:

| Symptom | Phase | What actually broke | Source |
|---|---|---|---|
| Hang in `ncclCommInitRank`, zero NCCL output on some ranks | P1 | uniqueId never reached them, or root address unreachable from their network | init.cc:183 |
| Hang with `Bootstrap: Using <if>` showing the **wrong interface** (mgmt vs fabric) | P2 | interface selection — fix `NCCL_SOCKET_IFNAME` (retries: `NCCL_SOCKET_RETRY_CNT`=34 × `NCCL_SOCKET_RETRY_SLEEP_MSEC`=100ms) | bootstrap.cc:133, socket.cc:19-20, 196 |
| Some ranks connect, others time out | P2 | firewall between rank and root, or multi-homed host advertising the wrong listen address | bootstrap.cc:355-390 |
| `WARN Mismatched NCCL version detected` | P3 | heterogeneous NCCL builds in one communicator | init.cc:1042-1046 |
| Two hosts treated as one node (SHM across machines → crash) or one host split into two nodes (NET between local GPUs → perf mystery) | P3 | hostHash = hash(hostname + `/proc/sys/kernel/random/boot_id`), overridable via `NCCL_HOSTID` — containers/images can corrupt either input | utils.cc:95, 117-158 |
| `WARN Multiple Ranks are using the same GPU` | P3 | launcher bound two ranks to one device (`LOCAL_RANK` mapping bug) | init.cc:1053-1060 |
| Channel count / bandwidth mysteriously lower than the hardware supports | 6b | consensus min: ONE straggler rank (downtrained PCIe, missing NIC, flat VM topo) drags every rank's graph down | init.cc:1438-1446 |
| `WARN Detected mixed local Net device counts` | 6b | ranks disagree on NIC count — real hardware asymmetry or detection failure on one host | init.cc:1318-1340 |
| NVLS silently absent from tuning | 6b | NVLS search found 0 channels somewhere → support revoked communicator-wide | init.cc:1446 |

The diagnostic tool for all of it: `NCCL_DEBUG=INFO` (add `NCCL_DEBUG_SUBSYS=BOOTSTRAP,INIT`
to focus). The INFO lines appear in exactly the phase order above — **the last line printed
tells you which phase died.**

---

## L0 — The pipeline (once per communicator)

`init.cc` (`initTransportsRank`) runs these in strict order:

| # | Step | NCCL fn | init.cc | Engine (`src/engine`) |
|---|------|---------|---------|-----------------------|
| 1 | Build topology | `ncclTopoGetSystem` | 1141 | `topo.ts buildTopoSystem` |
| 2 | Compute paths (SPFA) | `ncclTopoComputePaths` | 1143 | `paths.ts computeAllPaths` |
| 3 | Trim unreachable | `ncclTopoTrimSystem` | 1145 | `paths.ts trimSystem` |
| 4 | Recompute paths | `ncclTopoComputePaths` | 1147 | `paths.ts computeAllPaths` |
| 5 | Search init | `ncclTopoSearchInit` | 1149 | (folded into search) |
| 6 | Compute graphs | `ncclTopoCompute` ×N | 1178–1215 | `search.ts` / `nvls.ts` |
| 6b | Cross-rank graph consensus | AllGather3 (`bootstrapAllGather`) | 969-996, 1257-1275 | (not modeled — single-rank engine) |
| 7 | Preset channels/trees | `ncclTopoPreset` | 1281 | `trees.ts` / `connect.ts` |
| 8 | Connect across nodes | `ncclTopoPostset` | 1480 | `connect.ts setupChannels` |
| 9 | Establish transports (QPs) | `ncclTransportP2pSetup` | 1631 | `qp.ts` (modeled) |
| 10 | Tune algo/proto | `ncclTopoTuneModel` | 1644 | `tuning.ts selectAlgorithm` |

Paths are computed **twice** — once before trim and once after — because trimming removes
nodes and changes shortest paths.

---

## L1 — Which graphs, in what order (`init.cc:1174–1215`)

NCCL computes one graph per algorithm, **in this order** (the `id` is NCCL's own):

| Order | Graph | `id` | Pattern | Note |
|-------|-------|------|---------|------|
| 1 | **RING** | 0 | `NCCL_TOPO_PATTERN_RING` | first, and mandatory — everything else is sized by it |
| 2 | **TREE** | 1 | `NCCL_TOPO_PATTERN_BALANCED_TREE` | `maxChannels` bounded by ring's `nChannels` |
| 3 | CollNetChain | 2 | `NCCL_TOPO_PATTERN_TREE` | only if CollNet supported |
| 4 | CollNetDirect | 4 | `NCCL_TOPO_PATTERN_COLLNET_DIRECT` | only if CollNet supported |
| 5 | **NVLS** | 3 | `NCCL_TOPO_PATTERN_NVLS` | only if `nvlsSupport` (SM90+, NVSwitch) |

RING is computed first and is not optional: the tree search's channel budget is derived
from the ring result, and the trees themselves are built from the ring's intra-node ordering
(see **L5**). *(Engine: `init.ts runInit` computes RING → TREE → NVLS; CollNet is a documented gap.)*

---

## L2 — The per-graph search (`ncclTopoCompute`, search.cc:1027 / our `search.ts`)

Each graph is produced by the same routine. Its own order of operations:

### L2.0 — Overrides & the RCCL model-match branch (short-circuits)

Checked **before** any search:

1. `NCCL_GRAPH_FILE` set → load the graph from XML, return if it has channels.
2. `NCCL_RINGS` / `RCCL_TREES` set → parse the user-supplied topology.
3. **RCCL only** (`!RCCL_MODEL_MATCHING_DISABLE && !collNet`) — try pre-computed AMD models
   **in this exact order**, returning on the first match (RCCL `search.cc:1091–1110`):

   | Order | Matcher | Topology |
   |-------|---------|----------|
   | a | `parseChordalRing` | 8P6L chordal ring |
   | b | `parseA2a8P` | 8 GPUs all-to-all connected |
   | c | `parseRome4P2H` | Rome 4P2H (honors `NCCL_RINGS_REMAP`) |
   | d | `parse1H16P` | 1 hive / 16 GPUs |
   | e | `parse4H4P` | 4 hives / 4 GPUs |
   | f | `parseGIOTopos` | GIO fallback set |

   On a match, RCCL uses the **pre-baked ring ordering** (with even/odd host reversal for rings)
   and skips the generic search entirely. This is the one true fork between NCCL and RCCL.
   *(Engine: `rccl/rome-match.ts matchRomeModel`, invoked from `init.ts` before `performRingSearch`.)*

If nothing short-circuits, the generic search runs:

### L2.1 — Speed selection & starting bandwidth (search.cc:1154–1173)

- Pick the speed array by `(intra|inter, ccMin)`: SM100 / SM90 / default (`constants/nccl.ts getSpeedArrays`).
- Non-RING patterns with >1 device inflate the target: `totalBw *= ndevs/(ndevs-1)` (trees have N-1 edges, not N).
- Advance the start index while `speed > maxBw` **or** `speed·minChannels > totalBw`.
- Initialise `bwIntra = bwInter = speedArray[speedIndex]`, `sameChannels = 1` (NVLS starts `0`).

### L2.2 — The relaxation cascade (pass 1) — **the ordered heart of the search** (search.cc:1197–1246)

At each speed, NCCL loosens exactly one constraint at a time, **in this order**, retrying the
search after each; it stops the moment a valid graph is found (`goto search`):

| Order | Relaxation | Condition / exception | search.cc |
|-------|-----------|-----------------------|-----------|
| 1 | `sameChannels 1 → 0` | *skip* if AMD-x86 CPU **and** `typeIntra == PATH_SYS` | 1206 |
| 2 | `BALANCED_TREE → TREE` | only `ccMin ≥ 90` | 1217 |
| 3 | `typeIntra += 1` | while `< maxTypeIntra` and `< PATH_DIS` | 1224 |
| 4 | `typeInter += 1` | multi-node only, while `< maxTypeInter` | 1231 |
| 5 | `crossNic 0 → 2` | if `crossNic==2` permitted, RING/BALANCED_TREE | 1239 |
| 6 | **speed ↓** (next lower) | if `speedArray[i+1]/bwInter > 0.49` | 1246 |

**Optimality short-circuit** (checked every iteration, before relaxing): stop immediately if
`time == -1` (search completed without timing out) **or** `nChannels·bwInter ≥ system.totalBw`
(bandwidth saturated) — search.cc:1197–1198.

*(Engine: `search.ts ncclTopoCompute` phase-1 relaxation implements steps 1–6 in this order,
including the AMD `sameChannels` exception.)*

### L2.3 — Channel duplication, then pass 2 optimize (search.cc:1258–1287)

- **`ncclTopoDupChannels`** (1258) — double the channel count when `bwIntra ≥ 25` (with `ccMin`/`nChannels` guards).
- **Pass 2** (1267) — from the found solution, try to *raise* bandwidth (RING increases `bw`; NVLS raises
  `bwInter`; trees raise `bwIntra`, each with a `< 2×` guard).

### L2.4 — Fallback (search.cc:1293)

If no graph was found (`nChannels == 0`, non-CollNet, non-NVLS): fall back to **simple order** —
GPUs in rank order, `bwIntra = 0.1`, `typeIntra = PATH_SYS`. A last-resort ring that always exists.

---

## L3 — The per-hop GPU tiebreaker cascade — **the BGP best-path analog** (`cmpScore`, search.cc:202–211)

Inside the recursive search, when choosing *the next GPU to add to the current channel*, NCCL
scores every unused candidate and sorts by this **strict ordered comparator**. This is the
closest structural match to BGP best-path selection in the whole library:

| Order | Attribute | Win rule | Meaning | BGP-ish counterpart |
|-------|-----------|----------|---------|---------------------|
| 1 | `interBw` | **higher** | bandwidth GPU→NIC (rail) | Weight |
| 2 | `interPciBw` | **higher** | GPU's PCIe bandwidth to the NIC | Local Preference |
| 3 | `interNhops` | **lower** | hop count GPU→NIC | AS_PATH length |
| 4 | `intraBw` | **higher** | bandwidth GPU→GPU | MED |
| 5 | `intraNhops` | **lower** | hop count GPU→GPU | IGP metric |
| 6 | `startIndex` | **lower** | search start offset `(g-start) mod n` | lowest router-ID |

```c
// search.cc:200-211 — verbatim
static int cmpScore(const void* g1, const void* g2) {
  struct ncclGpuScore* s1 = ...; struct ncclGpuScore* s2 = ...; int d;
  if ((d = (s2->interBw    - s1->interBw)))    return d;  // 1. higher interBw
  if ((d = (s2->interPciBw - s1->interPciBw))) return d;  // 2. higher interPciBw
  if ((d = (s1->interNhops - s2->interNhops))) return d;  // 3. lower interNhops
  if ((d = (s2->intraBw    - s1->intraBw)))    return d;  // 4. higher intraBw
  if ((d = (s1->intraNhops - s2->intraNhops))) return d;  // 5. lower intraNhops
  return s1->startIndex - s2->startIndex;                 // 6. lower startIndex
}
```

**Critical nuance:** the `inter*` attributes (1–3) are only populated when the search is sorting
GPUs *toward a NIC* (`sortNet` set — i.e. multi-node / rail assignment, search.cc:265–275). For a
**single-node** ring the cascade collapses to **`intraBw → intraNhops → startIndex`**. So on a lone
DGX box, "best next GPU" = highest NVLink bandwidth, then fewest hops, then lowest index.

*(Engine: `constants/nccl.ts compareGpuScores` is this comparator verbatim; `search.ts scoreGpu`
computes the six fields. Conformance test: `__fidelity__/fidelity.test.ts` → "order of operations".)*

---

## L4 — Keeping the best graph (`ncclTopoCompareGraphs`, search.cc:445–461)

When the recursion finds a complete candidate graph, it replaces the incumbent by this rule:

- **NVLS:** more channels wins (up to `nGPUs`), then `nChannels · bwInter`.
- **All others:** higher `nChannels · bwIntra` wins (raw aggregate bandwidth).

*(Engine: `search.ts` keeps the best by `speed · nChannels`, equivalent for RING/TREE.)*

---

## L5 — Ring closure vs. tree derivation

**Ring closure** (`ncclTopoSearchParams`, search.cc:835–846): a single-node RING sets
`backToFirstRank = nGPUs-1` — the last GPU must connect back to the first, forming a **Hamiltonian
cycle**. Every tree pattern sets `backToFirstRank = -1` — an **open chain**, no closure.

**Trees are derived from the ring**, not searched independently for their shape:
1. `ncclTopoPreset` (connect.cc:20) lays out each channel's intra-node GPU order from the ring.
2. `ncclGetDtree` (trees.cc) builds the **double binary tree** across nodes (two complementary
   trees for overlap): even node counts mirror (`nNodes-1-rank`), odd counts shift (`(rank-1+n)%n`).
3. `ncclTopoPostset` (connect.cc:380) connects rings across nodes and **doubles** tree channels
   (each ring channel → forward chain + reverse chain).

*(Engine: `trees.ts ncclGetBtree/ncclGetDtree/buildTreeGraph`, `connect.ts setupChannels`.)*

---

## L6 — Transport setup: from graphs to queue pairs

Once the graphs are chosen and stitched, `ncclTransportP2pSetup` (transport.cc:123) establishes
the actual connections. For every channel, each rank has one **send** connector and one **recv**
connector per peer (`connIndex`, transport.cc:25-26). Intra-node peers connect over
P2P/NVLink/SHM. Inter-node peers use the network transport — for InfiniBand, each connection
creates `NCCL_IB_QPS_PER_CONNECTION` queue pairs (**default 1**, `ncclParamIbQpsPerConn`,
net_ib/connect.cc:60; both endpoints instantiate a QP and the pair is bound RTR→RTS).

The counting rule that falls out of the ring structure (L5):

> A channel ring gives every node **exactly one network send and one network recv** — one
> inter-node edge leaving each node. So for a cluster:
> `connections = nChannels × nNodes`, and `QPs = connections × qpsPerConnection`.
>
> Example — 4× DGX H100, rail-optimized, 18 channels: 18 × 4 × 1 = **72 QPs**, each pinned to
> the rail its channel rides (NIC `c % nNics`, L2 round-robin).

In a rail-optimized fabric each channel's QPs stay on one rail end-to-end (crossNic=0: a channel
enters and exits every node via the same NIC), which is what keeps inter-node traffic off the
spine. *(Engine: `qp.ts buildQPs` — MODELED; the QP state machine itself is not simulated.)*

---

## RCCL divergences summary

| Aspect | NCCL | RCCL |
|--------|------|------|
| Pre-search | XML/`NCCL_RINGS` overrides only | overrides **+ pre-computed model matching** (L2.0) |
| Model match | — | `parseChordalRing → parseA2a8P → parseRome4P2H → parse1H16P → parse4H4P → parseGIOTopos` |
| Ring reversal | — | even/odd host alternation on the ring base (`RCCL_MODEL_REVERSAL_DISABLE`) |
| Generic search | always | only on model-match miss (identical cascade to NCCL) |

Everything from **L2.1 onward is shared** — once RCCL falls through the model-match branch, it runs
the exact same speed loop, relaxation cascade (L2.2), and GPU tiebreakers (L3) as NCCL.

---

## Engine conformance

The ordering in this document is asserted by the fidelity suite
(`src/engine/__fidelity__/fidelity.test.ts` → describe **"order of operations conformance"**):
the L3 tiebreaker priority is verified field-by-field against `compareGpuScores`, and the L1 graph
order + L2 relaxation presence are verified end-to-end via `runInit` + the `DecisionLog`.

## Source citation index

| Rule | NCCL | RCCL |
|------|------|------|
| Pipeline (L0) | `init.cc:1141–1644` | same |
| Graph order (L1) | `init.cc:1174–1215` | `init.cc` (same ids) |
| Per-graph search (L2) | `graph/search.cc:1074` | `graph/search.cc:1027` |
| Model match (L2.0) | — | `graph/search.cc:1091–1110`; `graph/rome_models.cc` |
| Speed/start (L2.1) | `graph/search.cc:1154–1173` | same |
| Relaxation cascade (L2.2) | `graph/search.cc:1197–1246` | same |
| Dup + pass 2 (L2.3) | `graph/search.cc:1258–1287` | same |
| Fallback (L2.4) | `graph/search.cc:1293` | same |
| GPU tiebreakers (L3) | `graph/search.cc:200–211,253–282` | same |
| Best-graph (L4) | `graph/search.cc:445–461` | same |
| Ring closure (L5) | `graph/search.cc:835–846` | same |
| Tree derivation (L5) | `graph/trees.cc`, `graph/connect.cc:20,380` | same |
| Transport setup (L6) | `transport.cc:25-26,123`; `init.cc:1631` | same |
| QPs per connection (L6) | `transport/net_ib/connect.cc:60` | same |
