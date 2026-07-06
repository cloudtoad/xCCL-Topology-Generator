// =============================================================================
// Queue Pairs (QPs) — the network transport under the channel rings
//
// After the graphs are chosen, ncclTransportP2pSetup (transport.cc:123) walks
// each channel's send/recv peers (one connector per direction per channel,
// transport.cc:25-26) and connects them. Intra-node peers use P2P/NVLink/SHM;
// inter-node peers use the IB transport, which creates
// NCCL_IB_QPS_PER_CONNECTION queue pairs per connection
// (default 1 — net_ib/connect.cc:60, ncclParamIbQpsPerConn()).
//
// A channel ring gives every node exactly ONE network send and ONE network
// recv — i.e. one inter-node edge leaving each node. So for a cluster:
//
//     connections = nChannels × nNodes          (one edge per node per channel)
//     QPs         = connections × qpsPerConn
//
// Each QP record here models one RC connection stream between the exit GPU's
// NIC and the entry GPU's NIC (physically, ibv_create_qp runs on BOTH ends and
// the two QPs are bound together — we model the bound pair as one record).
// =============================================================================

import type { ClusterTopology, InterNodeHop } from './cluster'
import { allInterNodeHops } from './cluster'

/** One IB connection stream carrying a channel's inter-node traffic on a rail. */
export interface QueuePair {
  id: string // stable id, e.g. "ch1-rail3-s0g2>s1g3-q0"
  channel: number // which channel ring this QP serves
  rail: number // leaf switch (net-<rail>) it rides
  nic: number // per-server NIC index on both ends (crossNic=0)
  fromId: string // exit GPU (sender side)
  toId: string // entry GPU (receiver side)
  qpIndex: number // 0..qpsPerConnection-1 within this connection
}

export interface QPPlan {
  nChannels: number
  qpsPerConnection: number
  qps: QueuePair[]
  /** Total = nChannels × nNodes × qpsPerConnection (0 for a single server). */
  total: number
}

/** NCCL_IB_QPS_PER_CONNECTION default (net_ib/connect.cc:60). */
export const DEFAULT_QPS_PER_CONNECTION = 1

function shortId(id: string): string {
  return id.replace(/^s(\d+)-gpu-(\d+)$/, 's$1g$2')
}

function hopQpId(hop: InterNodeHop, qpIndex: number): string {
  return `ch${hop.channel}-rail${hop.rail}-${shortId(hop.fromId)}>${shortId(hop.toId)}-q${qpIndex}`
}

/**
 * Build the QP plan for a cluster: one connection per inter-node edge of every
 * channel ring, split into qpsPerConnection QPs.
 */
export function buildQPs(
  topo: ClusterTopology,
  qpsPerConnection: number = DEFAULT_QPS_PER_CONNECTION,
): QPPlan {
  const qps: QueuePair[] = []

  for (const hop of allInterNodeHops(topo)) {
    for (let q = 0; q < qpsPerConnection; q++) {
      qps.push({
        id: hopQpId(hop, q),
        channel: hop.channel,
        rail: hop.rail,
        nic: hop.nic,
        fromId: hop.fromId,
        toId: hop.toId,
        qpIndex: q,
      })
    }
  }

  return {
    nChannels: topo.nChannels,
    qpsPerConnection,
    qps,
    total: qps.length,
  }
}

/** QP counts grouped by the rail (leaf switch) they ride. */
export function qpsByRail(plan: QPPlan): Map<number, number> {
  const byRail = new Map<number, number>()
  for (const qp of plan.qps) byRail.set(qp.rail, (byRail.get(qp.rail) ?? 0) + 1)
  return byRail
}

/** QP counts grouped by the server (node) that originates them. */
export function qpsBySourceServer(plan: QPPlan): Map<number, number> {
  const byServer = new Map<number, number>()
  for (const qp of plan.qps) {
    const m = qp.fromId.match(/^s(\d+)-/)
    const server = m ? parseInt(m[1], 10) : -1
    byServer.set(server, (byServer.get(server) ?? 0) + 1)
  }
  return byServer
}
