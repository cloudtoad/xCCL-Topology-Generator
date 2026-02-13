// =============================================================================
// Topology Builder — constructs a TopoSystem from user-specified HardwareConfig
// Replaces ncclTopoGetSystem (hardware detection) with config-driven construction.
// =============================================================================

import type {
  TopoSystem,
  TopoNode,
  TopoLink,
  HardwareConfig,
} from './types'
import {
  NodeType,
  LinkType,
  CPUArch,
  CPUVendor,
  PCIeGen,
  IntelCPUModel,
} from './types'
import {
  nvlinkBw,
  PCI_BW,
  BDW_QPI_BW,
  SKL_QPI_BW,
  SRP_QPI_BW,
  ERP_QPI_BW,
  AMD_BW,
  P9_BW,
  ARM_BW,
  ZPI_BW,
  YONGFENG_ZPI_BW,
} from './constants/nccl'
import { xgmiWidth, gpuTypeToGcnArch } from './constants/rccl'
import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'
import { getEnvValue } from './env'

// =============================================================================
// Helpers
// =============================================================================

/** Compute PCIe bandwidth scaled by generation and width relative to Gen3 x16 baseline. */
function pcieBandwidth(gen: PCIeGen, width: number): number {
  return PCI_BW * (gen / 3) * (width / 16)
}

/** Return inter-socket (QPI/UPI/xGMI/etc.) bandwidth for the given CPU config. */
function interSocketBw(arch: CPUArch, vendor: CPUVendor, model: number): number {
  if (arch === CPUArch.POWER) return P9_BW
  if (arch === CPUArch.ARM) return ARM_BW

  // x86
  if (vendor === CPUVendor.AMD) return AMD_BW
  if (vendor === CPUVendor.ZHAOXIN) return model === 1 ? YONGFENG_ZPI_BW : ZPI_BW

  // Intel — select by model (topo.cc:81-95)
  switch (model) {
    case IntelCPUModel.BDW: return BDW_QPI_BW
    case IntelCPUModel.SKL: return SKL_QPI_BW
    case IntelCPUModel.SRP: return SRP_QPI_BW
    case IntelCPUModel.ERP: return ERP_QPI_BW
    default: return BDW_QPI_BW // NCCL default fallback (topo.cc:95)
  }
}

/** Check whether a GPU type string represents an AMD GPU. */
function isAmdGpu(gpuType: string): boolean {
  return gpuType in gpuTypeToGcnArch
}

/** Human-readable CPU model label suffix. */
function cpuModelLabel(arch: CPUArch, vendor: CPUVendor, model: number): string {
  if (arch === CPUArch.POWER) return 'POWER9'
  if (arch === CPUArch.ARM) return 'ARM'
  if (vendor === CPUVendor.AMD) {
    const names: Record<number, string> = { 1: 'Rome', 2: 'Milan', 3: 'Genoa' }
    return names[model] ?? 'AMD'
  }
  if (vendor === CPUVendor.ZHAOXIN) return 'Zhaoxin'
  // Intel
  const names: Record<number, string> = { 1: 'BDW', 2: 'SKL', 3: 'SRP', 4: 'ERP' }
  return names[model] ?? 'Intel'
}

/** Format NIC speed as a human-readable label. */
function nicSpeedLabel(speedGBs: number): string {
  // Convert GB/s to Gbps (approximate: 1 GB/s ~ 8 Gbps, but network convention
  // uses 100G/200G/400G for 12.5/25/50 GB/s respectively due to encoding).
  // Use the conventional mapping: 12.5 GB/s = 100G, 25 = 200G, 50 = 400G, etc.
  const gbps = Math.round(speedGBs * 8)
  return `${gbps}G`
}

// =============================================================================
// Main export
// =============================================================================

/**
 * Build a TopoSystem from a HardwareConfig.
 *
 * This is the config-driven replacement for ncclTopoGetSystem — instead of
 * probing real hardware (PCIe tree, NVML, sysfs), we construct the topology
 * graph from the user-specified configuration object.
 */
export function buildTopoSystem(
  config: HardwareConfig,
  env: EnvConfig,
  log: DecisionLog,
): TopoSystem {
  const nodes: TopoNode[] = []
  const links: TopoLink[] = []

  // -------------------------------------------------------------------------
  // 1. Create GPU nodes
  // -------------------------------------------------------------------------
  for (let i = 0; i < config.gpu.count; i++) {
    nodes.push({
      id: `gpu-${i}`,
      type: NodeType.GPU,
      index: i,
      label: `GPU${i}`,
      gpu: {
        dev: i,
        rank: i,
        cudaCompCap: config.gpu.cudaCompCap,
        gdrSupport: config.gpu.gdrSupport,
      },
    })
  }

  log.emit(
    'topoGetSystem',
    `Created ${config.gpu.count} GPU nodes`,
    `GPU type=${config.gpu.type}, compCap=${config.gpu.cudaCompCap}`,
    'topo.cc:1423',
    [],
    { gpuCount: config.gpu.count, gpuType: config.gpu.type },
  )

  // -------------------------------------------------------------------------
  // 2. Create CPU (NUMA) nodes
  // -------------------------------------------------------------------------
  for (let i = 0; i < config.cpu.count; i++) {
    const modelStr = cpuModelLabel(config.cpu.arch, config.cpu.vendor, config.cpu.model)
    nodes.push({
      id: `cpu-${i}`,
      type: NodeType.CPU,
      index: i,
      label: `CPU${i} (${modelStr})`,
      cpu: {
        arch: config.cpu.arch,
        vendor: config.cpu.vendor,
        model: config.cpu.model,
        numaId: i,
      },
    })
  }

  // -------------------------------------------------------------------------
  // 3. Create NIC nodes
  // -------------------------------------------------------------------------
  for (let i = 0; i < config.nic.count; i++) {
    nodes.push({
      id: `nic-${i}`,
      type: NodeType.NIC,
      index: i,
      label: `NIC${i} (${nicSpeedLabel(config.nic.speed)})`,
      net: {
        dev: i,
        speed: config.nic.speed,
        gdrSupport: config.nic.gdrSupport,
        collSupport: config.nic.collSupport,
        maxChannels: 64,
      },
    })
  }

  // -------------------------------------------------------------------------
  // 4. Create NVSwitch nodes (if present)
  // -------------------------------------------------------------------------
  for (let i = 0; i < config.nvswitch.count; i++) {
    nodes.push({
      id: `nvs-${i}`,
      type: NodeType.NVS,
      index: i,
      label: `NVS${i}`,
    })
  }

  // -------------------------------------------------------------------------
  // 5. Create PCIe switch nodes
  // -------------------------------------------------------------------------
  const totalPciSwitches = config.pcie.switchesPerCPU * config.cpu.count
  for (let i = 0; i < totalPciSwitches; i++) {
    nodes.push({
      id: `pci-${i}`,
      type: NodeType.PCI,
      index: i,
      label: `PCI${i}`,
      pci: {
        gen: config.pcie.gen,
        width: config.pcie.width,
      },
    })
  }

  // -------------------------------------------------------------------------
  // 6. Create GPU interconnect links
  // -------------------------------------------------------------------------
  const compCap = config.gpu.cudaCompCap
  const pciBw = pcieBandwidth(config.pcie.gen, config.pcie.width)

  if (config.nvswitch.count > 0) {
    // ---- NVSwitch topology: every GPU connects to every NVSwitch ----
    const nvBw = nvlinkBw(compCap)
    for (let g = 0; g < config.gpu.count; g++) {
      for (let s = 0; s < config.nvswitch.count; s++) {
        // GPU -> NVSwitch
        links.push({
          fromId: `gpu-${g}`,
          toId: `nvs-${s}`,
          type: LinkType.NVL,
          bandwidth: nvBw,
        })
        // NVSwitch -> GPU
        links.push({
          fromId: `nvs-${s}`,
          toId: `gpu-${g}`,
          type: LinkType.NVL,
          bandwidth: nvBw,
        })
      }
    }

    log.emit(
      'topoGetSystem',
      'Created NVSwitch topology',
      `${config.nvswitch.count} NVSwitch(es), NVLink BW=${nvBw} GB/s per link`,
      'topo.cc',
      ['Direct NVLink mesh', 'xGMI mesh'],
      { nvswitchCount: config.nvswitch.count, nvlinkBw: nvBw },
    )
  } else if (isAmdGpu(config.gpu.type)) {
    // ---- AMD xGMI mesh: every GPU connects to every other GPU ----
    const gcnArch = gpuTypeToGcnArch[config.gpu.type]
    const xBw = xgmiWidth(gcnArch)
    for (let i = 0; i < config.gpu.count; i++) {
      for (let j = 0; j < config.gpu.count; j++) {
        if (i === j) continue
        links.push({
          fromId: `gpu-${i}`,
          toId: `gpu-${j}`,
          type: LinkType.NVL,
          bandwidth: xBw,
        })
      }
    }

    log.emit(
      'topoGetSystem',
      'Created xGMI mesh topology',
      `AMD ${config.gpu.type} (${gcnArch}), xGMI BW=${xBw} GB/s per link`,
      'topo.cc',
      ['NVSwitch topology', 'Direct NVLink mesh'],
      { gcnArch, xgmiBw: xBw },
    )
  } else if (config.gpu.nvlinksPerPair > 0) {
    // ---- NVIDIA direct NVLink mesh (no NVSwitch) ----
    const nvBw = nvlinkBw(compCap) * config.gpu.nvlinksPerPair
    for (let i = 0; i < config.gpu.count; i++) {
      for (let j = 0; j < config.gpu.count; j++) {
        if (i === j) continue
        links.push({
          fromId: `gpu-${i}`,
          toId: `gpu-${j}`,
          type: LinkType.NVL,
          bandwidth: nvBw,
        })
      }
    }

    log.emit(
      'topoGetSystem',
      'Created NVLink mesh topology',
      `${config.gpu.nvlinksPerPair} NVLink(s) per pair, BW=${nvBw} GB/s`,
      'topo.cc',
      ['NVSwitch topology', 'PCIe-only topology'],
      { nvlinksPerPair: config.gpu.nvlinksPerPair, nvlinkBw: nvBw },
    )
  } else {
    log.emit(
      'topoGetSystem',
      'No GPU-to-GPU direct links',
      'nvlinksPerPair=0 and no NVSwitches — GPUs communicate via PCIe/SYS only',
      'topo.cc',
      ['NVLink mesh', 'NVSwitch topology'],
    )
  }

  // -------------------------------------------------------------------------
  // 7. GPU <-> PCIe switch <-> CPU links (using numaMapping)
  //    Route GPUs through PCIe switches when switches are present.
  // -------------------------------------------------------------------------
  const switchesPerCpu = config.pcie.switchesPerCPU
  for (let g = 0; g < config.gpu.count; g++) {
    const numaIdx = config.numaMapping[g] ?? 0

    if (totalPciSwitches > 0) {
      // Route through PCIe switch: GPU -> PCI -> CPU
      // Assign GPUs to switches: GPUs on CPU N use switches [N*switchesPerCpu .. (N+1)*switchesPerCpu)
      const gpuIndexOnCpu = config.numaMapping.slice(0, g).filter((n) => n === numaIdx).length
      const pciIdx = numaIdx * switchesPerCpu + (gpuIndexOnCpu % switchesPerCpu)

      // GPU <-> PCI switch
      links.push({ fromId: `gpu-${g}`, toId: `pci-${pciIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      links.push({ fromId: `pci-${pciIdx}`, toId: `gpu-${g}`, type: LinkType.PCI, bandwidth: pciBw })

      // PCI switch <-> CPU (only add if not already added)
      if (!links.some((l) => l.fromId === `pci-${pciIdx}` && l.toId === `cpu-${numaIdx}`)) {
        links.push({ fromId: `pci-${pciIdx}`, toId: `cpu-${numaIdx}`, type: LinkType.PCI, bandwidth: pciBw })
        links.push({ fromId: `cpu-${numaIdx}`, toId: `pci-${pciIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      }
    } else {
      // No PCIe switches: direct GPU <-> CPU
      links.push({ fromId: `gpu-${g}`, toId: `cpu-${numaIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      links.push({ fromId: `cpu-${numaIdx}`, toId: `gpu-${g}`, type: LinkType.PCI, bandwidth: pciBw })
    }
  }

  // -------------------------------------------------------------------------
  // 8. NIC <-> PCIe switch <-> CPU links
  //    NICs follow the same NUMA mapping as GPUs (rail-optimized: NIC i
  //    pairs with GPU i). When there are more NICs than GPUs, extras are
  //    distributed round-robin.
  // -------------------------------------------------------------------------
  for (let n = 0; n < config.nic.count; n++) {
    // Use GPU's NUMA mapping if NIC index has a corresponding GPU, else round-robin
    const cpuIdx = n < config.numaMapping.length
      ? config.numaMapping[n]
      : n % config.cpu.count

    if (totalPciSwitches > 0) {
      // Assign NIC to same PCIe switch as its paired GPU
      const nicIndexOnCpu = config.numaMapping.slice(0, n).filter((c) => c === cpuIdx).length
      const pciIdx = cpuIdx * switchesPerCpu + (nicIndexOnCpu % switchesPerCpu)

      // NIC <-> PCI switch
      links.push({ fromId: `nic-${n}`, toId: `pci-${pciIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      links.push({ fromId: `pci-${pciIdx}`, toId: `nic-${n}`, type: LinkType.PCI, bandwidth: pciBw })

      // PCI switch <-> CPU (add if not already present)
      if (!links.some((l) => l.fromId === `pci-${pciIdx}` && l.toId === `cpu-${cpuIdx}`)) {
        links.push({ fromId: `pci-${pciIdx}`, toId: `cpu-${cpuIdx}`, type: LinkType.PCI, bandwidth: pciBw })
        links.push({ fromId: `cpu-${cpuIdx}`, toId: `pci-${pciIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      }
    } else {
      // No PCIe switches: direct NIC <-> CPU
      links.push({ fromId: `nic-${n}`, toId: `cpu-${cpuIdx}`, type: LinkType.PCI, bandwidth: pciBw })
      links.push({ fromId: `cpu-${cpuIdx}`, toId: `nic-${n}`, type: LinkType.PCI, bandwidth: pciBw })
    }
  }

  // -------------------------------------------------------------------------
  // 9. CPU <-> CPU links (inter-socket)
  // -------------------------------------------------------------------------
  const sysBw = interSocketBw(config.cpu.arch, config.cpu.vendor, config.cpu.model)
  for (let i = 0; i < config.cpu.count; i++) {
    for (let j = 0; j < config.cpu.count; j++) {
      if (i === j) continue
      links.push({
        fromId: `cpu-${i}`,
        toId: `cpu-${j}`,
        type: LinkType.SYS,
        bandwidth: sysBw,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 10. Build nodesByType index
  // -------------------------------------------------------------------------
  const nodesByType = new Map<NodeType, TopoNode[]>()
  for (const node of nodes) {
    let group = nodesByType.get(node.type)
    if (!group) {
      group = []
      nodesByType.set(node.type, group)
    }
    group.push(node)
  }

  // -------------------------------------------------------------------------
  // 11. Compute maxBw and totalBw from all links
  // -------------------------------------------------------------------------
  let maxBw = 0
  let totalBw = 0
  for (const link of links) {
    if (link.bandwidth > maxBw) {
      maxBw = link.bandwidth
    }
    totalBw += link.bandwidth
  }

  // -------------------------------------------------------------------------
  // 12. Assemble the TopoSystem
  // -------------------------------------------------------------------------
  const system: TopoSystem = {
    nodes,
    links,
    paths: new Map(),
    maxBw,
    totalBw,
    inter: false, // Single-server topology
    nodesByType,
  }

  log.emit(
    'topoGetSystem',
    `Topology system built: ${nodes.length} nodes, ${links.length} links`,
    `maxBw=${maxBw} GB/s, totalBw=${totalBw.toFixed(1)} GB/s`,
    'topo.cc:1423',
    [],
    {
      nodeCount: nodes.length,
      linkCount: links.length,
      maxBw,
      totalBw,
    },
  )

  return system
}
