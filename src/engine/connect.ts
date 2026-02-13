// =============================================================================
// Channel Setup — mirrors connect.cc from NCCL source
//
// Wires up ring and tree channels after search and tree construction.
// Key operations:
//   1. Double tree channels (each ring channel produces 2 tree channels)
//   2. Set ring prev/next connections from ring ordering
//   3. Set tree up/down connections from tree links
// =============================================================================

import type { TopoSystem, TopoGraph, GraphChannel } from './types'
import { GraphPattern } from './types'
import { ncclGetDtree } from './trees'
import { DecisionLog } from './decision-log'

// =============================================================================
// setupChannels — connect.cc main entry point
//
// Takes the ring and tree graphs produced by search + tree construction,
// and produces the final connected graphs ready for use.
//
// Ring channels: prev/next maps are finalized from ringOrder.
// Tree channels: doubled (each ring channel -> 2 tree channels using tree0/tree1
// from ncclGetDtree), with up/down maps populated.
// =============================================================================
export function setupChannels(
  system: TopoSystem,
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

    // Attach prev/next to channel
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
  // 2. Double tree channels (connect.cc:620-650)
  //
  // NCCL creates 2 tree channels per ring channel:
  //   - Tree channel 2*ch+0 uses tree0 from ncclGetDtree
  //   - Tree channel 2*ch+1 uses tree1 from ncclGetDtree
  //
  // This doubles the tree parallelism and ensures every rank is a
  // non-leaf in at least one tree (reducing idle time).
  // -------------------------------------------------------------------------
  const nRanks = ringGraph.channels[0]?.ringOrder?.length ?? 0
  const doubledTreeChannels: GraphChannel[] = []

  for (let ch = 0; ch < treeGraph.nChannels; ch++) {
    const srcChannel = treeGraph.channels[ch]

    // Tree channel 2*ch+0: uses tree0
    const tree0Links: { parentId: string; childId: string }[] = []
    const tree0Up = new Map<string, string>()
    const tree0Down = new Map<string, string[]>()

    // Tree channel 2*ch+1: uses tree1
    const tree1Links: { parentId: string; childId: string }[] = []
    const tree1Up = new Map<string, string>()
    const tree1Down = new Map<string, string[]>()

    for (let rank = 0; rank < nRanks; rank++) {
      const gpuId = `gpu-${rank}`
      const { tree0, tree1 } = ncclGetDtree(nRanks, rank)

      // --- Tree 0 ---
      if (tree0.up !== -1) {
        const parentId = `gpu-${tree0.up}`
        tree0Links.push({ parentId, childId: gpuId })
        tree0Up.set(gpuId, parentId)
      }

      const down0Children: string[] = []
      if (tree0.down0 !== -1) down0Children.push(`gpu-${tree0.down0}`)
      if (tree0.down1 !== -1) down0Children.push(`gpu-${tree0.down1}`)
      if (down0Children.length > 0) tree0Down.set(gpuId, down0Children)

      // --- Tree 1 ---
      if (tree1.up !== -1) {
        const parentId = `gpu-${tree1.up}`
        tree1Links.push({ parentId, childId: gpuId })
        tree1Up.set(gpuId, parentId)
      }

      const down1Children: string[] = []
      if (tree1.down0 !== -1) down1Children.push(`gpu-${tree1.down0}`)
      if (tree1.down1 !== -1) down1Children.push(`gpu-${tree1.down1}`)
      if (down1Children.length > 0) tree1Down.set(gpuId, down1Children)
    }

    // Channel for tree0 (even index)
    doubledTreeChannels.push({
      id: 2 * ch,
      bandwidth: srcChannel.bandwidth,
      ringOrder: srcChannel.ringOrder,
      treeLinks: tree0Links,
      treeUp: tree0Up,
      treeDown: tree0Down,
    })

    // Channel for tree1 (odd index)
    doubledTreeChannels.push({
      id: 2 * ch + 1,
      bandwidth: srcChannel.bandwidth,
      ringOrder: srcChannel.ringOrder,
      treeLinks: tree1Links,
      treeUp: tree1Up,
      treeDown: tree1Down,
    })
  }

  // Build the final doubled tree graph
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
    `Each ring channel produces 2 tree channels (tree0 + tree1 from ncclGetDtree)`,
    'connect.cc:650',
    [],
    {
      originalTreeChannels: treeGraph.nChannels,
      doubledTreeChannels: doubledTreeGraph.nChannels,
      nRanks,
    },
  )

  // -------------------------------------------------------------------------
  // 3. Final summary log
  // -------------------------------------------------------------------------
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
