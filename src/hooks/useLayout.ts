import { useMemo } from 'react'
import type { TopoSystem } from '../engine/types'
import { NodeType } from '../engine/types'
import { useUIStore, type LayoutMode } from '../store/ui-store'

export interface LayoutResult {
  nodePositions: Map<string, [number, number, number]>
}

/**
 * Compute 3D positions for all nodes in a topology system.
 *
 * Three conceptual planes intersect at the GPU/PCIe area:
 *   - PCIe plane (vertical, z=0):    CPU → PCIe → GPU
 *   - NVLink plane (perpendicular, -Z): NVSwitch ↔ GPU
 *   - NIC plane (perpendicular, +Z):    NIC ↔ PCIe switch (opposite NVLink)
 *
 * Layout modes:
 *   - "flat":  All collapsed onto XY (z=0). NICs grouped under their PCIe switch.
 *   - "3d":    PCIe plane on z=0, NVLink extends -Z, NICs extend +Z.
 */
export function useLayout(system: TopoSystem | null): LayoutResult {
  const layoutMode = useUIStore((s) => s.layoutMode)

  return useMemo(() => {
    const nodePositions = new Map<string, [number, number, number]>()

    if (!system) return { nodePositions }

    const isMultiNode = system.nodes.some(n => n.id.startsWith('s0-') || n.id.startsWith('s1-'))

    if (isMultiNode) {
      layoutMultiNode(system, nodePositions, layoutMode)
    } else {
      layoutSingleServer(system, nodePositions, 0, 0, layoutMode)
    }

    return { nodePositions }
  }, [system, layoutMode])
}

/**
 * Build a map from NIC id to the PCIe switch id it's attached to,
 * by inspecting the system's links.
 */
function buildNicToPciMap(system: TopoSystem, filterPrefix?: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const link of system.links) {
    const fromIsPci = link.fromId.includes('pci-')
    const toIsNic = link.toId.includes('nic-')
    const toIsPci = link.toId.includes('pci-')
    const fromIsNic = link.fromId.includes('nic-')

    if (fromIsNic && toIsPci) {
      if (!filterPrefix || link.fromId.startsWith(filterPrefix)) {
        map.set(link.fromId, link.toId)
      }
    } else if (fromIsPci && toIsNic) {
      if (!filterPrefix || link.toId.startsWith(filterPrefix)) {
        map.set(link.toId, link.fromId)
      }
    }
  }
  return map
}

function layoutSingleServer(
  system: TopoSystem,
  positions: Map<string, [number, number, number]>,
  offsetX: number,
  offsetY: number,
  layoutMode: LayoutMode,
  filterPrefix?: string,
): void {
  const filter = (nodes: readonly { id: string }[]) =>
    filterPrefix ? nodes.filter(n => n.id.startsWith(filterPrefix)) : nodes

  const gpus = filter(system.nodesByType.get(NodeType.GPU) ?? [])
  const cpus = filter(system.nodesByType.get(NodeType.CPU) ?? [])
  const nics = filter(system.nodesByType.get(NodeType.NIC) ?? [])
  const nvs = filter(system.nodesByType.get(NodeType.NVS) ?? [])
  const pcis = filter(system.nodesByType.get(NodeType.PCI) ?? [])

  const gpuCount = gpus.length
  const gpuSpacing = 1.2
  const gpuStartX = -((gpuCount - 1) * gpuSpacing) / 2 + offsetX

  // --- GPU row: the intersection of all planes ---
  gpus.forEach((node, i) => {
    positions.set(node.id, [gpuStartX + i * gpuSpacing, offsetY, 0])
  })

  // --- PCIe plane (vertical, z=0): CPU → PCIe → GPU ---

  // PCIe switches: above GPUs
  const pciCount = pcis.length
  const pciSpacing = gpuCount > 0 ? ((gpuCount - 1) * gpuSpacing) / Math.max(pciCount - 1, 1) : 1
  const pciStartX = pciCount > 1 ? gpuStartX : offsetX
  const pciPositions: [number, number, number][] = []
  pcis.forEach((node, i) => {
    const pos: [number, number, number] = [pciStartX + i * pciSpacing, offsetY + 1.2, 0]
    pciPositions.push(pos)
    positions.set(node.id, pos)
  })

  // CPUs: top of PCIe tree
  const cpuCount = cpus.length
  const cpuSpacing2 = gpuCount > 0 ? ((gpuCount - 1) * gpuSpacing) / Math.max(cpuCount - 1, 1) : 3
  const cpuStartX = cpuCount > 1 ? gpuStartX : offsetX
  cpus.forEach((node, i) => {
    positions.set(node.id, [cpuStartX + i * cpuSpacing2, offsetY + 2.4, 0])
  })

  // --- NVLink/xGMI plane (perpendicular, -Z from GPUs) ---
  const nvsCount = nvs.length
  const nvsSpacing = gpuCount > 0 ? ((gpuCount - 1) * gpuSpacing) / Math.max(nvsCount - 1, 1) : 2
  const nvsStartX = nvsCount > 1 ? gpuStartX : offsetX

  if (layoutMode === '3d') {
    nvs.forEach((node, i) => {
      positions.set(node.id, [nvsStartX + i * nvsSpacing, offsetY, -2.5])
    })
  } else {
    // Flat: NVSwitches slightly above GPUs
    nvs.forEach((node, i) => {
      positions.set(node.id, [nvsStartX + i * nvsSpacing, offsetY + 0.6, 0])
    })
  }

  // --- NIC plane (perpendicular, +Z from PCIe, opposite NVLink) ---
  // Group NICs by their parent PCIe switch, position under that switch
  const nicToPci = buildNicToPciMap(system, filterPrefix)

  // Group NICs by PCIe switch
  const nicsByPci = new Map<string, { id: string }[]>()
  const unattachedNics: { id: string }[] = []

  for (const nic of nics) {
    const pciId = nicToPci.get(nic.id)
    if (pciId) {
      let group = nicsByPci.get(pciId)
      if (!group) { group = []; nicsByPci.set(pciId, group) }
      group.push(nic)
    } else {
      unattachedNics.push(nic)
    }
  }

  if (layoutMode === '3d') {
    // 3D: NICs extend into +Z at the same Y as their parent PCIe switch
    // (perpendicular to the PCIe plane)
    for (const pci of pcis) {
      const pciPos = positions.get(pci.id)
      if (!pciPos) continue
      const group = nicsByPci.get(pci.id) ?? []
      const groupSpacing = 0.8
      const groupStartX = pciPos[0] - ((group.length - 1) * groupSpacing) / 2
      group.forEach((nic, j) => {
        positions.set(nic.id, [groupStartX + j * groupSpacing, pciPos[1], 2.5])
      })
    }
    // Unattached NICs: spread at PCIe height
    const pciY = offsetY + 1.2
    unattachedNics.forEach((nic, i) => {
      positions.set(nic.id, [gpuStartX + i * gpuSpacing, pciY, 2.5])
    })
  } else {
    // Flat: NICs below GPUs, grouped under their parent PCIe switch
    for (const pci of pcis) {
      const pciPos = positions.get(pci.id)
      if (!pciPos) continue
      const group = nicsByPci.get(pci.id) ?? []
      const groupSpacing = 0.8
      const groupStartX = pciPos[0] - ((group.length - 1) * groupSpacing) / 2
      group.forEach((nic, j) => {
        positions.set(nic.id, [groupStartX + j * groupSpacing, offsetY - 1.5, 0])
      })
    }
    // Unattached NICs: spread evenly below
    const unattachedSpacing = gpuCount > 0 ? ((gpuCount - 1) * gpuSpacing) / Math.max(unattachedNics.length - 1, 1) : 1.2
    const unattachedStartX = unattachedNics.length > 1 ? gpuStartX : offsetX
    unattachedNics.forEach((nic, i) => {
      positions.set(nic.id, [unattachedStartX + i * unattachedSpacing, offsetY - 1.5, 0])
    })
  }
}

function layoutMultiNode(
  system: TopoSystem,
  positions: Map<string, [number, number, number]>,
  layoutMode: LayoutMode,
): void {
  const serverPrefixes = new Set<string>()
  for (const node of system.nodes) {
    const match = node.id.match(/^(s\d+-)/)
    if (match) serverPrefixes.add(match[1])
  }

  const servers = Array.from(serverPrefixes).sort()
  const serverCount = servers.length

  const serverSpacing = 14
  const totalWidth = (serverCount - 1) * serverSpacing
  const startX = -totalWidth / 2

  for (let s = 0; s < servers.length; s++) {
    const prefix = servers[s]
    const sOffsetX = startX + s * serverSpacing
    layoutSingleServer(system, positions, sOffsetX, 0, layoutMode, prefix)
  }

  // NET switches: below all servers
  const netNodes = system.nodesByType.get(NodeType.NET) ?? []
  const netCount = netNodes.length
  const netSpacing = netCount > 1 ? totalWidth / (netCount - 1) : 0
  const netStartX = netCount > 1 ? -totalWidth / 2 : 0

  netNodes.forEach((node, i) => {
    positions.set(node.id, [netStartX + i * netSpacing, -4, 0])
  })
}
