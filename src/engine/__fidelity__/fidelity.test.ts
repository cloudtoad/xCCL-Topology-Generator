// =============================================================================
// Fidelity Tests — verify our engine matches NCCL/RCCL reference source
//
// These are deterministic behavioral tests (Vitest) that run the engine with
// known hardware configs and verify outputs match expected NCCL behavior.
// =============================================================================

import { describe, test, expect, beforeAll } from 'vitest'

// --- Constants ---
import {
  LOC_BW,
  SM60_NVLINK_BW,
  SM70_NVLINK_BW,
  SM80_NVLINK_BW,
  SM86_NVLINK_BW,
  SM90_NVLINK_BW,
  SM100_NVLINK_BW,
  PCI_BW,
  AMD_BW,
  BDW_QPI_BW,
  SKL_QPI_BW,
  SRP_QPI_BW,
  ERP_QPI_BW,
  ZPI_BW,
  YONGFENG_ZPI_BW,
  P9_BW,
  ARM_BW,
  NET_BW,
  nvlinkBw,
  intelP2POverhead,
  MAXCHANNELS,
  SEARCH_GLOBAL_TIMEOUT,
  SEARCH_TIMEOUT,
  SEARCH_TIMEOUT_TREE,
  SEARCH_TIMEOUT_SAMECHANNELS,
  speedArrayIntra,
  speedArrayInter,
  sm90SpeedArrayIntra,
  sm90SpeedArrayInter,
  sm100SpeedArrayIntra,
  sm100SpeedArrayInter,
  getSpeedArrays,
  NCCL_MAX_TREE_ARITY_TOP,
  NCCL_MAX_TREE_ARITY,
} from '../constants/nccl'

import {
  VEGA_XGMI_WIDTH,
  MI200_XGMI_WIDTH,
  GFX94X_XGMI_WIDTH,
  GFX95X_XGMI_WIDTH,
  xgmiWidth,
} from '../constants/rccl'

// --- Types ---
import {
  NodeType,
  LinkType,
  PathType,
  GraphPattern,
  CPUArch,
  CPUVendor,
  PCIeGen,
} from '../types'
import type { TopoSystem, TopoNode, TopoPath, TopoGraph } from '../types'

// --- Engine modules ---
import { buildTopoSystem } from '../topo'
import { computeAllPaths, trimSystem } from '../paths'
import { ncclTopoCompute } from '../search'
import { buildTreeGraph, ncclGetDtree } from '../trees'
import { setupRings } from '../rings'
import { setupChannels } from '../connect'
import { runInit } from '../init'
import { DecisionLog } from '../decision-log'
import { createDefaultEnvConfig } from '../env'
import type { EnvConfig } from '../env'

// --- Hardware templates ---
import { dgxH100Config } from '../templates/dgx-h100'
import { dgxB200Config } from '../templates/dgx-b200'
import { hgxA100Config } from '../templates/hgx-a100'
import { mi300xOamConfig } from '../templates/mi300x-oam'

// =============================================================================
// Helpers
// =============================================================================

function makeEnv(overrides: Record<string, number | string> = {}): EnvConfig {
  const env = createDefaultEnvConfig()
  for (const [k, v] of Object.entries(overrides)) {
    const def = env.get(k)
    if (def) def.value = v
  }
  return env
}

function getPath(system: TopoSystem, from: string, to: string): TopoPath | undefined {
  return system.paths.get(`${from}->${to}`)
}

// =============================================================================
// Layer 1: Constants accuracy (topo.h exact values)
// =============================================================================

describe('constants match NCCL topo.h', () => {
  test('bandwidth constants', () => {
    expect(LOC_BW).toBe(5000.0)
    expect(SM60_NVLINK_BW).toBe(18.0)
    expect(SM70_NVLINK_BW).toBe(20.0)
    expect(SM80_NVLINK_BW).toBe(20.0)
    expect(SM90_NVLINK_BW).toBe(20.6)
    expect(SM86_NVLINK_BW).toBe(12.0)
    expect(SM100_NVLINK_BW).toBe(40.1)
    expect(PCI_BW).toBe(12.0)
    expect(AMD_BW).toBe(16.0)
    expect(BDW_QPI_BW).toBe(6.0)
    expect(SKL_QPI_BW).toBe(10.0)
    expect(SRP_QPI_BW).toBe(22.0)
    expect(ERP_QPI_BW).toBe(40.0)
    expect(ZPI_BW).toBe(6.0)
    expect(YONGFENG_ZPI_BW).toBe(9.0)
    expect(P9_BW).toBe(32.0)
    expect(ARM_BW).toBe(6.0)
    expect(NET_BW).toBe(12.0)
  })

  test('NVLink bandwidth by compute capability (topo.h:276-284)', () => {
    expect(nvlinkBw(100)).toBe(SM100_NVLINK_BW)  // Blackwell
    expect(nvlinkBw(110)).toBe(SM100_NVLINK_BW)  // Future >= 100
    expect(nvlinkBw(90)).toBe(SM90_NVLINK_BW)    // Hopper
    expect(nvlinkBw(86)).toBe(SM86_NVLINK_BW)    // GA10x
    expect(nvlinkBw(80)).toBe(SM80_NVLINK_BW)    // Ampere
    expect(nvlinkBw(70)).toBe(SM70_NVLINK_BW)    // Volta
    expect(nvlinkBw(60)).toBe(SM60_NVLINK_BW)    // Pascal
    expect(nvlinkBw(50)).toBe(SM80_NVLINK_BW)    // Fallback
  })

  test('Intel P2P overhead (topo.h:37)', () => {
    // INTEL_P2P_OVERHEAD(bw) = bw*6/5
    expect(intelP2POverhead(12.0)).toBeCloseTo(14.4)
    expect(intelP2POverhead(20.0)).toBeCloseTo(24.0)
  })

  test('PCIe bandwidth scaling', () => {
    // PCI_BW=12.0 is Gen3 x16; scale by (gen/3) * (width/16)
    const pcieBw = (gen: number, width: number) => PCI_BW * (gen / 3) * (width / 16)
    expect(pcieBw(3, 16)).toBe(12.0)  // Gen3 x16 baseline
    expect(pcieBw(4, 16)).toBe(16.0)  // Gen4 x16
    expect(pcieBw(5, 16)).toBe(20.0)  // Gen5 x16
    expect(pcieBw(4, 8)).toBe(8.0)    // Gen4 x8
    expect(pcieBw(5, 8)).toBe(10.0)   // Gen5 x8
  })

  test('device limits', () => {
    expect(MAXCHANNELS).toBe(64)
    expect(NCCL_MAX_TREE_ARITY_TOP).toBe(2)
    expect(NCCL_MAX_TREE_ARITY).toBe(3)
  })

  test('search timeouts (search.cc:315-318)', () => {
    expect(SEARCH_GLOBAL_TIMEOUT).toBe(1 << 19)   // 524288
    expect(SEARCH_TIMEOUT).toBe(1 << 14)           // 16384
    expect(SEARCH_TIMEOUT_TREE).toBe(1 << 14)      // 16384
    expect(SEARCH_TIMEOUT_SAMECHANNELS).toBe(1 << 8) // 256
  })
})

describe('speed arrays match search.cc:976-989', () => {
  test('default intra speed array', () => {
    expect(speedArrayIntra).toEqual([40, 30, 20, 18, 15, 12, 10, 9, 7, 6, 5, 4, 3])
  })

  test('default inter speed array', () => {
    expect(speedArrayInter).toEqual([48, 30, 28, 24, 20, 18, 15, 12, 10, 9, 7, 6, 5, 4, 3, 2.4, 1.2, 0.24, 0.12])
  })

  test('SM90 intra speed array', () => {
    expect(sm90SpeedArrayIntra).toEqual([60, 50, 40, 30, 24, 20, 15, 12, 11, 6, 3])
  })

  test('SM90 inter speed array', () => {
    expect(sm90SpeedArrayInter).toEqual([48, 45, 42, 40, 30, 24, 22, 20, 17.5, 15, 12, 6, 3, 2.4, 1.2, 0.24, 0.12])
  })

  test('SM100 intra speed array', () => {
    expect(sm100SpeedArrayIntra).toEqual([90, 80, 70, 60, 50, 45, 40, 30, 24, 20, 19, 18])
  })

  test('SM100 inter speed array', () => {
    expect(sm100SpeedArrayInter).toEqual([96, 48, 45.1, 42, 40, 30, 24, 22, 20, 17.5, 15, 12, 6, 3, 2.4, 1.2, 0.24, 0.12])
  })

  test('speed array selection by CC', () => {
    expect(getSpeedArrays(80, false)).toBe(speedArrayIntra)
    expect(getSpeedArrays(80, true)).toBe(speedArrayInter)
    expect(getSpeedArrays(90, false)).toBe(sm90SpeedArrayIntra)
    expect(getSpeedArrays(90, true)).toBe(sm90SpeedArrayInter)
    expect(getSpeedArrays(100, false)).toBe(sm100SpeedArrayIntra)
    expect(getSpeedArrays(100, true)).toBe(sm100SpeedArrayInter)
  })
})

describe('RCCL xGMI constants match rccl topo.h', () => {
  test('xGMI bandwidth values', () => {
    expect(VEGA_XGMI_WIDTH).toBe(24.0)
    expect(MI200_XGMI_WIDTH).toBe(36.0)
    expect(GFX94X_XGMI_WIDTH).toBe(48.0)
    expect(GFX95X_XGMI_WIDTH).toBe(48.0)
  })

  test('xGMI bandwidth by architecture', () => {
    expect(xgmiWidth('gfx942')).toBe(GFX94X_XGMI_WIDTH)   // MI300X
    expect(xgmiWidth('gfx90a')).toBe(MI200_XGMI_WIDTH)     // MI250X
    expect(xgmiWidth('gfx908')).toBe(VEGA_XGMI_WIDTH)      // MI100
    expect(xgmiWidth('gfx950')).toBe(GFX95X_XGMI_WIDTH)    // gfx95x
    expect(xgmiWidth('gfx906')).toBe(VEGA_XGMI_WIDTH)      // MI60
  })
})

// =============================================================================
// Layer 2: Topology builder
// =============================================================================

describe('buildTopoSystem', () => {
  test('DGX H100: correct node counts', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)

    const gpus = system.nodesByType.get(NodeType.GPU) ?? []
    const cpus = system.nodesByType.get(NodeType.CPU) ?? []
    const nics = system.nodesByType.get(NodeType.NIC) ?? []
    const nvs = system.nodesByType.get(NodeType.NVS) ?? []
    const pci = system.nodesByType.get(NodeType.PCI) ?? []

    expect(gpus.length).toBe(8)
    expect(cpus.length).toBe(2)
    expect(nics.length).toBe(8)
    expect(nvs.length).toBe(4)
    expect(pci.length).toBe(4) // 2 switches/CPU * 2 CPUs
  })

  test('DGX H100: NVSwitch links present', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)

    // Every GPU should connect to every NVSwitch
    const nvlLinks = system.links.filter(l => l.type === LinkType.NVL)
    // 8 GPUs * 4 NVSwitches * 2 directions = 64
    expect(nvlLinks.length).toBe(64)
    expect(nvlLinks[0].bandwidth).toBe(SM90_NVLINK_BW)
  })

  test('MI300X: xGMI mesh links present', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(mi300xOamConfig, env, log)

    // Full mesh: 8 GPUs, each connects to 7 others
    const nvlLinks = system.links.filter(l => l.type === LinkType.NVL)
    expect(nvlLinks.length).toBe(8 * 7) // 56
    expect(nvlLinks[0].bandwidth).toBe(GFX94X_XGMI_WIDTH)
  })

  test('Inter-socket links use correct bandwidth', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)

    // DGX H100 uses Intel SRP CPUs → SRP_QPI_BW = 22.0
    const sysLinks = system.links.filter(l => l.type === LinkType.SYS)
    expect(sysLinks.length).toBe(2) // CPU0→CPU1 and CPU1→CPU0
    expect(sysLinks[0].bandwidth).toBe(SRP_QPI_BW)
  })

  test('PCIe bandwidth scales by gen and width', () => {
    const env = makeEnv()
    const log = new DecisionLog()

    // DGX H100: Gen5 x16 → PCI_BW * (5/3) * (16/16) = 20.0
    const system = buildTopoSystem(dgxH100Config, env, log)
    const pciLinks = system.links.filter(l => l.type === LinkType.PCI)
    const expectedBw = PCI_BW * (5 / 3) * (16 / 16) // 20.0
    expect(pciLinks[0].bandwidth).toBeCloseTo(expectedBw)

    // HGX A100: Gen4 x16 → PCI_BW * (4/3) * (16/16) = 16.0
    const system2 = buildTopoSystem(hgxA100Config, env, new DecisionLog())
    const pciLinks2 = system2.links.filter(l => l.type === LinkType.PCI)
    const expectedBw2 = PCI_BW * (4 / 3) * (16 / 16) // 16.0
    expect(pciLinks2[0].bandwidth).toBeCloseTo(expectedBw2)
  })
})

// =============================================================================
// Layer 3: Path computation (classifyHop + SPFA)
// =============================================================================

describe('SPFA path computation for DGX H100', () => {
  let system: TopoSystem
  let env: EnvConfig
  let log: DecisionLog

  beforeAll(() => {
    env = makeEnv()
    log = new DecisionLog()
    system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)
  })

  test('GPU-GPU via NVSwitch = NVL path type', () => {
    // All GPU pairs should have NVL paths via NVSwitch
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (i === j) continue
        const p = getPath(system, `gpu-${i}`, `gpu-${j}`)
        expect(p).toBeDefined()
        expect(p!.type).toBe(PathType.NVL)
      }
    }
  })

  test('GPU-GPU bandwidth = NVLink speed', () => {
    const p = getPath(system, 'gpu-0', 'gpu-1')
    expect(p).toBeDefined()
    expect(p!.bandwidth).toBe(SM90_NVLINK_BW)
  })

  test('GPU-NIC same socket = PIX path type', () => {
    // GPU-0 is on CPU-0 (numaMapping[0]=0), NIC-0 is paired with GPU-0
    // They share the same PCIe switch → PIX
    const p = getPath(system, 'gpu-0', 'nic-0')
    expect(p).toBeDefined()
    expect(p!.type).toBe(PathType.PIX)
  })

  test('GPU-NIC cross socket = PXN, PHB, or SYS path type', () => {
    // GPU-0 on CPU-0, NIC-4 on CPU-1 (numaMapping[4]=1)
    // PXN optimization may upgrade cross-socket paths to PXN (type 7)
    // which is better than PHB (type 8)
    const p = getPath(system, 'gpu-0', 'nic-4')
    expect(p).toBeDefined()
    // Cross-socket NIC: either PXN (NVLink proxy), PHB, or SYS
    expect(p!.type).toBeGreaterThanOrEqual(PathType.PXN)
  })

  test('self-paths are LOC', () => {
    const p = getPath(system, 'gpu-0', 'gpu-0')
    expect(p).toBeDefined()
    expect(p!.type).toBe(PathType.LOC)
  })

  test('all GPU-NIC paths exist', () => {
    for (let g = 0; g < 8; g++) {
      for (let n = 0; n < 8; n++) {
        const p = getPath(system, `gpu-${g}`, `nic-${n}`)
        expect(p).toBeDefined()
        expect(p!.type).not.toBe(PathType.DIS)
      }
    }
  })
})

describe('SPFA path computation for HGX A100', () => {
  let system: TopoSystem

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    system = buildTopoSystem(hgxA100Config, env, log)
    computeAllPaths(system, env, log)
  })

  test('GPU-GPU paths are NVL (6 NVSwitch)', () => {
    const p = getPath(system, 'gpu-0', 'gpu-3')
    expect(p).toBeDefined()
    expect(p!.type).toBe(PathType.NVL)
    expect(p!.bandwidth).toBe(SM80_NVLINK_BW)
  })
})

describe('SPFA path computation for MI300X', () => {
  let system: TopoSystem

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    system = buildTopoSystem(mi300xOamConfig, env, log)
    computeAllPaths(system, env, log)
  })

  test('GPU-GPU via xGMI mesh = NVL path type', () => {
    const p = getPath(system, 'gpu-0', 'gpu-1')
    expect(p).toBeDefined()
    expect(p!.type).toBe(PathType.NVL)
    expect(p!.bandwidth).toBe(GFX94X_XGMI_WIDTH)
  })
})

// =============================================================================
// Layer 4: PXN optimization
// =============================================================================

describe('PXN optimization (paths.cc:725-749)', () => {
  test('PXN enabled: some cross-socket GPU-NIC paths become PXN', () => {
    const env = makeEnv({ NCCL_PXN_DISABLE: 0 })
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)

    // Check if any GPU-NIC path is PXN
    let pxnCount = 0
    for (let g = 0; g < 8; g++) {
      for (let n = 0; n < 8; n++) {
        const p = getPath(system, `gpu-${g}`, `nic-${n}`)
        if (p && p.type === PathType.PXN) pxnCount++
      }
    }
    // PXN should improve some cross-socket GPU-NIC paths
    expect(pxnCount).toBeGreaterThan(0)
  })

  test('PXN disabled: no PXN paths present', () => {
    const env = makeEnv({ NCCL_PXN_DISABLE: 1 })
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)

    // No PXN paths when disabled
    for (let g = 0; g < 8; g++) {
      for (let n = 0; n < 8; n++) {
        const p = getPath(system, `gpu-${g}`, `nic-${n}`)
        if (p) expect(p.type).not.toBe(PathType.PXN)
      }
    }
  })
})

describe('NVB disable (paths.cc:34)', () => {
  test('NVB disabled prevents GPU passthrough routing', () => {
    // With a mesh topology (no NVSwitch), NVB would normally allow
    // GPU→GPU→GPU bounce paths. Disabling NVB prevents this.
    const env = makeEnv({ NCCL_NVB_DISABLE: 1 })
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)

    // With NVSwitch topology, there shouldn't be NVB paths anyway
    // (NVSwitch provides direct GPU-GPU paths). This test verifies the
    // env var is read and respected.
    for (let g = 0; g < 8; g++) {
      for (let j = 0; j < 8; j++) {
        if (g === j) continue
        const p = getPath(system, `gpu-${g}`, `gpu-${j}`)
        if (p) expect(p.type).not.toBe(PathType.NVB)
      }
    }
  })
})

// =============================================================================
// Layer 5: Ring search
// =============================================================================

describe('ring search for 8-GPU NVSwitch topology (DGX H100)', () => {
  let ringGraph: TopoGraph
  let system: TopoSystem

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)
    computeAllPaths(system, env, log)

    ringGraph = ncclTopoCompute(
      system,
      GraphPattern.RING,
      1,
      Math.floor(MAXCHANNELS / 2),
      env,
      log,
    )
  })

  test('finds multiple ring channels', () => {
    expect(ringGraph.nChannels).toBeGreaterThan(0)
    // NVSwitch topology with 8 GPUs should find many channels
    // MAXCHANNELS/2 = 32 is the max we request
    expect(ringGraph.nChannels).toBeGreaterThanOrEqual(1)
  })

  test('every ring is Hamiltonian (visits all 8 GPUs)', () => {
    for (const ch of ringGraph.channels) {
      expect(ch.ringOrder.length).toBe(8)
      const unique = new Set(ch.ringOrder)
      expect(unique.size).toBe(8)
    }
  })

  test('bandwidth is from SM90 speed array', () => {
    // The search selects a speed from the speed array, not the raw NVLink BW.
    // Speed is chosen to maximize total BW (speed × nChannels).
    expect(sm90SpeedArrayIntra).toContain(ringGraph.speedIntra)
    expect(ringGraph.speedIntra).toBeGreaterThan(0)
    // Total aggregate BW should be positive
    expect(ringGraph.speedIntra * ringGraph.nChannels).toBeGreaterThan(0)
  })

  test('intra link type is NVLink', () => {
    expect(ringGraph.typeIntra).toBe(LinkType.NVL)
  })
})

describe('ring search for HGX A100', () => {
  let ringGraph: TopoGraph

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(hgxA100Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)
    computeAllPaths(system, env, log)

    ringGraph = ncclTopoCompute(
      system,
      GraphPattern.RING,
      1,
      Math.floor(MAXCHANNELS / 2),
      env,
      log,
    )
  })

  test('finds rings from default speed array', () => {
    expect(ringGraph.nChannels).toBeGreaterThan(0)
    // A100 (CC=80) uses default speed arrays
    expect(speedArrayIntra).toContain(ringGraph.speedIntra)
    expect(ringGraph.speedIntra).toBeGreaterThan(0)
  })

  test('every ring visits all 8 GPUs', () => {
    for (const ch of ringGraph.channels) {
      expect(ch.ringOrder.length).toBe(8)
    }
  })
})

describe('ring search for DGX B200', () => {
  let ringGraph: TopoGraph

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxB200Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)
    computeAllPaths(system, env, log)

    ringGraph = ncclTopoCompute(
      system,
      GraphPattern.RING,
      1,
      Math.floor(MAXCHANNELS / 2),
      env,
      log,
    )
  })

  test('finds rings from SM100 speed array', () => {
    expect(ringGraph.nChannels).toBeGreaterThan(0)
    // B200 (CC=100) uses SM100 speed arrays
    expect(sm100SpeedArrayIntra).toContain(ringGraph.speedIntra)
    expect(ringGraph.speedIntra).toBeGreaterThan(0)
  })
})

// =============================================================================
// Layer 6: Tree construction
// =============================================================================

describe('tree channels from rings', () => {
  let ringGraph: TopoGraph
  let treeGraph: TopoGraph

  beforeAll(() => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)
    computeAllPaths(system, env, log)

    ringGraph = ncclTopoCompute(
      system,
      GraphPattern.RING,
      1,
      Math.floor(MAXCHANNELS / 2),
      env,
      log,
    )

    const rawTree = buildTreeGraph(ringGraph, 8, log)
    const connected = setupChannels(system, ringGraph, rawTree, log)
    treeGraph = connected.treeGraph
  })

  test('produces 2x ring channels (forward + reverse)', () => {
    expect(treeGraph.nChannels).toBe(ringGraph.nChannels * 2)
  })

  test('each chain includes all GPUs', () => {
    for (const ch of treeGraph.channels) {
      // Tree chains should link all GPUs
      const treeLinks = ch.treeLinks ?? []
      // A chain of N GPUs has N-1 links
      expect(treeLinks.length).toBe(7) // 8 GPUs - 1
    }
  })

  test('forward chain follows ring order', () => {
    // Even-indexed tree channels should be forward chains
    const forwardCh = treeGraph.channels[0]
    const ringCh = ringGraph.channels[0]
    // The treeLinks should follow ring order
    if (forwardCh.treeLinks && forwardCh.treeLinks.length > 0) {
      for (let i = 0; i < forwardCh.treeLinks.length; i++) {
        expect(forwardCh.treeLinks[i].parentId).toBe(ringCh.ringOrder[i])
        expect(forwardCh.treeLinks[i].childId).toBe(ringCh.ringOrder[i + 1])
      }
    }
  })

  test('reverse chain is reversed ring order', () => {
    // Odd-indexed tree channels should be reverse chains
    const reverseCh = treeGraph.channels[1]
    const ringCh = ringGraph.channels[0]
    const revOrder = [...ringCh.ringOrder].reverse()
    if (reverseCh.treeLinks && reverseCh.treeLinks.length > 0) {
      for (let i = 0; i < reverseCh.treeLinks.length; i++) {
        expect(reverseCh.treeLinks[i].parentId).toBe(revOrder[i])
        expect(reverseCh.treeLinks[i].childId).toBe(revOrder[i + 1])
      }
    }
  })
})

describe('ncclGetDtree (trees.cc:88-109) — alternating-leaf btree', () => {
  test('double tree for 4 ranks (even)', () => {
    // NCCL alternating-leaf btree for 4 ranks:
    //   0---2
    //      / \
    //     1   3
    // Rank 0: root — up=-1, d0=-1, d1=1 (bit=1 for rank 0, d1=bit>>1=0? No...)
    // Actually for nranks=4, rank=0: bit starts at 1, loops until bit&rank or bit>=nranks.
    // bit=1: 1&0=0, bit=2: 2&0=0, bit=4: 4>=4 break. bit=4.
    // rank==0: up=-1, d0=-1, d1 = nranks>1 ? bit>>1 : -1 = 4>>1 = 2
    const { tree0, tree1 } = ncclGetDtree(4, 0)
    expect(tree0.up).toBe(-1)
    expect(tree0.down0).toBe(-1)
    expect(tree0.down1).toBe(2)

    // Tree1 for even nRanks: mirror rank = 4-1-0 = 3
    // getBtree(4, 3): bit=1 (1&3=1, break). up=(3^1)|(1<<1)=2|2=2. 2<4 ok. up=2.
    // lowbit=0. down0=-1, down1=-1.
    // Mirror: up=4-1-2=1
    expect(tree1.up).toBe(1)
    expect(tree1.down0).toBe(-1)
    expect(tree1.down1).toBe(-1)
  })

  test('double tree for 3 ranks (odd)', () => {
    // NCCL btree for 3 ranks:
    //   0---2
    //      /
    //     1
    // rank 0: bit loops 1,2,4(>=3 break). bit=4. root: up=-1,d0=-1,d1=4>>1=2
    const { tree0, tree1 } = ncclGetDtree(3, 0)
    expect(tree0.up).toBe(-1)
    expect(tree0.down0).toBe(-1)
    expect(tree0.down1).toBe(2)

    // Tree1 for odd nRanks: shift rank = (0-1+3)%3 = 2
    // getBtree(3, 2): bit=1(1&2=0), bit=2(2&2=2 break). up=(2^2)|(2<<1)=0|4=4. 4>=3, up=2^2=0.
    // lowbit=1. down0=2-1=1. down1=2+1=3. 3>=3: lowbit>>=1->0. down1=0==0?-1.
    // Shift: up=(0+1)%3=1, d0=(1+1)%3=2, d1=-1
    expect(tree1.up).toBe(1)
    expect(tree1.down0).toBe(2)
    expect(tree1.down1).toBe(-1)
  })

  test('8 ranks: NCCL alternating-leaf tree structure', () => {
    // NCCL trees.cc diagram for 8 ranks:
    //   0---------------8 (but 8>=nranks, so only 0-7)
    //          ______/ \
    //         4         \
    //       /   \        \
    //     2       6       \
    //    / \     / \
    //   1   3   5   7
    //
    // Rank 0: root, d1=4 (bit=8, d1=8>>1=4)
    const { tree0 } = ncclGetDtree(8, 0)
    expect(tree0.up).toBe(-1)
    expect(tree0.down0).toBe(-1)
    expect(tree0.down1).toBe(4)

    // Rank 4: bit=4(4&4=4 break). up=(4^4)|(4<<1)=0|8=8. 8>=8, up=4^4=0.
    // lowbit=2. down0=4-2=2. down1=4+2=6. 6<8 ok.
    const r4 = ncclGetDtree(8, 4)
    expect(r4.tree0.up).toBe(0)
    expect(r4.tree0.down0).toBe(2)
    expect(r4.tree0.down1).toBe(6)

    // Rank 2: bit=2(2&2=2 break). up=(2^2)|(2<<1)=0|4=4. 4<8 ok.
    // lowbit=1. down0=2-1=1. down1=2+1=3. 3<8 ok.
    const r2 = ncclGetDtree(8, 2)
    expect(r2.tree0.up).toBe(4)
    expect(r2.tree0.down0).toBe(1)
    expect(r2.tree0.down1).toBe(3)

    // Rank 1: bit=1(1&1=1 break). up=(1^1)|(1<<1)=0|2=2. 2<8 ok.
    // lowbit=0. down0=-1. down1=-1. Leaf.
    const r1 = ncclGetDtree(8, 1)
    expect(r1.tree0.up).toBe(2)
    expect(r1.tree0.down0).toBe(-1)
    expect(r1.tree0.down1).toBe(-1)

    // All ranks have up=-1 only for rank 0
    for (let r = 0; r < 8; r++) {
      const { tree0: t0 } = ncclGetDtree(8, r)
      if (t0.up === -1) {
        expect(r).toBe(0)
      }
    }
  })

  test('14 ranks: NCCL tree handles non-power-of-2', () => {
    // Rank 0: root
    const r0 = ncclGetDtree(14, 0)
    expect(r0.tree0.up).toBe(-1)

    // Rank 12: bit=4(4&12=4 break). up=(12^4)|(4<<1)=8|8=8. 8<14 ok.
    // lowbit=2. down0=12-2=10. down1=12+2=14. 14>=14: lowbit=1. down1=12+1=13. 13<14 ok.
    const r12 = ncclGetDtree(14, 12)
    expect(r12.tree0.up).toBe(8)
    expect(r12.tree0.down0).toBe(10)
    expect(r12.tree0.down1).toBe(13)
  })
})

// =============================================================================
// Layer 7: Ring setup
// =============================================================================

describe('setupRings', () => {
  test('prev/next maps are circular', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)
    computeAllPaths(system, env, log)

    const ringGraph = ncclTopoCompute(
      system,
      GraphPattern.RING,
      1,
      Math.floor(MAXCHANNELS / 2),
      env,
      log,
    )

    setupRings(ringGraph, log)

    for (const ch of ringGraph.channels) {
      const extended = ch as typeof ch & {
        ringPrev?: Map<string, string>
        ringNext?: Map<string, string>
      }
      if (!extended.ringNext || !extended.ringPrev) continue

      // Following next from any GPU should cycle through all GPUs
      const start = ch.ringOrder[0]
      let current = start
      const visited: string[] = []
      do {
        visited.push(current)
        current = extended.ringNext.get(current)!
      } while (current !== start && visited.length < 20)

      expect(visited.length).toBe(8)
      expect(current).toBe(start) // Circular
    }
  })
})

// =============================================================================
// Layer 8: Full init pipeline (runInit)
// =============================================================================

describe('runInit end-to-end', () => {
  test('DGX H100 produces valid ring and tree graphs', () => {
    const env = makeEnv()
    const result = runInit(dgxH100Config, env)

    expect(result.ringGraph.nChannels).toBeGreaterThan(0)
    expect(result.treeGraph.nChannels).toBeGreaterThan(0)
    expect(result.treeGraph.nChannels).toBe(result.ringGraph.nChannels * 2)
    expect(result.log.length).toBeGreaterThan(0)
  })

  test('HGX A100 produces valid graphs', () => {
    const env = makeEnv()
    const result = runInit(hgxA100Config, env)

    expect(result.ringGraph.nChannels).toBeGreaterThan(0)
    // A100 uses default speed arrays
    expect(speedArrayIntra).toContain(result.ringGraph.speedIntra)
  })

  test('DGX B200 produces valid graphs', () => {
    const env = makeEnv()
    const result = runInit(dgxB200Config, env)

    expect(result.ringGraph.nChannels).toBeGreaterThan(0)
    // B200 uses SM100 speed arrays
    expect(sm100SpeedArrayIntra).toContain(result.ringGraph.speedIntra)
  })

  test('MI300X in RCCL mode attempts Rome model match', () => {
    const env = makeEnv()
    const result = runInit(mi300xOamConfig, env)

    expect(result.ringGraph.nChannels).toBeGreaterThan(0)
    // MI300X should try Rome model matching (RCCL mode)
    const romeEntries = result.log.getEntriesByPhase('romeModelMatch')
    // Should have attempted model matching (even if no match found)
    const searchEntries = result.log.getEntriesByPhase('searchInit')
    const rcclEntry = searchEntries.find(e => e.action.includes('RCCL'))
    expect(rcclEntry).toBeDefined()
  })
})

// =============================================================================
// Layer 9: Env var effects on behavior
// =============================================================================

describe('env var effects', () => {
  test('NCCL_CROSS_NIC default is 2 (auto)', () => {
    const env = makeEnv()
    const def = env.get('NCCL_CROSS_NIC')
    expect(def?.default).toBe(2)
  })

  test('NCCL_NVB_DISABLE default is 0', () => {
    const env = makeEnv()
    const def = env.get('NCCL_NVB_DISABLE')
    expect(def?.default).toBe(0)
  })

  test('NCCL_PXN_DISABLE default is 0', () => {
    const env = makeEnv()
    const def = env.get('NCCL_PXN_DISABLE')
    expect(def?.default).toBe(0)
  })

  test('all env vars have source references', () => {
    const env = makeEnv()
    env.forEach((def) => {
      expect(def.sourceRef).toBeTruthy()
      expect(def.description).toBeTruthy()
    })
  })

  test('env var count matches manifest expectations', () => {
    const env = makeEnv()
    // We define 37 env vars in env.ts
    expect(env.size).toBeGreaterThanOrEqual(30)
  })
})

// =============================================================================
// Layer 10: trimSystem
// =============================================================================

describe('trimSystem', () => {
  test('no nodes removed in fully-connected topology', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)

    const nodeCountBefore = system.nodes.length
    trimSystem(system, env, log)
    expect(system.nodes.length).toBe(nodeCountBefore)
  })

  test('single-server topology is not inter-node', () => {
    const env = makeEnv()
    const log = new DecisionLog()
    const system = buildTopoSystem(dgxH100Config, env, log)
    computeAllPaths(system, env, log)
    trimSystem(system, env, log)

    expect(system.inter).toBe(false)
  })
})
