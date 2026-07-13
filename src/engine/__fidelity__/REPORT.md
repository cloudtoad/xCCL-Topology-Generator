# Fidelity Report — 2026-07-06 (updated)

## Summary
- Modules checked: 10
- Functions compared: 22
- Constants verified: 28
- Env vars audited: 35
- Divergences found: 0 (in the pre-NVLS engine)
- Missing features: 6
- Fixed since baseline: 3 critical + 6 moderate + 3 minor divergences resolved
- Implemented since baseline: **NVLS (NVLink SHARP)** — support gating, per-GPU-head
  graph, runtime CTA count, and tuning selection (2026-07-06)
- NVLS verification pass: 8 NVLS divergences found & fixed vs NCCL 2.30.7
  (see "NVLS Verification Pass" below)

> **Reference-source note (2026-07-06):** The reference source now lives locally at
> `ref/src/nccl/` (**NCCL 2.30.7**) and `ref/src/rccl/` (both shallow, gitignored).
> Caveat: this NCCL is *newer* than the original baseline, so exact line citations
> across this report/manifest have drifted a few lines — the **values** still match
> (verified for `topo.h` bandwidth constants). **NVLS has now been line-level
> re-verified** against `transport/nvls.cc`, `graph/search.cc`, and `graph/tuning.cc`
> (see "NVLS verification pass" below); the divergences it surfaced are fixed.

## Fixed Divergences (previously critical)
| Module | Item | Fix | Commit |
|--------|------|-----|--------|
| paths | domination check | Changed from pathType-based to count+bw based domination matching paths.cc:73. PathType now computed after domination check. | f166baa |
| paths | SPFA vs layered BFS | Replaced flat FIFO queue with layered BFS (currentLayer/nextLayer) matching NCCL's nodeList/nextNodeList alternation (paths.cc:52-110). | f166baa |
| paths | Intel P2P overhead | Removed from SPFA path computation. Now applied during search-phase bandwidth consumption via `effectiveCost()` in search.ts, matching NCCL's followPath (search.cc:79-91). | f166baa |

## Fixed Divergences (previously moderate)
| Module | Item | Fix | Commit |
|--------|------|-----|--------|
| paths | PXN pxnType threshold | Now reads `NCCL_PXN_C2C` env var (default=1) and uses `pxnC2c ? PATH_P2C : PATH_PXB` matching paths.cc:735. | This commit |
| topo | interSocketBw Zhaoxin handling | Added Yongfeng model check: `model === 1 ? YONGFENG_ZPI_BW : ZPI_BW` matching topo.cc:92. | This commit |
| topo | interSocketBw Intel fallback | Changed default from `SKL_QPI_BW` to `BDW_QPI_BW` matching NCCL's fallthrough default (topo.cc:95). | This commit |
| search | ncclTopoCompute starting speed | Now uses `minChannels` instead of `nGpus` for totalBw check. Added tree-adjusted `totalBw *= ngpus/(ngpus-1)` for non-RING patterns. Matches search.cc:1100-1101. | This commit |
| search | DupChannels optimization | Implemented `ncclTopoDupChannels` between Phase 1 and Phase 2. Doubles channels when bwIntra >= 25.0, with ccMin/bwIntra/nChannels guards. Matches search.cc:961-974. | This commit |
| search | sameChannels AMD exception | Now blocks `sameChannels=0` when `cpuArch==X86 && cpuVendor==AMD && typeIntra==PATH_SYS`. Matches search.cc:1131-1132. | This commit |
| trees | getBtree algorithm | Replaced heap-style tree with NCCL's alternating-leaf bit-manipulation algorithm from trees.cc:31-65. Tree shapes now match exactly. | This commit |

## Fixed Divergences (previously minor)
| Module | Item | Fix | Commit |
|--------|------|-----|--------|
| paths | classifyHop NVB check | Removed extra `toNode.type==GPU` guard to match NCCL's `node->type==GPU && path->type==PATH_NVL` (paths.cc:99). | This commit |
| paths | PXN condition 4 | Rewritten to match NCCL's positive form: `peerBw > gpuBw \|\| gpuType > PATH_PXN` (paths.cc:743). | This commit |
| topo | interSocketBw Intel fallback | Changed default from `SKL_QPI_BW` to `BDW_QPI_BW` matching NCCL (topo.cc:95). | f5cd4ea |

## Remaining Divergences

None. All decision points in the engine now match the NCCL reference source.

## Implemented Features
| NCCL Feature | Module | Notes |
|-------------|--------|-------|
| NVLS algorithm (NVLink SHARP) | `nvls.ts`, `tuning.ts`, `init.ts` | **New 2026-07-06, line-level verified vs NCCL 2.30.7.** Support gating (`nvlsSupport`: SM90+, NVSwitch fabric, all-GPU NVLink reachability, `NCCL_NVLS_ENABLE`), NVLS graph search (`computeNvlsGraph`: `NCCL_TOPO_PATTERN_NVLS`, one head channel per GPU capped at `NCCL_MAX_NVLS_ARITY`), a distinct runtime CTA count (16/24/32 by arch), and tuning selection of NVLS / NVLS_TREE (SIMPLE-only, `bwIntra·efficiency·(n-1)/n·CTAs` bandwidth, NVLink-Simple-hop latency). Visualized as a multicast star. Covered by 17 fidelity tests. Key validation: HGX A100 (6 NVSwitches but SM80) correctly rejects NVLS. |

## NVLS Verification Pass (2026-07-06)

Line-level diff of the initial NVLS implementation against the local NCCL 2.30.7
checkout. Sources: `src/transport/nvls.cc`, `src/graph/search.cc`, `src/graph/tuning.cc`,
`src/init.cc`. Divergences found and **fixed**:

| # | Divergence (initial impl → NCCL) | NCCL ref | Severity |
|---|----------------------------------|----------|----------|
| 1 | Graph channel count was bandwidth-derived & capped at 16 → NCCL: `min(NCCL_MAX_NVLS_ARITY=32, nGPUs)`, single-node forced to nGPUs ("pull evenly from all GPUs") = **8 heads** | search.cc:450,1126,1135 | critical |
| 2 | Runtime channel (CTA) count not modeled; conflated with graph count → NCCL has a **separate** count: SM90=16, SM100 single=24, SM100 multi=32 (`ncclNvlsTuning`). B200 was wrongly 16, now **24** | nvls.cc:155-213 | critical |
| 3 | NVLS bandwidth claimed "no (N-1)/N penalty" → NCCL: `bwIntra · nvlsEfficiency · (nCh-1)/nCh · CTAs`, efficiency 0.85 Hopper / 0.74 Blackwell. H100 est. 320→**238 GB/s** (matches real ~230-250) | tuning.cc:139,312 | moderate |
| 4 | NVLS latency modeled as "lowest, single hop ~6µs" → NCCL: `latency = intraLat` ≈ **25µs** NVLink Simple. NVLS wins on bandwidth, not latency. H100 6→**25µs** | tuning.cc:161,424 | moderate |
| 5 | Protocol selected freely → NVLS/NVLS_TREE are **SIMPLE-only** | tuning.cc:301 | moderate |
| 6 | `NCCL_NVLS_ENABLE` default was -2 → NCCL param default is **2** | nvls.cc:159 | minor |
| 7 | `NCCL_NVLS_NCHANNELS` override applied to graph count → NCCL applies it to the **runtime CTA** count | nvls.cc:227 | minor |
| 8 | No revoke-on-empty gate → NCCL clears `nvlsSupport` if the graph finds 0 channels | init.cc:1453 | minor |

Not modeled (out of scope, documented): the full `ncclNvlsTreeSm100Tuning` NIC-bandwidth/ppn
table, `llMaxBws`/`perChMaxNVLSTreeBws` caps, and the runtime multicast buffer setup — these are
runtime/collective concerns, not topology-graph decisions.

## Cluster / QP / Sim Layer (2026-07-06) — MODELED, with one corrected divergence

Three modules support the tutorial layer. They are **structurally grounded in source but not
line-ports**, and are labeled accordingly in the manifest:

| Module | Status | Grounding |
|--------|--------|-----------|
| `cluster.ts` (multi-node channel rings) | MODELED | search.cc:837 (`backToNet=ngpus-1`), connect.cc:106-109 (cross-node stitch), search.cc:735 (NIC round-robin) |
| `qp.ts` (queue pairs) | MODELED | transport.cc:25-26,123 (one send+recv connector per channel per node); net_ib/connect.cc:60 (`NCCL_IB_QPS_PER_CONNECTION` default 1) |
| `sim/allgather.ts` (LL128 dataflow) | PEDAGOGICAL | device.h:110-112 LL128 layout is exact; the flag word is deliberately **overloaded** with a GPU-of-origin (real NCCL uses it as a sync counter) |

**Corrected divergence (caught in review, fixed same day):** the first cluster model built 8
standalone "rail rings" (same-index GPUs across servers) and multiplied them by the channel
count, yielding 576 QPs for 4× DGX H100. Real NCCL builds **one ring per channel spanning all
GPUs** — intra chain through every GPU per node, then a rail-aligned NIC exit (search.cc:837) —
so a channel owns exactly `nNodes` inter-node edges and the true count is
`nChannels × nNodes × qpsPerConn` = 18 × 4 × 1 = **72 QPs**. The per-rail view survives as an
explicit lens (`railLens`) over where the hops land, clearly labeled a view, not the rings.

## Golden Anchors (2026-07-06) — validation against public real-world data

With no private `NCCL_DEBUG` dump available, public data was hunted. Best source:
**NVIDIA/nccl issue #1197** — an H100-class NVSwitch system (NCCL 2.19.4) with verbatim
GRAPH dumps. Cross-checked against 2.30.7 source. This pass found and fixed **3 more
divergences** (`golden.test.ts` pins all of them):

| # | Divergence (was → now) | Anchor | Severity |
|---|------------------------|--------|----------|
| 9 | GraphPattern IDs were RING=0…NVLS=6 → real NCCL: **BALANCED_TREE=1, SPLIT_TREE=2, TREE=3, RING=4, NVLS=5, COLLNET_DIRECT=6** (there is no CollNet-chain pattern — chain rides TREE). IDs appear verbatim in GRAPH logs ("Pattern 4…"), so they must match to correlate with real dumps. | graph.h:160-169; #1197 log lines | moderate |
| 10 | NVSwitch link bw was bare `nvlBw` per GPU↔switch (82.4 GB/s aggregate on H100) → NCCL aggregates the NVLink **count**: `bw = count × nvlBw` (18 × 20.6 = **370.8**, spread 92.7/switch). #1197's topology dump shows GPU↔NVS **360.0** (2.19-era nvlBw 20.0 × 18). | topo.cc:856; #1197 topo dump | **critical** |
| 11 | NVLS per-head speed and busBw: speed now = table entry ≤ aggregate/nHeads (370.8/8 = 46.35 → **40**, exactly #1197's "Pattern 5 … bw 40.000000"); busBw multiplier corrected to **graph heads** (not runtime CTAs) with the **×2 AllReduce pipelining factor**: 8 × 40 × 0.85 × 7/8 × 2 = **476 GB/s** ≈ real H100 NVLS AllReduce (~480). | tuning.cc:306-325; #1197; ncclTopoSearchTryNvls | **critical** |

Anchor table (our engine after fixes vs. public data):

| Quantity | Ours (2.30.7 constants) | #1197 dump (2.19.4) | Match |
|----------|------------------------|---------------------|-------|
| GPU↔NVS aggregate | 370.8 (18×20.6) | 360.0 (18×20.0) | YES (era constant) |
| NVLS graph channels | 8 (= nGPUs) | 8 | YES |
| NVLS bwIntra | 40 | 40 | YES |
| Pattern IDs in logs | 1/2/3/4/5/6 | Pattern 1=Tree, 4=Ring, 5=NVLS | YES |
| NVLS AllReduce busBw | 476 GB/s | (real-world ≈480) | YES (≈) |

### Fingerprint hunt round 2 (2026-07-06) — two more divergences found & fixed

Searching the web for *source-derived literal strings* (`"=== System : maxBw"`, the
ncclTopoPrintGraph grammar) surfaced **ROCm/rccl#1210** — a real 4× MI300X printing
`=== System : maxBw 48.0 totalBw 144.0 ===`. Cross-examining that line against
`ncclTopoSearchInit` (search.cc:14-53) exposed:

| # | Divergence (was → now) | Anchor | Severity |
|---|------------------------|--------|----------|
| 12 | `system.totalBw` was the **sum of every link in the system** (~3,714 for one DGX H100) → NCCL: **per-GPU injection ceiling**, max over GPUs of `max(pciBw, Σ nvlinkBw)` (H100: 370.8; 4×MI300X: 3×48 = 144 — reproduced exactly). `maxBw` similarly = best *path*, not best link. totalBw drives the starting-speed index and the optimality short-circuit `nChannels·bw ≥ totalBw`, which could **never fire** with the inflated value — forcing every search into full relaxation grind. | search.cc:14-53; ROCm/rccl#1210 | **critical** |
| 13 | Phase-1 kept **any** valid solution, overwriting better ones found at higher speeds → NCCL keeps-if-better on `nChannels × bwIntra` (`ncclTopoCompareGraphs`, search.cc:445-461 — our own documented L4, previously un-implemented in the outer loop). | search.cc:445-461 | **critical** |

**Result:** the H100 ring search now converges to `Pattern 4, crossNic 0, nChannels 12,
bw 30.000000/…` — **the exact intra ring line from NVIDIA/nccl#1197's real machine** (their
bwInter=30 is 2-node; ours is single-node). Tree pre-doubling = 12 @ 30, also matching.
Aggregates saturate ≥95% of the per-GPU ceiling (H100: 360/370.8, B200: 720/721.8).
Pinned in `golden.test.ts` "[G1] ring search reproduces the #1197 GRAPH line" and
"[G3] maxBw/totalBw semantics".

### Walkthrough instrumentation pass (2026-07-07) — two more fixed, one closed

Instrumenting the search for the Build walkthrough forced a close read of bandwidth
consumption and found:

| # | Divergence (was → now) | Anchor | Severity |
|---|------------------------|--------|----------|
| 14 | Fresh ring searches consumed bandwidth **twice** (during recursion AND via consumeRingBandwidth after) → recursion consumption is kept on success, only the closure edge is charged after (followPath keeps its consumption) | search.cc:79-91 | **critical** (was masking #15) |
| 15 | Bandwidth budgets were per GPU-*pair* path → NCCL's followPath consumes on the **shared physical links** along the path; and the NVSwitch fabric is modeled as **one logical NVS node** at the full count×nvlBw aggregate — exactly how #1197's dump presents it (single NVS/0 @ 360) | search.cc:79-91; topo.cc:856; #1197 topo dump | **critical** |

The two bugs had been *cancelling* into the right answer: removing #14 alone overshot
(12ch@40 = 480 > 370.8 ceiling), fixing per-pair alone undershot (paths funneled into one
of 4 switches). With both corrected — shared-link consumption over a single aggregated
NVS — the H100 search lands on `Pattern 4 … nChannels 12, bw 30.000000` **again, now via
the true mechanism** (6 rings @ 60 → DupChannels → 12 @ 30, 97% saturation; B200 16@45,
99.75%). The ring build trace (`ring-build-trace.ts`) replays the accepted search
deterministically and is test-pinned to reproduce the final channel orders exactly.

### The 2-node experiment (2026-07-07) — RecNet implemented and validated

`network.ts` (rail-paired NET nodes, NICx↔NICx) + `searchForChannelsInter` in search.ts
implement the inter-node ring search strictly per RecNet (search.cc:726-812): NIC rotation
`nets[(ch+i)%netCount]`, NET budget skip (:745), sameChannels replay-first (:776-780),
local-GPU entry (:791-803), typed exit, crossNic fallback, mid-ring far-from-net candidate
reversal. Run on a 2-node DGX H100 model, the strict order of operations produced —
unprompted — every behavior predicted from reading the source:

| Prediction (from the RecNet discussion) | Outcome |
|------------------------------------------|---------|
| All NICs fill (no bandwidth on the table) | 8 channels, one per rail — PCIe (20 GB/s model) feeds exactly one 20 GB/s channel per NIC |
| Channels enter at their rail's local GPU | ch0@net-0 enters GPU0, ch1@net-1 enters GPU1, … |
| Replay through rotated NICs fails → sameChannels sacrificed | confirmed in trace: sameChannels→0 fired; accepted solution has 8 **different** ring orders |
| Rings weird for structural reasons | e.g. `net-0 → [0 7 6 5 4 3 1 2] → net-0`: entry = rail GPU, middle = far-from-net GPUs (sortNet=-1 reversal), exit = the *other* PIX-local GPU saved for last |

Pinned in `inter-search.test.ts` (5 tests). Honest deltas vs #1197's 2-node line
(`12ch, bw 30/30, sameChannels 1`): their VM-flattened topology permits higher GPU↔NET bw
(30 > our PCIe-20 model ceiling) and replay through rotated NICs (flat paths type-equal) —
ours models the strict DGX-style per-rail locality. Also closes open item (a) partially:
speedInter now meaningful (= accepted channel speed); the NVLS pass-2 bwInter raise remains.

**Still open:** (a) NVLS `bwInter` pass-2 raise (dump shows 40/60; we set
speedInter=speedIntra) — lands with inter-node search pass-2 refinement; (b) RCCL:
`ref/src/rccl/tools/topo_expl/models/` ships **60 captured machine topologies** (Rome 4P2H,
MI200 8p6l, MI300X "942" …) — ready-made golden *inputs* for the RCCL side.

### Log replay (2026-07-06) — logs as witnesses, source as the constraint system

`src/engine/log-replay.ts` (+ 10 tests) parses and emits NCCL's exact GRAPH line format
(`ncclTopoPrintGraph`, search.cc:1319-1321; path-type strings topo.cc:34), so any real dump
line can be cross-examined against the source's conditionals, and our engine's graphs can be
diffed line-for-line against real dumps (`runInit` now emits a "GRAPH dump (NCCL log format)"
DecisionLog entry). Cross-examining the #1197 lines yielded:

| Finding | Detail |
|---------|--------|
| Field order pinned | `bw %f/%f` = **bwIntra first** (search.cc:1319). Trap: the disabled debug printf at search.cc:1186 prints bwInter first. |
| New divergence flagged | #1197's NVLS line reads `bw 40/60` — **bwInter (60) > bwIntra (40)**: pass-2 raises NVLS `bwInter` independently (search.cc:1274). Our engine sets `speedInter = speedIntra`; correct modeling belongs to the not-yet-implemented inter-node search. |
| Hardware fact recovered | Ring line: 12 ch × 30 GB/s = 360 GB/s inter per node per direction ⇒ with 400G (50 GB/s) NICs the machine must have **≥ 8 NICs** — refuting the 4-NIC reading of that issue's topology. |
| Conditionals pinned | Ring/tree lines show `sameChannels 1, type NVL/PIX, crossNic 0` ⇒ the relaxation cascade fired **zero** steps at the final speed. The NVLS line's `sameChannels 0` is the NVLS *starting* state (`trySameChannels = pattern==NVLS ? 0 : 1`, search.cc:1105), not a relaxation. |

### #17 — Phase-2 (pass 2) semantics (2026-07-13, found by the L2 atlas audit) — FIXED

| # | Divergence (was → now) | NCCL ref | Severity |
|---|------------------------|----------|----------|
| 17 | Phase 2 gated on `bestResult.time !== -1` (ran **only after a timeout** — i.e. almost never), forced `sameChannels=0`, kept the env `minChannels`, and climbed from where phase 1 *ended* → real pass 2 runs whenever budget remains (`time != 0`), starts **from the accepted solution** (its sameChannels/pattern/crossNic), **locks `minChannels = graph->nChannels`** (post-dup), re-derives the climb start from the post-dup speed, and applies the three-way pattern branch (RING raises bwIntra+bwInter; NVLS raises bwInter only, channels locked; tree-family raises bwIntra only) | search.cc:1255-1283 | **moderate** (behavior-inert on all anchors — climb attempts fail under the channel lock — but structurally wrong and it silenced pass 2 on clean solutions) |

Model note: our engine searches with a single speed (`speedIntra == speedInter`), so the
RING arm is exact while the NVLS/tree arms are structurally present but degenerate until
two-speed search lands (tracked with the NVLS `bwInter` 40/60 open item). Also fixed in
the same pass: the construction replay now uses the **accepted** `crossNic` rather than
the initial env value. Trace gained `attempt` / `accepted` / `improve` events — the full
ladder (rung chain, accepted params, attempt boundaries, climb) is now reconstructible
from the trace alone (`trace-reconstruction.test.ts`, 5 tests). Anchors verified intact:
H100 12ch@30 (#1197), 2-node 8ch@20×8 rails, MI300X goldens. Teaching fact surfaced by
the fix: the 2-node solution enters the ladder AT its ceiling (maxBw on the NET-attached
view = 20), so pass 2 has no headroom there — while single-server H100 climbs 40/50/60
and correctly fails each rung under the 12-channel lock.

## Missing Features
| NCCL Feature | Source Location | Priority | Notes |
|-------------|----------------|----------|-------|
| CollNet Direct/Chain | search.cc:350-384, connect.cc:176-239 | Medium | Collective network offload not implemented. Important for InfiniBand Sharp-capable networks. |
| PAT algorithm | tuning.cc:201-209 | Medium | Parallel Alltoall Trees not implemented. SM60+ feature for ReduceScatter/AllGather. |
| GDR checks | paths.cc:418-485 | Medium | GPU Direct RDMA feasibility checks not modeled. Affects NIC-GPU path selection in multi-node setups. |
| P2P transport checks | paths.cc:270-388 | Low | NVML-based P2P validation not modeled. Simulator assumes all P2P paths work. |
| Split NVLink detection | paths.cc:971-1002 | Low | `ncclTopoSplitNvLink` not implemented. Affects minimum channel count on dual-socket NVLink systems. |
| mergePathType P2C | paths.cc:178-183 | Low | `PATH_P2C = max(PATH_PHB, PATH_C2C)` merge not implemented. C2C path handling incomplete. |

## Constants Verification
| Constant | Our Value | NCCL Value | Match |
|----------|-----------|------------|-------|
| LOC_BW | 5000.0 | 5000.0 | YES |
| SM60_NVLINK_BW | 18.0 | 18.0 | YES |
| SM70_NVLINK_BW | 20.0 | 20.0 | YES |
| SM80_NVLINK_BW | 20.0 | 20.0 | YES |
| SM90_NVLINK_BW | 20.6 | 20.6 | YES |
| SM86_NVLINK_BW | 12.0 | 12.0 | YES |
| SM100_NVLINK_BW | 40.1 | 40.1 | YES |
| PCI_BW | 12.0 | 12.0 | YES |
| AMD_BW | 16.0 | 16.0 | YES |
| BDW_QPI_BW | 6.0 | 6.0 | YES |
| SKL_QPI_BW | 10.0 | 10.0 | YES |
| SRP_QPI_BW | 22.0 | 22.0 | YES |
| ERP_QPI_BW | 40.0 | 40.0 | YES |
| ZPI_BW | 6.0 | 6.0 | YES |
| YONGFENG_ZPI_BW | 9.0 | 9.0 | YES |
| P9_BW | 32.0 | 32.0 | YES |
| ARM_BW | 6.0 | 6.0 | YES |
| NET_BW | 12.0 | 12.0 | YES |
| INTEL_P2P_OVERHEAD | bw * 6/5 | bw*6/5 | YES |
| MAXCHANNELS | 64 | 64 | YES |
| NCCL_MAX_TREE_ARITY_TOP | 2 | 2 | YES |
| NCCL_MAX_TREE_ARITY | 3 | 3 | YES |
| SEARCH_GLOBAL_TIMEOUT | 524288 (1<<19) | 1<<19 | YES |
| SEARCH_TIMEOUT | 16384 (1<<14) | 1<<14 | YES |
| SEARCH_TIMEOUT_TREE | 16384 (1<<14) | 1<<14 | YES |
| SEARCH_TIMEOUT_SAMECHANNELS | 256 (1<<8) | 1<<8 | YES |
| speedArrayIntra | [40,30,20,18,15,12,10,9,7,6,5,4,3] | [40.0,30.0,20.0,18.0,15.0,12.0,10.0,9.0,7.0,6.0,5.0,4.0,3.0] | YES |
| speedArrayInter | [48,30,28,24,20,18,15,12,10,9,7,6,5,4,3,2.4,1.2,0.24,0.12] | [48.0,30.0,28.0,24.0,20.0,18.0,15.0,12.0,10.0,9.0,7.0,6.0,5.0,4.0,3.0,2.4,1.2,0.24,0.12] | YES |

## Env Var Coverage
| Var | Default OK | Implemented | UI Knob | Notes |
|-----|-----------|-------------|---------|-------|
| NCCL_NVB_DISABLE | YES (0) | YES | - | Used in spfaFromSource GPU passthrough guard |
| NCCL_PXN_DISABLE | YES (0) | YES | Toolbar toggle | Used in applyPxnPaths |
| NCCL_PXN_C2C | YES (1) | YES | - | Used in applyPxnPaths to set PXN threshold (P2C vs PXB) |
| NCCL_CROSS_NIC | YES (2) | YES | - | Used in ncclTopoCompute relaxation |
| NCCL_MIN_NCHANNELS | YES (-2) | YES | - | Used in init.ts channel bounds |
| NCCL_MAX_NCHANNELS | YES (-2) | YES | - | Used in init.ts channel bounds |
| NCCL_ALGO | YES (-2) | YES | - | Forces algorithm in selectAlgorithm |
| NCCL_PROTO | YES (-2) | YES | - | Forces protocol in selectAlgorithm |
| NCCL_NTHREADS | YES (-2) | YES | - | Forces thread count in computeThreadCount |
| NCCL_TOPO_FILE | N/A | NO | - | Not applicable to config-driven simulator |
| NCCL_GRAPH_FILE | N/A | NO | - | Not applicable to simulator |
| NCCL_TOPO_DUMP_FILE | N/A | NO | - | Could add as export feature |
| NCCL_GRAPH_DUMP_FILE | N/A | NO | - | Could add as export feature |
| NCCL_IGNORE_DISABLED_P2P | N/A | NO | - | Simulator always has full P2P |
| NCCL_NET_DISABLE_INTRA | YES (0) | NO | - | Intra-node net disable not modeled |
| NCCL_MIN_P2P_NCHANNELS | YES (1) | NO | - | P2P channel count not modeled |
| NCCL_MAX_P2P_NCHANNELS | YES (64) | NO | - | P2P channel count not modeled |
| NCCL_NVLS_NCHANNELS | YES (-2) | YES | - | Overrides NVLS channel count in computeNvlsGraph |
| NCCL_P2P_LEVEL | N/A | NO | - | P2P threshold not modeled |
| NCCL_P2P_DISABLE | N/A | NO | - | P2P transport disable not modeled |
| NCCL_SHM_DISABLE | N/A | NO | - | SHM transport disable not modeled |
| NCCL_P2P_PER_CHANNEL_NET_BW | YES (14) | NO | - | Per-channel net BW not modeled |
| NCCL_NET_GDR_LEVEL | N/A | NO | - | GDR distance not modeled |
| NCCL_NET_GDR_READ | N/A | NO | - | GDR read not modeled |
| NCCL_NET_GDR_C2C | YES (1) | NO | - | GDR C2C not modeled |
| NCCL_NET_FORCE_FLUSH | YES (0) | NO | - | Hopper flush not modeled |
| NCCL_IB_DISABLE | N/A | NO | - | Not applicable to simulator |
| NCCL_SOCKET_IFNAME | N/A | NO | - | Not applicable to simulator |
| NCCL_COLLNET_ENABLE | N/A | NO | - | CollNet not implemented |
| NCCL_NVLS_ENABLE | YES (-2) | YES | NVLS view button | Gates NVLS in nvlsSupport (0=off, 1/-2=on if HW supports) |
| NCCL_MNNVL_SCATTER_NETS_ENABLE | YES (1) | NO | - | MNNVL scatter not implemented |
| NCCL_MNNVL_RAIL_PER_HOST | YES (0) | NO | - | MNNVL rail per host not implemented |
| NCCL_P2P_PXN_LEVEL | YES (2) | NO | - | PXN level for P2P not modeled |
| NCCL_BUFFSIZE | N/A | NO | - | Buffer size not modeled |
| NCCL_THREAD_THRESHOLDS | N/A | NO | - | Thread threshold override not modeled |
| RCCL_MODEL_MATCHING_DISABLE | YES (0) | YES | - | Implemented in matchRomeModel |
| RCCL_MODEL_REVERSAL_DISABLE | YES (0) | YES | - | Implemented in Rome ring parsing |

## Module-by-Module Analysis

### paths (paths.ts <-> paths.cc)

**classifyHop** (paths.ts:94-151 <-> paths.cc:91-101)

The hop classification logic follows the same priority cascade as NCCL:

1. NET links -> LOC (line 105 vs ref line 93): MATCH
2. PCI->PCI -> PXB (line 108 vs ref line 95): MATCH
3. PCI touching CPU -> PHB (line 113 vs ref line 97): MATCH
4. NVLink bounce -> NVB (line 124 vs ref line 99): MATCH. Checks `node.type==GPU && path.type==NVL && link.type==NVL && count>1`.
5. Default link-to-path mapping (lines 127-146 vs ref lines 92-101): MATCH
6. max(pathSoFar, hopType) (line 150 vs ref line 101): MATCH

NVB detection now matches NCCL exactly: `fromNode.type == GPU && pathSoFar == NVL && linkType == NVL && hopCount > 1` (paths.cc:99).

**spfaFromSource** (paths.ts:172-293 <-> paths.cc:36-113)

- Source initialization (lines 184-186 vs ref lines 48-50): PathType.LOC, bw=LOC_BW(5000), count=0. MATCH.

- GPU passthrough guard (lines 209-221 vs ref lines 69-71): MATCH. Both check `nvbDisabled || link.type != NVL || remNode.type != GPU || path.count > 1`.

- Domination check (lines 230-242 vs ref line 73): MATCH. Uses count+bw based domination: `(existing.bw == 0 || existing.count > current.count) && existing.bw < newBw`. PathType computed after domination check.

- BFS structure (lines 192-279): MATCH. Uses layered BFS (currentLayer/nextLayer) matching NCCL's nodeList/nextNodeList alternation (paths.cc:52-110).

- Intel P2P overhead: Not applied here. Applied during search-phase bandwidth consumption via `effectiveCost()` in search.ts, matching NCCL's followPath (search.cc:79-91).

**applyPxnPaths** (paths.ts:303-414 <-> paths.cc:725-749)

The overall PXN logic matches:
1. Check PXN_DISABLE (line 310 vs ref line 592/728): MATCH
2. Find localGpu for each NIC (lines 328-344 vs ref line 730): MATCH
3. Condition: peer connected to NIC with pxnType or better (line 359 vs ref lines 735-737): MATCH. Now uses `pxnType = pxnC2c ? PATH_P2C : PATH_PXB` from NCCL_PXN_C2C env var.
4. Condition: NVLink to GPU (line 364 vs ref lines 738-739): MATCH
5. Condition: same node (line 366 vs ref lines 740-741): MATCH (always true for single-server)
6. Condition: better BW or worse path type (lines 369-374 vs ref lines 742-743): MATCH (logically equivalent)

**computeAllPaths** (paths.ts:427-591 <-> paths.cc:645-760)

- Source types: We run SPFA from GPUs and NICs (lines 462-464). NCCL runs `ncclTopoSetPaths` from CPUs, GPUs, NICs, AND NVSwitches (lines 652-668). **Moderate omission**: We skip CPU and NVSwitch sources. This is acceptable because we only store and use GPU-GPU, GPU-NIC, and NIC-GPU paths. However, NCCL's CPU paths are used for the `addInterStep` function which routes through CPUs.

- Self-path (lines 492-502 vs ref lines 48-50): MATCH -- LOC with infinite bandwidth.

**trimSystem** (paths.ts:604-735)

Our implementation uses BFS from GPUs to find reachable nodes and removes unreachable ones. NCCL's `ncclTopoTrimSystem` (paths.cc:773-816) uses domain-based GPU grouping with `PATH_NET` as the boundary. The approaches produce the same result for single-node topologies. For multi-node, NCCL removes GPUs in different "domains" while we remove graph-unreachable nodes.

### topo (topo.ts <-> topo.cc)

**buildTopoSystem** (topo.ts:104-431)

This is a config-driven replacement for `ncclTopoGetSystem` which probes hardware. Since it generates topology from configuration rather than reading it, the comparison is about whether the generated graph structure matches what NCCL would discover for equivalent hardware.

- NVSwitch topology (lines 212-231): Creates bidirectional NVL links between every GPU and every NVSwitch. MATCH with NCCL's NVSwitch detection.
- xGMI mesh (lines 242-256): Full mesh GPU-GPU NVL links. MATCH with RCCL's xGMI handling.
- NVLink mesh (lines 266-279): Full mesh with `nvlinksPerPair` scaling. MATCH.
- GPU-PCI-CPU routing (lines 303-327): Correctly routes through PCIe switches. MATCH.
- NIC-PCI-CPU routing (lines 335-360): Rail-optimized NIC placement. MATCH.
- CPU-CPU links (lines 365-376): SYS links between CPUs. MATCH.

**pcieBandwidth** (topo.ts:42-44)

Formula: `PCI_BW * (gen/3) * (width/16)`. Matches NCCL's `PCI_WIDTH*PCI_SPEED(gen)` scaling approach.

**interSocketBw** (topo.ts:47-63 <-> topo.cc:71-95)

- POWER -> P9_BW (32.0): MATCH
- ARM -> ARM_BW (6.0): MATCH
- AMD -> AMD_BW (16.0): MATCH
- Zhaoxin -> Yongfeng=YONGFENG_ZPI_BW (9.0), else ZPI_BW (6.0): MATCH. Now checks `model === 1` for Yongfeng variant.
- Intel BDW/SKL/SRP/ERP: MATCH. Default fallback for unknown Intel model is `BDW_QPI_BW` (6.0), matching NCCL.

### search (search.ts <-> search.cc)

**ncclTopoCompute** (search.ts:501-891 <-> search.cc:1014-1238)

- crossNic parameter (line 515 vs ref line 15): Default=2 (auto). MATCH.
- Speed array selection (lines 538-539 vs ref lines 976-989, 1089-1094): MATCH. Correct arrays for default/SM90/SM100, intra/inter.
- Starting speed index (lines 607-615 vs ref lines 1096-1101): MATCH. Uses `minChannels` for totalBw check. Tree patterns adjust `totalBw *= ngpus/(ngpus-1)`.
- Phase 1 relaxation cascade (lines 660-840 vs ref lines 1108-1190): MATCH. Relaxation order: sameChannels -> pattern -> typeIntra -> typeInter -> crossNic -> speed decrease. AMD sameChannels exception implemented (search.cc:1131-1132).
- DupChannels (lines 850-900 vs search.cc:961-974): MATCH. Doubles channels when bwIntra >= 25.0, with ccMin/bwIntra/nChannels guards.
- Phase 2 optimization (lines 900-960 vs ref lines 1192-1230): MATCH -- tries increasing speeds after finding a valid solution.

**searchRingRec** (search.ts:222-319 <-> search.cc:335-500, 576-667)

- Timeout check (line 236 vs ref lines 315-318, 577-578): MATCH values.
- Ring closure (lines 242-251): MATCH -- checks both path existence and bandwidth availability.
- GPU scoring (lines 254-281 vs ref lines 191-210): MATCH -- same 6-field priority ordering.
- Bandwidth consumption (lines 290-291): Our approach tracks remaining BW in a Map. NCCL mutates link->bw directly and restores on backtrack. Functionally equivalent.

**searchForChannels** (search.ts:349-434 <-> search.cc:850-970)

- Single GPU trivial (lines 362-373): MATCH.
- Timeout selection (lines 375-380 vs ref lines 315-318): MATCH.
- Reuse ring (lines 393-395): MATCH -- sameChannels=1 reuses first ring ordering.

### trees (trees.ts <-> trees.cc)

**getBtree** (trees.ts:28-53 <-> trees.cc:31-65)

MATCH. Now uses NCCL's alternating-leaf bit-manipulation algorithm from trees.cc:31-65. Tree shapes match exactly for all rank counts. Verified against NCCL diagram (trees.cc:11-30) for 4, 8, and 14 ranks.

**ncclGetDtree** (trees.ts:62-92 <-> trees.cc:88-109)

- Even nRanks mirror (lines 73-80 vs ref lines 100-106): MATCH. Mirror rank = nRanks-1-rank.
- Odd nRanks shift (lines 81-89 vs ref lines 92-99): MATCH. Shift rank = (rank-1+nRanks) % nRanks.

Note: Both trees use the divergent getBtree as their base, so the same structural difference propagates.

### rings (rings.ts <-> rings.cc)

**setupRings** (rings.ts:23-106 <-> rings.cc:28-70)

- Circular prev/next (lines 56-63): MATCH. `next[i] = order[(i+1)%len]`, `prev[i] = order[(i-1+len)%len]`.
- NCCL's `ncclBuildRings` also validates that rings form complete Hamiltonian cycles. Our implementation trusts the search result without validation. This is a robustness difference, not a correctness issue.

### connect (connect.ts <-> connect.cc)

**setupChannels** (connect.ts:53-187 <-> connect.cc:19-92, 374-522)

- Ring finalization (lines 74-99): MATCH -- prev/next maps from ring ordering.
- Tree doubling (lines 121-147): Each ring channel produces 2 tree channels (forward + reverse chain). In NCCL, `ncclTopoPreset` sets up tree up/down from the intra-node ordering (connect.cc:52-61), then `ncclTopoPostset` duplicates channels (`memcpy(channel1, channel0, nChannels*sizeof(struct ncclChannel))` at line 72). The tree structure is `up = treeIntra[i-1]`, `down[0] = treeIntra[i+1]` -- which is a chain, matching our approach.
- Reverse chain (line 136-137): MATCH -- Tree 1 uses reversed ring order.

### tuning (tuning.ts <-> tuning.cc)

**selectAlgorithm** (tuning.ts:316-393)

Our tuning is a heavily simplified heuristic compared to NCCL's detailed model in `ncclTopoTuneModel`. NCCL computes per-collective, per-algorithm, per-protocol bandwidth/latency tables using hardware-specific constants, then selects the best combination at runtime via `ncclTopoGetAlgoTime`. Our approach uses fixed message-size thresholds.

- Forced NCCL_ALGO/NCCL_PROTO (lines 335-336): MATCH behavior.
- Our simplified heuristic is intentionally approximate. The tuning is a UI/educational feature, not meant for production accuracy.

**selectProtocol** (tuning.ts:65-130)

- Small msg LL (line 84, threshold 4KB): NCCL's LL threshold is message-size and collective dependent; our fixed 4KB is a reasonable approximation.
- Medium msg LL128 (line 97, threshold 512KB with NVLink): NCCL enables LL128 based on NVLink presence AND compute capability AND path type. Our check is simpler.
- Large msg SIMPLE (line 121): MATCH concept.

**selectAlgo** (tuning.ts:139-221)

- nRanks > 8 -> RING (line 187): Simplified heuristic, not in NCCL. NCCL uses bandwidth/latency model.
- messageSize > 512KB -> RING (line 199): Simplified heuristic.
- Small/medium + <=8 ranks -> TREE (line 219): Simplified heuristic.

The tuning module is intentionally simplified for the simulator UI. NCCL's full tuning model spans hundreds of lines with per-collective, per-GPU-generation, per-node-count tables.

**selectAlgo — NVLS branch** (tuning.ts)

When a supported NVLS graph is present and the message exceeds the small-message threshold, tuning selects `NVLS` (single node) or `NVLS_TREE` (multi-node) ahead of ring/tree, forcing the **SIMPLE** protocol (tuning.cc:301). Bus bandwidth follows NCCL's formula `bwIntra · nvlsEfficiency · (nHeads-1)/nHeads · runtimeCTAs` (efficiency 0.85 Hopper / 0.74 Blackwell, tuning.cc:139,312) — there **is** an `(n-1)/n` factor; NVLS is not penalty-free. Latency is the NVLink Simple hop (~25µs, tuning.cc:424) — NVLS is a **bandwidth** win, not a latency win. The full ratio/`llMaxBws` cost model is not replicated (tuning remains an educational estimate), but the NVLS-specific constants and factors are now source-exact.

### nvls (nvls.ts <-> transport/nvls.cc, graph/search.cc NVLS pattern, init.cc) — line-verified vs NCCL 2.30.7

**nvlsSupport** (nvls.ts) — gates NVLS on NCCL's preconditions (`ncclNvlsInit` nvls.cc + `ncclTopoCompute` search.cc:1124):

1. `NCCL_NVLS_ENABLE` (default **2**): `0` disables, `1` forces, `2` auto; requires `gpuCount >= 2` (nvls.cc:244).
2. Compute capability `>= 90` (Hopper) — rejected **even when an NVSwitch is present** (validated: HGX A100 has 6 NVSwitches but SM80) (search.cc:1124).
3. An NVSwitch fabric must exist and every GPU must reach a switch over `PATH_NVL` (search.cc:1124).
4. Support is revoked if the NVLS graph search yields 0 channels (init.cc:1453).

**computeNvlsGraph** (nvls.ts) — the NVLS graph is a multicast star with **one head channel per GPU**:

- Pattern `NCCL_TOPO_PATTERN_NVLS` (6); `typeIntra = NVL`.
- `nChannels = min(NCCL_MAX_NVLS_ARITY=32, nGPUs)`; single-node forces `minChannels=maxChannels` ("pull evenly from all GPUs") → exactly nGPUs heads (search.cc:450,1126,1135). **MATCH.**
- Per-head bwIntra = highest compute-cap speed-table entry ≤ GPU→switch NVLink BW. **MATCH** (same table as ring/tree).
- Head `c` anchors on switch `c % nSwitches`.

**nvlsRuntimeChannels** (constants/nccl.ts) — the **runtime CTA count**, distinct from the graph head count: SM90=16, SM100 single-node=24, SM100 multi-node=32, overridable by `NCCL_NVLS_NCHANNELS` (`ncclNvlsTuning`, nvls.cc:155-213). **MATCH.**

### init (init.ts <-> init.cc)

**runInit** (init.ts:56-388)

Pipeline order matches NCCL:
1. buildTopo (line 97 vs init.cc:1030): MATCH
2. computePaths first pass (line 150 vs init.cc:1042): MATCH
3. trimSystem (line 162 vs init.cc:1048): MATCH
4. recomputePaths (line 174 vs init.cc:1055): MATCH
5. RCCL model match (lines 208-245): MATCH -- try before search
6. Ring search (line 354, `maxChannels/2`): MATCH
7. Tree search + construction (lines 262-276): MATCH
8. Setup rings (line 297): MATCH
9. Setup channels (line 309): MATCH
10. NVLS support check + graph (new): computes `nvlsSupport` then `computeNvlsGraph` when supported
11. Tuning (new): representative 128 MB all-reduce algorithm/protocol selection via `selectAlgorithm`

Channel bounds (lines 181-188 vs connect.cc:322-353): MATCH -- uses NCCL_MIN_NCHANNELS and NCCL_MAX_NCHANNELS with clamping.

### rccl_rome_match (rome-match.ts <-> rome_models.cc)

The Rome model matching follows the same approach:
1. Extract topology properties (nGpus, nCpus, nNics, nLinks, connMatrix, pattern)
2. Iterate models, check basic property match
3. Attempt GPU permutation matching
4. Attempt NIC permutation matching
5. Parse pre-computed ring orderings

RCCL_MODEL_MATCHING_DISABLE and RCCL_MODEL_REVERSAL_DISABLE are both implemented. The 46 pre-computed models are present.
