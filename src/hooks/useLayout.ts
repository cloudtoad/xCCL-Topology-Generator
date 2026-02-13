import { useMemo } from 'react'
import type { TopoSystem } from '../engine/types'
import { NodeType } from '../engine/types'
import { useUIStore } from '../store/ui-store'

export interface LayoutResult {
  nodePositions: Map<string, [number, number, number]>
  nodeRotations: Map<string, number> // Y-axis rotation in radians
}

/**
 * Compute 2D positions for all nodes in a topology system.
 *
 * Layout is on the XZ ground plane (y ≈ 0), viewed from an angle.
 * Rows from camera → horizon: NICs(+Z) → PCIe → GPUs → NVSwitch(-Z).
 *
 * Scale views:
 *   - "cluster": Full multi-node radial layout
 *   - "node":    Single server centered at origin
 */
export function useLayout(system: TopoSystem | null): LayoutResult {
  const scaleView = useUIStore((s) => s.scaleView)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const showCPUs = useUIStore((s) => s.showCPUs)

  return useMemo(() => {
    const nodePositions = new Map<string, [number, number, number]>()
    const nodeRotations = new Map<string, number>()

    if (!system) return { nodePositions, nodeRotations }

    const isMultiNode = system.nodes.some(n => n.id.startsWith('s0-') || n.id.startsWith('s1-'))

    if (isMultiNode) {
      if (scaleView === 'node') {
        // Node view: lay out only the selected server at origin
        const prefix = `s${selectedServer ?? 0}-`
        layoutSingleServer(system, nodePositions, 0, 0, showCPUs, prefix)
      } else {
        layoutMultiNode(system, nodePositions, nodeRotations, showCPUs)
      }
    } else {
      layoutSingleServer(system, nodePositions, 0, 0, showCPUs)
    }

    return { nodePositions, nodeRotations }
  }, [system, scaleView, selectedServer, showCPUs])
}

/**
 * Build a map from child node id to the PCIe switch id it's attached to,
 * by inspecting the system's links.
 */
function buildChildToPciMap(
  system: TopoSystem,
  childTag: string,
  filterPrefix?: string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const link of system.links) {
    const fromIsPci = link.fromId.includes('pci-')
    const toIsChild = link.toId.includes(childTag)
    const toIsPci = link.toId.includes('pci-')
    const fromIsChild = link.fromId.includes(childTag)

    if (fromIsChild && toIsPci) {
      if (!filterPrefix || link.fromId.startsWith(filterPrefix)) {
        map.set(link.fromId, link.toId)
      }
    } else if (fromIsPci && toIsChild) {
      if (!filterPrefix || link.toId.startsWith(filterPrefix)) {
        map.set(link.toId, link.fromId)
      }
    }
  }
  return map
}

/** Group nodes by their parent PCIe switch id. */
function groupByPci(
  nodes: readonly { id: string }[],
  childToPci: Map<string, string>,
): { byPci: Map<string, { id: string }[]>; unattached: { id: string }[] } {
  const byPci = new Map<string, { id: string }[]>()
  const unattached: { id: string }[] = []
  for (const node of nodes) {
    const pciId = childToPci.get(node.id)
    if (pciId) {
      let group = byPci.get(pciId)
      if (!group) { group = []; byPci.set(pciId, group) }
      group.push(node)
    } else {
      unattached.push(node)
    }
  }
  return { byPci, unattached }
}

/**
 * PCIe-centric layout on XZ ground plane.
 * Chain from camera → horizon: NICs(z=3) → PCIe(z=1) → GPUs(z=-1) → NVSwitch(z=-3)
 * Uniform row gap of 2 units.
 * Alignment: GPUs & NICs share X spacing, PCIe & NVSwitch share X spacing.
 */
function layoutSingleServer(
  system: TopoSystem,
  positions: Map<string, [number, number, number]>,
  offsetX: number,
  offsetY: number,
  showCPUs: boolean,
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
  const pciCount = pcis.length

  const rowGap = 2
  const childSpacing = gpuSpacing          // GPUs and NICs use the same spacing

  const gpuToPci = buildChildToPciMap(system, 'gpu-', filterPrefix)
  const nicToPci = buildChildToPciMap(system, 'nic-', filterPrefix)
  const { byPci: gpusByPci, unattached: unattachedGpus } = groupByPci(gpus, gpuToPci)
  const { byPci: nicsByPci, unattached: unattachedNics } = groupByPci(nics, nicToPci)

  // PCIe spacing: wide enough for the largest child group (GPUs or NICs)
  const maxChildrenPerPci = Math.max(1,
    ...Array.from(gpusByPci.values()).map(g => g.length),
    ...Array.from(nicsByPci.values()).map(g => g.length))
  const pciGroupWidth = (maxChildrenPerPci - 1) * childSpacing
  const pciSpacing = pciGroupWidth + 1.5
  const pciStartX = -((pciCount - 1) * pciSpacing) / 2 + offsetX

  // Row Z positions (uniform gap)
  const zNIC = rowGap * 1.5
  const zPCI = rowGap * 0.5
  const zGPU = -rowGap * 0.5
  const zNVS = -rowGap * 1.5

  // PCIe switches
  pcis.forEach((node, i) => {
    positions.set(node.id, [pciStartX + i * pciSpacing, 0.01, zPCI])
  })

  // NVSwitches — same X spacing as PCIe, centered over the same width
  const nvsCount = nvs.length
  const nvsStartX = -((nvsCount - 1) * pciSpacing) / 2 + offsetX
  nvs.forEach((node, i) => {
    positions.set(node.id, [nvsStartX + i * pciSpacing, 0.01, zNVS])
  })

  // GPUs grouped under parent PCIe — uses childSpacing
  for (const pci of pcis) {
    const pciPos = positions.get(pci.id)
    if (!pciPos) continue
    const group = gpusByPci.get(pci.id) ?? []
    const startX = pciPos[0] - ((group.length - 1) * childSpacing) / 2
    group.forEach((gpu, j) => {
      positions.set(gpu.id, [startX + j * childSpacing, 0.01, zGPU])
    })
  }
  unattachedGpus.forEach((gpu, i) => {
    positions.set(gpu.id, [offsetX + i * childSpacing, 0.01, zGPU])
  })

  // NICs grouped under parent PCIe — same childSpacing so they align with GPUs
  for (const pci of pcis) {
    const pciPos = positions.get(pci.id)
    if (!pciPos) continue
    const group = nicsByPci.get(pci.id) ?? []
    const startX = pciPos[0] - ((group.length - 1) * childSpacing) / 2
    group.forEach((nic, j) => {
      positions.set(nic.id, [startX + j * childSpacing, 0.01, zNIC])
    })
  }
  unattachedNics.forEach((nic, i) => {
    positions.set(nic.id, [offsetX + i * childSpacing, 0.01, zNIC])
  })

  // CPUs (only if toggled on)
  if (showCPUs) {
    const cpuCount = cpus.length
    const totalWidth = (pciCount - 1) * pciSpacing
    const cpuSpacing2 = totalWidth > 0 ? totalWidth / Math.max(cpuCount - 1, 1) : 3
    const cpuStartX = cpuCount > 1 ? pciStartX : offsetX
    cpus.forEach((node, i) => {
      positions.set(node.id, [cpuStartX + i * cpuSpacing2, 0.01, zNVS - rowGap])
    })
  }
}

/**
 * Radial multi-node layout:
 *   - NET switch circles in a small ring at center
 *   - Each server preserves its single-server layout
 *   - Servers are placed around a circle and rotated so NICs (+Z side)
 *     face the center (toward NET switches), NVSwitches face outward
 */
function layoutMultiNode(
  system: TopoSystem,
  positions: Map<string, [number, number, number]>,
  rotations: Map<string, number>,
  showCPUs: boolean,
): void {
  const serverPrefixes = new Set<string>()
  for (const node of system.nodes) {
    const match = node.id.match(/^(s\d+-)/)
    if (match) serverPrefixes.add(match[1])
  }

  const servers = Array.from(serverPrefixes).sort()
  const serverCount = servers.length

  // --- NET switches: circle at center ---
  const netNodes = system.nodesByType.get(NodeType.NET) ?? []
  const netCount = netNodes.length
  const netRadius = Math.max(1.0, netCount * 0.5)

  netNodes.forEach((node, i) => {
    const angle = (i / Math.max(netCount, 1)) * Math.PI * 2
    positions.set(node.id, [
      netRadius * Math.cos(angle),
      0,
      netRadius * Math.sin(angle),
    ])
  })

  // --- Calculate circle radius so servers don't overlap ---
  // Server width is determined by the GPU row spread
  const gpusPerServer = ((system.nodesByType.get(NodeType.GPU) ?? []).length) / serverCount
  const serverWidth = Math.max((gpusPerServer - 1) * 1.2, 2)
  const gap = 4 // spacing between adjacent servers
  const circumference = serverCount * (serverWidth + gap)
  const serverRadius = Math.max(circumference / (2 * Math.PI), netRadius + 8)

  // --- Place each server around the circle ---
  for (let s = 0; s < serverCount; s++) {
    const prefix = servers[s]
    const angle = (s / serverCount) * Math.PI * 2

    // 1. Compute single-server layout at origin
    const tempPositions = new Map<string, [number, number, number]>()
    layoutSingleServer(system, tempPositions, 0, 0, showCPUs, prefix)

    // 2. Rotate around Y axis so +Z (NIC side) faces center
    //    Rotation angle: -(angle + π/2)
    const rotAngle = -(angle + Math.PI / 2)
    const cosA = Math.cos(rotAngle)
    const sinA = Math.sin(rotAngle)

    // 3. Server center on the circle
    const cx = serverRadius * Math.cos(angle)
    const cz = serverRadius * Math.sin(angle)

    // 4. Transform each position: rotate then translate
    for (const [id, pos] of tempPositions) {
      const [x, y, z] = pos
      positions.set(id, [
        x * cosA + z * sinA + cx,
        y,
        -x * sinA + z * cosA + cz,
      ])
      rotations.set(id, rotAngle)
    }
  }
}
