// =============================================================================
// Multi-Node Topology — creates multi-server scalable unit topologies
//
// Replicates a single-server template across multiple servers and connects
// them via inter-node network links. Supports:
//   - Rail-optimized topology (NIC i on server j connects to switch i)
//   - Fat-tree topology (any NIC can reach any other NIC)
// =============================================================================

import type { TopoSystem, TopoNode, TopoLink, HardwareConfig, SUConfig } from './types'
import { NodeType, LinkType } from './types'
import { buildTopoSystem } from './topo'
import { DecisionLog } from './decision-log'
import type { EnvConfig } from './env'

// =============================================================================
// Types
// =============================================================================

interface ServerCluster {
  serverIndex: number
  system: TopoSystem
  gpuOffset: number     // Global GPU index offset
  nicOffset: number     // Global NIC index offset
  nodeIdPrefix: string  // e.g. "s0-" for server 0
}

// =============================================================================
// createMultiNodeTopology
//
// Build a multi-server topology by:
//   1. Creating N copies of the server template
//   2. Remapping all node IDs with server prefix
//   3. Adding NET (network switch) nodes
//   4. Connecting each server's NICs to network switches
//   5. Setting system.inter = true
// =============================================================================

export function createMultiNodeTopology(
  config: HardwareConfig,
  suConfig: SUConfig,
  env: EnvConfig,
  log: DecisionLog,
): TopoSystem {
  const { serverCount, railCount, networkType } = suConfig

  if (serverCount <= 1) {
    // Single server — just build normally
    return buildTopoSystem(config, env, log)
  }

  log.emit(
    'topoGetSystem',
    `Building multi-node topology: ${serverCount} servers`,
    `Rails: ${railCount}, Network: ${networkType}`,
    'multi-node.ts',
    [],
    { serverCount, railCount, networkType },
  )

  const allNodes: TopoNode[] = []
  const allLinks: TopoLink[] = []
  const servers: ServerCluster[] = []

  // -------------------------------------------------------------------------
  // 1. Create server clusters
  // -------------------------------------------------------------------------
  for (let s = 0; s < serverCount; s++) {
    const prefix = `s${s}-`
    const serverLog = new DecisionLog() // Isolated log per server
    const serverSystem = buildTopoSystem(config, env, serverLog)

    // Remap node IDs with server prefix
    const remappedNodes = serverSystem.nodes.map(node => ({
      ...node,
      id: `${prefix}${node.id}`,
      label: node.label ? `S${s}:${node.label}` : undefined,
      // Deep copy sub-objects
      gpu: node.gpu ? { ...node.gpu, rank: node.gpu.rank + s * config.gpu.count } : undefined,
      net: node.net ? { ...node.net } : undefined,
      cpu: node.cpu ? { ...node.cpu } : undefined,
      pci: node.pci ? { ...node.pci } : undefined,
    }))

    const remappedLinks = serverSystem.links.map(link => ({
      ...link,
      fromId: `${prefix}${link.fromId}`,
      toId: `${prefix}${link.toId}`,
    }))

    allNodes.push(...remappedNodes)
    allLinks.push(...remappedLinks)

    servers.push({
      serverIndex: s,
      system: serverSystem,
      gpuOffset: s * config.gpu.count,
      nicOffset: s * config.nic.count,
      nodeIdPrefix: prefix,
    })
  }

  // -------------------------------------------------------------------------
  // 2. Create network switch nodes
  // -------------------------------------------------------------------------
  const nSwitches = networkType === 'rail-optimized' ? railCount : 1

  for (let sw = 0; sw < nSwitches; sw++) {
    allNodes.push({
      id: `net-${sw}`,
      type: NodeType.NET,
      index: sw,
      label: networkType === 'rail-optimized' ? `Rail${sw}` : 'FatTree',
    })
  }

  log.emit(
    'topoGetSystem',
    `Created ${nSwitches} network switch(es) (${networkType})`,
    networkType === 'rail-optimized'
      ? `Rail-optimized: NIC i on each server connects to Rail i`
      : 'Fat-tree: all NICs connect to a single logical switch',
    'multi-node.ts',
    [],
    { nSwitches, networkType },
  )

  // -------------------------------------------------------------------------
  // 3. Connect NICs to network switches
  // -------------------------------------------------------------------------
  const nicSpeed = config.nic.speed

  for (const server of servers) {
    for (let n = 0; n < config.nic.count; n++) {
      const nicId = `${server.nodeIdPrefix}nic-${n}`

      if (networkType === 'rail-optimized') {
        // Rail-optimized: NIC n connects to switch (n % railCount)
        const switchIdx = n % railCount
        const switchId = `net-${switchIdx}`

        allLinks.push(
          { fromId: nicId, toId: switchId, type: LinkType.NET, bandwidth: nicSpeed },
          { fromId: switchId, toId: nicId, type: LinkType.NET, bandwidth: nicSpeed },
        )
      } else {
        // Fat-tree: all NICs connect to the single switch
        const switchId = 'net-0'
        allLinks.push(
          { fromId: nicId, toId: switchId, type: LinkType.NET, bandwidth: nicSpeed },
          { fromId: switchId, toId: nicId, type: LinkType.NET, bandwidth: nicSpeed },
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Build nodesByType index
  // -------------------------------------------------------------------------
  const nodesByType = new Map<NodeType, TopoNode[]>()
  for (const node of allNodes) {
    let group = nodesByType.get(node.type)
    if (!group) {
      group = []
      nodesByType.set(node.type, group)
    }
    group.push(node)
  }

  // -------------------------------------------------------------------------
  // 5. Compute maxBw and totalBw
  // -------------------------------------------------------------------------
  let maxBw = 0
  let totalBw = 0
  for (const link of allLinks) {
    if (link.bandwidth > maxBw) maxBw = link.bandwidth
    totalBw += link.bandwidth
  }

  // -------------------------------------------------------------------------
  // 6. Assemble multi-node TopoSystem
  // -------------------------------------------------------------------------
  const system: TopoSystem = {
    nodes: allNodes,
    links: allLinks,
    paths: new Map(),
    maxBw,
    totalBw,
    inter: true, // Multi-node has inter-node connections
    nodesByType,
  }

  log.emit(
    'topoGetSystem',
    `Multi-node topology built: ${allNodes.length} nodes, ${allLinks.length} links, ${serverCount} servers`,
    `GPUs: ${(nodesByType.get(NodeType.GPU) ?? []).length}, NICs: ${(nodesByType.get(NodeType.NIC) ?? []).length}, NET switches: ${nSwitches}`,
    'multi-node.ts',
    [],
    {
      totalNodes: allNodes.length,
      totalLinks: allLinks.length,
      serverCount,
      maxBw,
      totalBw,
    },
  )

  return system
}
