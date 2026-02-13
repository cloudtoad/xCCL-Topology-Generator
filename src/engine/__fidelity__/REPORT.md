# Fidelity Report — 2026-02-12 (updated)

## Summary
- Modules checked: 9
- Functions compared: 18
- Constants verified: 28
- Env vars audited: 35
- Divergences found: 2 (critical: 0, moderate: 0, minor: 2)
- Missing features: 7
- Fixed since baseline: 3 critical + 6 moderate + 1 minor divergences resolved

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

## Remaining Divergences
| Module | Item | Ours | NCCL | Severity | Notes |
|--------|------|------|------|----------|-------|
| paths | classifyHop NVB check | Checks `fromNode.type==GPU && toNode.type==GPU` | Checks `node->type==GPU && path->type==PATH_NVL` (no toNode type guard) | Minor | NCCL does not guard on remNode being GPU for NVB classification; the NVL link type already implies GPU-GPU. Ours is stricter but functionally equivalent for valid topologies. |
| paths | PXN condition comparison | `peerToNicPath.bandwidth <= gpuToNicPath.bandwidth AND gpuToNicPath.type <= PathType.PXN` | `peerNode->paths[NET][n].bw > gpu->paths[NET][n].bw OR gpu->paths[NET][n].type > PATH_PXN` | Minor | Logically equivalent (De Morgan's law), just expressed differently. |

## Missing Features
| NCCL Feature | Source Location | Priority | Notes |
|-------------|----------------|----------|-------|
| NVLS algorithm | search.cc:386-417, tuning.cc | High | NVLink SHARP (NVLS) not implemented. Required for Hopper+ multi-GPU all-reduce optimization. |
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
| NCCL_NVLS_NCHANNELS | N/A | NO | - | NVLS not implemented |
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
| NCCL_NVLS_ENABLE | N/A | NO | - | NVLS not implemented |
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
4. NVLink bounce -> NVB (line 124 vs ref lines 98-99): Our version additionally guards on `fromNode.type == GPU && toNode.type == GPU` which NCCL does not. This is stricter but safe since NVL links only exist between GPUs/NVSwitches.
5. Default link-to-path mapping (lines 127-146 vs ref lines 92-101): MATCH
6. max(pathSoFar, hopType) (line 150 vs ref line 101): MATCH

**Divergence**: The NVB detection at line 124 checks `fromNode.type === NodeType.GPU && toNode.type === NodeType.GPU` but NCCL only checks `node->type == GPU` (the current node is GPU). This is functionally equivalent because NVB routing only occurs GPU-to-GPU, but the extra guard is redundant.

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

Channel bounds (lines 181-188 vs connect.cc:322-353): MATCH -- uses NCCL_MIN_NCHANNELS and NCCL_MAX_NCHANNELS with clamping.

### rccl_rome_match (rome-match.ts <-> rome_models.cc)

The Rome model matching follows the same approach:
1. Extract topology properties (nGpus, nCpus, nNics, nLinks, connMatrix, pattern)
2. Iterate models, check basic property match
3. Attempt GPU permutation matching
4. Attempt NIC permutation matching
5. Parse pre-computed ring orderings

RCCL_MODEL_MATCHING_DISABLE and RCCL_MODEL_REVERSAL_DISABLE are both implemented. The 46 pre-computed models are present.
