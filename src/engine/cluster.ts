// =============================================================================
// Rail-optimized cluster construction — TRUE multi-node channel rings
//
// In a multi-node cluster, each NCCL channel is ONE ring spanning ALL GPUs:
// inside a server the ring chains through every GPU over NVLink, then exits
// through a NIC to the next server, chains through all of ITS GPUs, and so on
// until it wraps back to the start.
//
// Source grounding (NCCL 2.30.7, ref/src/nccl):
//   - search.cc:837  — inter-node RING sets backToNet = ngpus-1: the search
//     visits every GPU in the node and only then returns to the NET node.
//   - connect.cc:106-109 (connectRings) — ring prev/next are stitched across
//     node boundaries: the entry rank of node n recvs from the exit rank of
//     node n-1, the exit rank of node n sends to the entry rank of node n+1.
//   - search.cc:735  — NICs are tried round-robin per channel
//     (nets[(graph->nChannels + i) % netCount]) → channel c rides NIC c % nNics.
//   - Rail-optimized fabric: NIC i on every server connects to leaf switch
//     (rail) i % railCount, and NIC i's local (PIX) GPU is GPU i (topo.ts).
//
// Construction used here (structurally faithful, not a re-run of the search):
// take the per-channel intra-node cycles the single-server ring search already
// produced, and for channel c cut each server's cycle at the entry GPU — the
// local GPU of NIC (c % nNics) — so the intra path enters there and exits at
// that GPU's predecessor in the cycle. The exit GPU sends to the next server's
// entry GPU over rail (nic % railCount). With crossNic=0 (default) a channel
// enters and exits a node via the same NIC.
//
// The old "8 standalone rail rings" view was a *decomposition* of where these
// inter-node hops land, not the rings themselves; use railLens() for that view.
// =============================================================================

import type { TopoGraph } from './types'

/** One inter-node edge of a channel ring — this is where a network QP lives. */
export interface InterNodeHop {
  channel: number
  rail: number // leaf switch (net-<rail>) this hop rides
  nic: number // per-server NIC index used on both ends (crossNic=0)
  fromId: string // exit GPU on the sending server (egresses via the rail's NIC)
  toId: string // entry GPU on the receiving server (the NIC's local/PIX GPU)
  fromServer: number
  toServer: number
}

/** One channel = one ring over every GPU in the cluster. */
export interface ClusterChannel {
  channel: number
  rail: number // rail all of this channel's net traffic rides
  nic: number // per-server NIC index (c % nicCount)
  /** Full ring order: all serverCount×gpuPerServer GPU node ids, in order. */
  globalOrder: string[]
  /** Intra-node path per server: enters at segment[0], exits at segment[last]. */
  serverSegments: { server: number; order: string[] }[]
  /** The serverCount inter-node edges (wrapping last server → first). */
  hops: InterNodeHop[]
}

export interface ClusterTopology {
  serverCount: number
  gpuPerServer: number
  nicCount: number
  railCount: number
  nChannels: number
  channels: ClusterChannel[]
}

export interface ClusterBuildOptions {
  serverCount: number
  gpuPerServer: number
  nicCount: number
  railCount: number
  /** Per-channel single-server GPU-index cycles from the ring search. */
  intraOrders: number[][]
}

/** Global node id for GPU `g` on server `s` (matches multi-node.ts prefixing). */
export function clusterGpuId(server: number, gpu: number): string {
  return `s${server}-gpu-${gpu}`
}

/** Extract per-channel GPU-index cycles from a computed single-server ring graph. */
export function intraOrdersFromRingGraph(ringGraph: TopoGraph): number[][] {
  return ringGraph.channels
    .map((ch) =>
      ch.ringOrder.map((id) => {
        const m = id.match(/(\d+)\s*$/)
        return m ? parseInt(m[1], 10) : -1
      }),
    )
    .filter((order) => order.length > 0 && order.every((g) => g >= 0))
}

/**
 * Build the true multi-node channel rings for a rail-optimized cluster.
 * One ring per intra channel, spanning all servers.
 */
export function buildClusterChannels(opts: ClusterBuildOptions): ClusterTopology {
  const { serverCount, gpuPerServer, nicCount, railCount, intraOrders } = opts
  const channels: ClusterChannel[] = []

  for (let c = 0; c < intraOrders.length; c++) {
    const cycle = intraOrders[c]
    if (cycle.length !== gpuPerServer) {
      throw new Error(
        `channel ${c} intra order has ${cycle.length} GPUs, expected ${gpuPerServer}`,
      )
    }

    // Channel c uses NIC (c % nNics) on every server (search.cc:735 round-robin);
    // that NIC sits on rail (nic % railCount) and its local GPU is GPU <nic>.
    const nic = nicCount > 0 ? c % nicCount : 0
    const rail = railCount > 0 ? nic % railCount : 0
    const entryGpu = nic % gpuPerServer

    // Cut the intra cycle at the entry GPU: path enters there, exits at its
    // cycle-predecessor (backToNet after visiting all GPUs, search.cc:837).
    const entryIdx = cycle.indexOf(entryGpu)
    if (entryIdx < 0) {
      throw new Error(`channel ${c}: entry GPU ${entryGpu} not in intra cycle`)
    }
    const rotated = [...cycle.slice(entryIdx), ...cycle.slice(0, entryIdx)]

    const serverSegments = Array.from({ length: serverCount }, (_, s) => ({
      server: s,
      order: rotated.map((g) => clusterGpuId(s, g)),
    }))

    const globalOrder = serverSegments.flatMap((seg) => seg.order)

    // Inter-node edges: exit GPU of server s → entry GPU of server s+1
    // (connect.cc:106-109 stitching), wrapping back to server 0.
    const hops: InterNodeHop[] = []
    if (serverCount > 1) {
      for (let s = 0; s < serverCount; s++) {
        const next = (s + 1) % serverCount
        hops.push({
          channel: c,
          rail,
          nic,
          fromId: serverSegments[s].order[gpuPerServer - 1],
          toId: serverSegments[next].order[0],
          fromServer: s,
          toServer: next,
        })
      }
    }

    channels.push({ channel: c, rail, nic, globalOrder, serverSegments, hops })
  }

  return {
    serverCount,
    gpuPerServer,
    nicCount,
    railCount,
    nChannels: channels.length,
    channels,
  }
}

/** All inter-node hops across every channel (each is a network connection/QP). */
export function allInterNodeHops(topo: ClusterTopology): InterNodeHop[] {
  return topo.channels.flatMap((ch) => ch.hops)
}

/**
 * The "rail lens": inter-node hops grouped by the rail they ride. This is the
 * per-rail decomposition of the channel rings — useful for seeing how rail r
 * carries the cluster's GPU-r-adjacent traffic, but it is a VIEW, not the rings.
 */
export function railLens(topo: ClusterTopology): Map<number, InterNodeHop[]> {
  const byRail = new Map<number, InterNodeHop[]>()
  for (const hop of allInterNodeHops(topo)) {
    const group = byRail.get(hop.rail) ?? []
    group.push(hop)
    byRail.set(hop.rail, group)
  }
  return byRail
}
