// =============================================================================
// Network attachment — NET nodes for inter-node search (the local-topo model)
//
// NCCL's multi-node search is NOT a big multi-node graph search: each node
// searches its OWN topology with NET nodes attached (search.cc:816-830:
// "Ring: NET n -> GPU a -> ... -> GPU x -> NET n (or m if crossNic)"), and
// nodes are stitched later in connect. A NET node represents the network
// beyond a NIC; its bandwidth is the NIC's line rate.
//
// This models the user's "2-node, NICx↔NICx" fabric: NIC n on this node wires
// to NIC n on the peer, so NET n is simply the far end of rail n.
// =============================================================================

import type { TopoSystem, TopoNode } from './types'
import { NodeType, LinkType } from './types'
import { DecisionLog } from './decision-log'

/**
 * Attach one NET node per NIC (rail-paired, back-to-back) and mark the system
 * inter-node. Call BEFORE computeAllPaths so NET participates in SPFA.
 */
export function attachRailNetwork(system: TopoSystem, log: DecisionLog): void {
  const nics = system.nodesByType.get(NodeType.NIC) ?? []
  const nets: TopoNode[] = []

  for (const nic of nics) {
    const speed = nic.net?.speed ?? 12
    const net: TopoNode = {
      id: `net-${nic.index}`,
      type: NodeType.NET,
      index: nic.index,
      label: `NET${nic.index}`,
      net: {
        dev: nic.index,
        speed,
        gdrSupport: nic.net?.gdrSupport ?? false,
        collSupport: nic.net?.collSupport ?? false,
        maxChannels: 64,
      },
    }
    nets.push(net)
    system.nodes.push(net)
    system.links.push(
      { fromId: nic.id, toId: net.id, type: LinkType.NET, bandwidth: speed },
      { fromId: net.id, toId: nic.id, type: LinkType.NET, bandwidth: speed },
    )
  }

  system.nodesByType.set(NodeType.NET, nets)
  system.inter = true

  log.emit(
    'topoGetSystem',
    `Attached ${nets.length} NET node(s) — rail-paired network (NICx↔NICx)`,
    'Each NET is the far end of its NIC\'s rail; search runs on the local topo ' +
      'with NET entry/exit (search.cc:816-830), nodes stitch in connect',
    'search.cc:816-830',
    [],
    { netCount: nets.length },
  )
}
