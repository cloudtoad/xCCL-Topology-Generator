// =============================================================================
// NCCL Constants — exact values from NCCL source code
// =============================================================================

// --- Bandwidth constants (topo.h:16-33) ---
export const LOC_BW = 5000.0          // topo.h:16
export const SM60_NVLINK_BW = 18.0    // topo.h:17
export const SM70_NVLINK_BW = 20.0    // topo.h:18
export const SM80_NVLINK_BW = 20.0    // topo.h:19
export const SM90_NVLINK_BW = 20.6    // topo.h:20
export const SM86_NVLINK_BW = 12.0    // topo.h:21
export const SM100_NVLINK_BW = 40.1   // topo.h:22
export const PCI_BW = 12.0           // topo.h:23 — PCI Gen3 x16
export const AMD_BW = 16.0           // topo.h:24
export const BDW_QPI_BW = 6.0        // topo.h:25 — Broadwell
export const SKL_QPI_BW = 10.0       // topo.h:26 — Skylake/Cascade Lake
export const SRP_QPI_BW = 22.0       // topo.h:27 — Sapphire Rapids
export const ERP_QPI_BW = 40.0       // topo.h:28 — Emerald Rapids
export const ZPI_BW = 6.0            // topo.h:29 — Zhaoxin
export const YONGFENG_ZPI_BW = 9.0   // topo.h:30
export const P9_BW = 32.0            // topo.h:31 — Power9
export const ARM_BW = 6.0            // topo.h:32
export const NET_BW = 12.0           // topo.h:33 — 100Gbit

// Intel P2P overhead: GPU-to-GPU through Intel CPU uses 64B TLPs (topo.h:37)
export function intelP2POverhead(bw: number): number {
  return bw * 6 / 5
}

// NVLink bandwidth by compute capability (topo.h:276-284)
export function nvlinkBw(cudaCompCap: number): number {
  if (cudaCompCap >= 100) return SM100_NVLINK_BW
  if (cudaCompCap >= 90) return SM90_NVLINK_BW
  if (cudaCompCap === 86) return SM86_NVLINK_BW
  if (cudaCompCap >= 80) return SM80_NVLINK_BW
  if (cudaCompCap >= 70) return SM70_NVLINK_BW
  if (cudaCompCap >= 60) return SM60_NVLINK_BW
  return SM80_NVLINK_BW
}

// --- Speed arrays (search.cc:976-989) ---
// Default speed arrays
export const speedArrayIntra = [40, 30, 20, 18, 15, 12, 10, 9, 7, 6, 5, 4, 3]        // search.cc:976
export const speedArrayInter = [48, 30, 28, 24, 20, 18, 15, 12, 10, 9, 7, 6, 5, 4, 3, 2.4, 1.2, 0.24, 0.12]  // search.cc:977

// SM90 (Hopper) speed arrays
export const sm90SpeedArrayIntra = [60, 50, 40, 30, 24, 20, 15, 12, 11, 6, 3]         // search.cc:981
export const sm90SpeedArrayInter = [48, 45, 42, 40, 30, 24, 22, 20, 17.5, 15, 12, 6, 3, 2.4, 1.2, 0.24, 0.12]  // search.cc:982

// SM100 (Blackwell) speed arrays
export const sm100SpeedArrayIntra = [90, 80, 70, 60, 50, 45, 40, 30, 24, 20, 19, 18]  // search.cc:986
export const sm100SpeedArrayInter = [96, 48, 45.1, 42, 40, 30, 24, 22, 20, 17.5, 15, 12, 6, 3, 2.4, 1.2, 0.24, 0.12]  // search.cc:987

// Speed array selection by compute capability (search.cc:1089-1094)
export function getSpeedArrays(ccMin: number, isInter: boolean): number[] {
  if (isInter) {
    if (ccMin >= 100) return sm100SpeedArrayInter
    if (ccMin >= 90) return sm90SpeedArrayInter
    return speedArrayInter
  } else {
    if (ccMin >= 100) return sm100SpeedArrayIntra
    if (ccMin >= 90) return sm90SpeedArrayIntra
    return speedArrayIntra
  }
}

// --- Search timeouts (search.cc:315-318) ---
export const SEARCH_GLOBAL_TIMEOUT = 1 << 19    // 524288 — search.cc:315
export const SEARCH_TIMEOUT = 1 << 14           // 16384  — search.cc:316
export const SEARCH_TIMEOUT_TREE = 1 << 14      // 16384  — search.cc:317
export const SEARCH_TIMEOUT_SAMECHANNELS = 1 << 8  // 256 — search.cc:318

// --- Forced order constants (search.cc:320-321) ---
export const FORCED_ORDER_PCI = 1
export const FORCED_ORDER_REPLAY = 2

// --- Device limits (device.h) ---
export const MAXCHANNELS = 64                    // device.h:86
export const NCCL_MAX_LOCAL_RANKS = 72           // device.h:87
export const NCCL_MAX_NTHREADS = 640             // device.h:88
export const NCCL_MIN_NTHREADS = 128             // device.h:89 (4*WARP_SIZE)
export const NCCL_SIMPLE_MAX_NTHREADS = 512      // device.h:90
export const NCCL_LL_MAX_NTHREADS = 512          // device.h:92
export const NCCL_LL128_MAX_NTHREADS = 640       // device.h:109
export const NCCL_STEPS = 8                       // device.h:24
export const NCCL_MAX_OPS = 2048                  // device.h:23
export const NCCL_MAX_TREE_ARITY_TOP = 2         // device.h:185
export const NCCL_MAX_TREE_ARITY = 3             // device.h:187
export const NCCL_MAX_DIRECT_ARITY = 7           // device.h:194
export const NCCL_MAX_NVLS_ARITY = 32            // device.h:208
export const NCCL_MAX_CONNS = 2                  // device.h:226

// --- Topology limits (topo.h) ---
export const NCCL_TOPO_NODE_TYPES = 6            // topo.h:39
export const NCCL_TOPO_MAX_LINKS = 576           // topo.h:111
export const NCCL_TOPO_MAX_NODES = 576           // from graph.h
export const NCCL_TOPO_MAX_HOPS = NCCL_TOPO_MAX_NODES * NCCL_TOPO_NODE_TYPES  // topo.h:112
export const NCCL_TOPO_UNDEF = -1                // topo.h:121
export const NCCL_TOPO_XML_MAX_NODES = 256       // topo.h:217
export const NCCL_GRAPH_XML_MAX_NODES = 4096     // topo.h:218

// --- Graph patterns (search.cc) ---
export const NCCL_TOPO_PATTERN_RING = 0
export const NCCL_TOPO_PATTERN_BALANCED_TREE = 1
export const NCCL_TOPO_PATTERN_SPLIT_TREE = 2
export const NCCL_TOPO_PATTERN_TREE = 3
export const NCCL_TOPO_PATTERN_COLLNET_DIRECT = 4
export const NCCL_TOPO_PATTERN_COLLNET_CHAIN = 5
export const NCCL_TOPO_PATTERN_NVLS = 6

// --- CPU architecture constants (from NCCL source) ---
export const NCCL_TOPO_CPU_ARCH_X86 = 1
export const NCCL_TOPO_CPU_ARCH_POWER = 2
export const NCCL_TOPO_CPU_ARCH_ARM = 3

export const NCCL_TOPO_CPU_VENDOR_INTEL = 1
export const NCCL_TOPO_CPU_VENDOR_AMD = 2
export const NCCL_TOPO_CPU_VENDOR_ZHAOXIN = 3

export const NCCL_TOPO_CPU_TYPE_BDW = 1
export const NCCL_TOPO_CPU_TYPE_SKL = 2
export const NCCL_TOPO_CPU_TYPE_SRP = 3
export const NCCL_TOPO_CPU_TYPE_ERP = 4

// --- Algorithm/Protocol IDs (tuning.cc) ---
export const NCCL_ALGO_TREE = 0
export const NCCL_ALGO_RING = 1
export const NCCL_ALGO_COLLNET_DIRECT = 2
export const NCCL_ALGO_COLLNET_CHAIN = 3
export const NCCL_ALGO_NVLS = 4
export const NCCL_ALGO_NVLS_TREE = 5
export const NCCL_ALGO_PAT = 6
export const NCCL_NUM_ALGORITHMS = 7

export const NCCL_PROTO_LL = 0
export const NCCL_PROTO_LL128 = 1
export const NCCL_PROTO_SIMPLE = 2
export const NCCL_NUM_PROTOCOLS = 3

// --- GPU scoring criteria order (search.cc:191-201) ---
// 1. interBw (desc) 2. interPciBw (desc) 3. interNhops (asc)
// 4. intraBw (desc) 5. intraNhops (asc) 6. startIndex (asc)
export interface GpuScore {
  g: number
  startIndex: number
  intraNhops: number
  intraBw: number
  interNhops: number
  interPciBw: number
  interBw: number
}

export function compareGpuScores(a: GpuScore, b: GpuScore): number {
  // Higher interBw is better (descending)
  if (a.interBw !== b.interBw) return b.interBw - a.interBw
  if (a.interPciBw !== b.interPciBw) return b.interPciBw - a.interPciBw
  // Lower hops is better (ascending)
  if (a.interNhops !== b.interNhops) return a.interNhops - b.interNhops
  if (a.intraBw !== b.intraBw) return b.intraBw - a.intraBw
  if (a.intraNhops !== b.intraNhops) return a.intraNhops - b.intraNhops
  return a.startIndex - b.startIndex
}
