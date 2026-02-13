// =============================================================================
// Channel Setup — mirrors connect.cc from NCCL source
//
// Wires up ring and tree channels after search and tree construction.
// Key operations:
//   1. Set ring prev/next connections from ring ordering
//   2. Double tree channels: each ring channel → 2 tree channels
//      - Tree 0 (even): forward chain (ring order as-is)
//      - Tree 1 (odd):  reverse chain (ring order reversed)
// =============================================================================

import type { TopoSystem, TopoGraph, GraphChannel } from './types'
import { GraphPattern } from './types'
import { DecisionLog } from './decision-log'

// =============================================================================
// buildChain — build a chain (linear tree) from an ordered list of GPU IDs
// =============================================================================
function buildChain(order: string[]): {
  treeLinks: { parentId: string; childId: string }[]
  treeUp: Map<string, string>
  treeDown: Map<string, string[]>
} {
  const treeLinks: { parentId: string; childId: string }[] = []
  const treeUp = new Map<string, string>()
  const treeDown = new Map<string, string[]>()

  for (let i = 0; i < order.length; i++) {
    const gpuId = order[i]

    if (i > 0) {
      treeUp.set(gpuId, order[i - 1])
      treeLinks.push({ parentId: order[i - 1], childId: gpuId })
    }

    if (i < order.length - 1) {
      treeDown.set(gpuId, [order[i + 1]])
    }
  }

  return { treeLinks, treeUp, treeDown }
}

// =============================================================================
// setupChannels — connect.cc main entry point
//
// Takes the ring and tree graphs produced by search + tree construction,
// and produces the final connected graphs ready for use.
//
// Ring channels: prev/next maps are finalized from ringOrder.
// Tree channels: doubled — forward chain + reverse chain per ring channel.
// =============================================================================
export function setupChannels(
  _system: TopoSystem,
  ringGraph: TopoGraph,
  treeGraph: TopoGraph,
  log: DecisionLog,
): { ringGraph: TopoGraph; treeGraph: TopoGraph } {
  log.emit(
    'channelSetup',
    'Setting up channels (connect.cc)',
    `Ring channels: ${ringGraph.nChannels}, Tree channels: ${treeGraph.nChannels} (will be doubled)`,
    'connect.cc:580',
    [],
    {
      ringChannels: ringGraph.nChannels,
      treeChannels: treeGraph.nChannels,
    },
  )

  // -------------------------------------------------------------------------
  // 1. Finalize ring prev/next connections
  // -------------------------------------------------------------------------
  for (let ch = 0; ch < ringGraph.nChannels; ch++) {
    const channel = ringGraph.channels[ch]
    const order = channel.ringOrder
    if (!order || order.length === 0) continue

    const len = order.length
    const prevMap = new Map<string, string>()
    const nextMap = new Map<string, string>()

    for (let i = 0; i < len; i++) {
      const current = order[i]
      const nextNode = order[(i + 1) % len]
      const prevNode = order[(i - 1 + len) % len]
      nextMap.set(current, nextNode)
      prevMap.set(current, prevNode)
    }

    ;(channel as GraphChannel & {
      ringPrev?: Map<string, string>
      ringNext?: Map<string, string>
    }).ringPrev = prevMap
    ;(channel as GraphChannel & {
      ringPrev?: Map<string, string>
      ringNext?: Map<string, string>
    }).ringNext = nextMap
  }

  log.emit(
    'channelSetup',
    `Ring connections set for ${ringGraph.nChannels} channels`,
    'Each channel has prev/next maps derived from ring ordering',
    'connect.cc:600',
  )

  // -------------------------------------------------------------------------
  // 2. Double tree channels
  //
  // For intra-node (single server): each ring channel produces 2 tree channels:
  //   - Tree 0 (even index): forward chain following ring order
  //   - Tree 1 (odd index):  reverse chain (ring order reversed)
  //
  // This ensures every rank is active in at least one direction,
  // improving overlap in reduce-scatter / all-gather operations.
  // -------------------------------------------------------------------------
  const nRanks = ringGraph.channels[0]?.ringOrder?.length ?? 0
  const doubledTreeChannels: GraphChannel[] = []

  for (let ch = 0; ch < treeGraph.nChannels; ch++) {
    const srcChannel = treeGraph.channels[ch]
    const order = srcChannel.ringOrder

    // Tree 0: forward chain (ring order as-is) — already built in buildTreeGraph
    doubledTreeChannels.push({
      id: 2 * ch,
      bandwidth: srcChannel.bandwidth,
      ringOrder: order,
      treeLinks: srcChannel.treeLinks,
      treeUp: srcChannel.treeUp,
      treeDown: srcChannel.treeDown,
    })

    // Tree 1: reverse chain
    const revOrder = [...order].reverse()
    const { treeLinks, treeUp, treeDown } = buildChain(revOrder)

    doubledTreeChannels.push({
      id: 2 * ch + 1,
      bandwidth: srcChannel.bandwidth,
      ringOrder: order,
      treeLinks,
      treeUp,
      treeDown,
    })
  }

  const doubledTreeGraph: TopoGraph = {
    id: 'tree-doubled',
    pattern: GraphPattern.BALANCED_TREE,
    nChannels: doubledTreeChannels.length,
    channels: doubledTreeChannels,
    speedIntra: treeGraph.speedIntra,
    speedInter: treeGraph.speedInter,
    typeIntra: treeGraph.typeIntra,
    typeInter: treeGraph.typeInter,
  }

  log.emit(
    'channelSetup',
    `Tree channels doubled: ${treeGraph.nChannels} -> ${doubledTreeGraph.nChannels}`,
    `Each ring channel → 2 tree channels (forward chain + reverse chain)`,
    'connect.cc:650',
    [],
    {
      originalTreeChannels: treeGraph.nChannels,
      doubledTreeChannels: doubledTreeGraph.nChannels,
      nRanks,
    },
  )

  log.emit(
    'channelSetup',
    'Channel setup complete',
    `Final: ${ringGraph.nChannels} ring channels, ${doubledTreeGraph.nChannels} tree channels, ${nRanks} ranks`,
    'connect.cc:700',
    [],
    {
      ringChannels: ringGraph.nChannels,
      treeChannels: doubledTreeGraph.nChannels,
      nRanks,
    },
  )

  return { ringGraph, treeGraph: doubledTreeGraph }
}
