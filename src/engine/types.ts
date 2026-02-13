// =============================================================================
// xCCL Topology Types — mirrors NCCL structs from topo.h, graph.h, device.h
// =============================================================================

// --- Node types (topo.h:40-45) ---
export enum NodeType {
  GPU = 0,
  PCI = 1,
  NVS = 2,  // NVSwitch
  CPU = 3,  // NUMA domain
  NIC = 4,
  NET = 5,
}
export const NODE_TYPE_COUNT = 6

// --- Link types (topo.h:49-59) ---
export enum LinkType {
  LOC = 0,   // Loopback
  NVL = 1,   // NVLink direct
  C2C = 3,   // Chip-to-chip
  PCI = 4,   // PCIe
  SYS = 9,   // Cross-socket (QPI/UPI/xGMI)
  NET = 10,  // Network
}

// --- Path types (topo.h:63-99) ---
export enum PathType {
  LOC = 0,   // Self
  NVL = 1,   // NVLink direct
  NVB = 2,   // NVLink bounce (through intermediate GPU)
  C2C = 3,   // Chip-to-chip
  PIX = 4,   // Same PCIe switch
  PXB = 5,   // Cross PCIe switch (no host bridge)
  P2C = 6,   // GPU→C2C→CPU→PCIe→NIC
  PXN = 7,   // Cross PCIe via NUMA (rail-local agg)
  PHB = 8,   // Cross PCIe host bridge (CPU)
  SYS = 9,   // Cross socket
  NET = 10,  // Network
  DIS = 11,  // Disconnected
}

// --- GPU generations ---
export enum GPUGeneration {
  SM60 = 60,   // Pascal
  SM70 = 70,   // Volta
  SM80 = 80,   // Ampere
  SM86 = 86,   // Ampere (GA10x)
  SM90 = 90,   // Hopper
  SM100 = 100, // Blackwell
}

// --- CPU architecture/vendor/model (from NCCL source) ---
export enum CPUArch {
  X86 = 0,
  POWER = 1,
  ARM = 2,
}

export enum CPUVendor {
  INTEL = 0,
  AMD = 1,
  ZHAOXIN = 2,
}

// Intel CPU models
export enum IntelCPUModel {
  BDW = 1,    // Broadwell
  SKL = 2,    // Skylake/Cascade Lake
  SRP = 3,    // Sapphire Rapids
  ERP = 4,    // Emerald Rapids
}

// AMD CPU models
export enum AMDCPUModel {
  ROME = 1,
  MILAN = 2,
  GENOA = 3,
}

// --- PCIe generations ---
export enum PCIeGen {
  GEN3 = 3,
  GEN4 = 4,
  GEN5 = 5,
}

// --- Graph pattern types (search.cc) ---
export enum GraphPattern {
  RING = 0,
  BALANCED_TREE = 1,
  SPLIT_TREE = 2,
}

// --- Algorithm types (tuning.cc) ---
export enum Algorithm {
  RING = 0,
  TREE = 1,
  COLLNET_DIRECT = 2,
  COLLNET_CHAIN = 3,
  NVLS = 4,
  NVLS_TREE = 5,
}

// --- Protocol types (tuning.cc) ---
export enum Protocol {
  LL = 0,     // Low-latency
  LL128 = 1,  // Low-latency 128B
  SIMPLE = 2, // Simple (high throughput)
}

// =============================================================================
// Core topology data structures
// =============================================================================

export interface TopoNode {
  id: string            // Unique identifier
  type: NodeType
  index: number         // Index within its type group
  label?: string

  // GPU-specific
  gpu?: {
    dev: number
    rank: number
    cudaCompCap: number
    gdrSupport: boolean
  }

  // NIC-specific
  net?: {
    dev: number
    speed: number       // GB/s
    gdrSupport: boolean
    collSupport: boolean
    maxChannels: number
  }

  // CPU-specific
  cpu?: {
    arch: CPUArch
    vendor: CPUVendor
    model: number
    numaId: number
  }

  // PCI-specific
  pci?: {
    gen: PCIeGen
    width: number       // x16, x8, etc.
  }
}

export interface TopoLink {
  fromId: string
  toId: string
  type: LinkType
  bandwidth: number    // GB/s
}

export interface TopoPath {
  fromId: string
  toId: string
  type: PathType
  bandwidth: number    // Bottleneck BW in GB/s
  hops: TopoPathHop[]
  count: number        // Number of hops
}

export interface TopoPathHop {
  linkType: LinkType
  bandwidth: number
  nodeId: string
}

// The full topology system
export interface TopoSystem {
  nodes: TopoNode[]
  links: TopoLink[]
  paths: Map<string, TopoPath>  // key = "fromId->toId"
  maxBw: number
  totalBw: number
  inter: boolean       // Has inter-node connections

  // Grouped access (mirrors ncclTopoNodeSet)
  nodesByType: Map<NodeType, TopoNode[]>
}

// =============================================================================
// Graph (search result) types
// =============================================================================

export interface ChannelRing {
  ringOrder: string[]   // Node IDs in ring order
  prev: Map<string, string>
  next: Map<string, string>
}

export interface ChannelTree {
  treeLinks: { parentId: string; childId: string }[]
  up: Map<string, string>       // nodeId → parent nodeId
  down: Map<string, string[]>   // nodeId → child nodeIds
}

export interface GraphChannel {
  id: number
  bandwidth: number

  // Ring data
  ringOrder: string[]   // GPU IDs in ring order (intraOrder)

  // Tree data
  treeLinks?: { parentId: string; childId: string }[]
  treeUp?: Map<string, string>
  treeDown?: Map<string, string[]>
}

export interface TopoGraph {
  id: string
  pattern: GraphPattern
  nChannels: number
  channels: GraphChannel[]
  speedIntra: number
  speedInter: number
  typeIntra: LinkType
  typeInter: LinkType
}

// =============================================================================
// Hardware configuration (user input)
// =============================================================================

export interface GPUConfig {
  count: number
  type: string           // "H100", "A100", "B200", "MI300X", etc.
  cudaCompCap: number
  nvlinksPerPair: number // NVLinks between each GPU pair (0 if no direct NVLink)
  gdrSupport: boolean
}

export interface CPUConfig {
  count: number
  arch: CPUArch
  vendor: CPUVendor
  model: number
}

export interface NICConfig {
  count: number
  speed: number          // GB/s per NIC
  gdrSupport: boolean
  collSupport: boolean
}

export interface PCIeConfig {
  gen: PCIeGen
  width: number
  switchesPerCPU: number // PCIe switches per CPU socket
}

export interface NVSwitchConfig {
  count: number          // 0 = direct NVLink/xGMI mesh
}

export interface HardwareConfig {
  name: string
  gpu: GPUConfig
  cpu: CPUConfig
  nic: NICConfig
  pcie: PCIeConfig
  nvswitch: NVSwitchConfig
  numaMapping: number[]  // GPU index → NUMA/CPU index
}

// =============================================================================
// Multi-node
// =============================================================================

export interface SUConfig {
  serverCount: number
  railCount: number
  networkType: 'rail-optimized' | 'fat-tree'
}

// =============================================================================
// Decision log
// =============================================================================

export type DecisionPhase =
  | 'topoGetSystem'
  | 'computePaths'
  | 'trimSystem'
  | 'searchInit'
  | 'ringSearch'
  | 'treeSearch'
  | 'channelSetup'
  | 'romeModelMatch'

export interface DecisionEntry {
  step: number
  phase: DecisionPhase
  action: string
  reason: string
  alternatives: string[]
  sourceRef: string       // e.g. "paths.cc:67"
  data?: Record<string, unknown>
  timestamp: number
}
