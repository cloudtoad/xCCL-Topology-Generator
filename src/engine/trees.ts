// =============================================================================
// Tree Construction — mirrors trees.cc / connect.cc from NCCL source
//
// For intra-node (single server): GPUs form a CHAIN following the ring order.
// Each GPU's parent is the previous GPU in ring order, child is the next.
// No branching — the "tree" within a node is always a linear pipeline.
//
// For inter-node (multi-server): ncclGetDtree builds a binary tree across
// NODES, with intra-node chains feeding into/from the inter-node tree.
// (Inter-node support to be added when cluster mode is implemented.)
//
// Channel doubling: each ring channel produces 2 tree channels:
//   - Tree 0: forward chain (ring order as-is)
//   - Tree 1: reverse chain (ring order reversed)
// This ensures every rank is active in at least one direction.
// =============================================================================

import type { TopoGraph, GraphChannel } from './types'
import { GraphPattern } from './types'
import { DecisionLog } from './decision-log'

// =============================================================================
// ncclGetBtree — standard binary tree for nRanks ranks (trees.cc:18-86)
//
// Used for INTER-NODE tree construction (one rank per node).
// NOT used for intra-node — intra-node always uses chains.
// =============================================================================
function getBtree(
  nRanks: number,
  rank: number,
): { up: number; down0: number; down1: number } {
  let up = -1
  let down0 = -1
  let down1 = -1

  if (nRanks < 1) {
    return { up, down0, down1 }
  }

  if (rank === 0) {
    up = -1
  } else {
    up = Math.floor((rank - 1) / 2)
  }

  const leftChild = 2 * rank + 1
  const rightChild = 2 * rank + 2

  down0 = leftChild < nRanks ? leftChild : -1
  down1 = rightChild < nRanks ? rightChild : -1

  return { up, down0, down1 }
}

// =============================================================================
// ncclGetDtree — double binary tree (trees.cc:88-109)
//
// Used for INTER-NODE tree construction only.
// Tree 0: standard binary tree
// Tree 1: mirror (even nRanks) or shift (odd nRanks) tree
// =============================================================================
export function ncclGetDtree(
  nRanks: number,
  rank: number,
): {
  tree0: { up: number; down0: number; down1: number }
  tree1: { up: number; down0: number; down1: number }
} {
  const tree0 = getBtree(nRanks, rank)

  let tree1: { up: number; down0: number; down1: number }

  if (nRanks % 2 === 0) {
    const mirrorRank = nRanks - 1 - rank
    const mirrorResult = getBtree(nRanks, mirrorRank)
    tree1 = {
      up: mirrorResult.up === -1 ? -1 : nRanks - 1 - mirrorResult.up,
      down0: mirrorResult.down0 === -1 ? -1 : nRanks - 1 - mirrorResult.down0,
      down1: mirrorResult.down1 === -1 ? -1 : nRanks - 1 - mirrorResult.down1,
    }
  } else {
    const shiftRank = (rank - 1 + nRanks) % nRanks
    const shiftResult = getBtree(nRanks, shiftRank)
    tree1 = {
      up: shiftResult.up === -1 ? -1 : (shiftResult.up + 1) % nRanks,
      down0: shiftResult.down0 === -1 ? -1 : (shiftResult.down0 + 1) % nRanks,
      down1: shiftResult.down1 === -1 ? -1 : (shiftResult.down1 + 1) % nRanks,
    }
  }

  return { tree0, tree1 }
}

// =============================================================================
// buildChain — build a chain (linear tree) from a ring ordering
//
// For a ring order [A, B, C, D, ...]:
//   A.up = -1 (root), A.down = [B]
//   B.up = A,          B.down = [C]
//   ...
//   last.up = prev,    last.down = [] (tail/leaf)
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
// buildTreeGraph — construct a tree TopoGraph from a ring TopoGraph
//
// For single-node: builds chains following ring order (intra-node pattern).
// Each ring channel → 1 tree channel (forward chain). The channel doubling
// in connect.ts will add the reverse chain as the second tree channel.
// =============================================================================
export function buildTreeGraph(
  ringGraph: TopoGraph,
  nRanks: number,
  log: DecisionLog,
): TopoGraph {
  log.emit(
    'treeSearch',
    `Building tree graph from ring graph with ${ringGraph.nChannels} channels`,
    `Intra-node: chain following ring order for ${nRanks} ranks`,
    'connect.cc:ncclTopoPreset',
    ['Binary tree (inter-node only)', 'Binomial tree'],
    { nRanks, nChannels: ringGraph.nChannels },
  )

  const channels: GraphChannel[] = []

  for (let ch = 0; ch < ringGraph.nChannels; ch++) {
    const ringChannel = ringGraph.channels[ch]
    const { treeLinks, treeUp, treeDown } = buildChain(ringChannel.ringOrder)

    channels.push({
      id: ch,
      bandwidth: ringChannel.bandwidth,
      ringOrder: ringChannel.ringOrder,
      treeLinks,
      treeUp,
      treeDown,
    })
  }

  const treeGraph: TopoGraph = {
    id: 'tree',
    pattern: GraphPattern.BALANCED_TREE,
    nChannels: channels.length,
    channels,
    speedIntra: ringGraph.speedIntra,
    speedInter: ringGraph.speedInter,
    typeIntra: ringGraph.typeIntra,
    typeInter: ringGraph.typeInter,
  }

  log.emit(
    'treeSearch',
    `Tree graph built: ${treeGraph.nChannels} channels (intra-node chains)`,
    `Each channel is a linear chain of ${nRanks} GPUs following ring order`,
    'connect.cc:ncclTopoPreset',
    [],
    {
      nChannels: treeGraph.nChannels,
      totalTreeLinks: channels.reduce((sum, c) => sum + (c.treeLinks?.length ?? 0), 0),
    },
  )

  return treeGraph
}
