// =============================================================================
// Double Binary Tree Construction — mirrors trees.cc from NCCL source
// =============================================================================

import type { TopoGraph, GraphChannel } from './types'
import { GraphPattern, LinkType } from './types'
import { DecisionLog } from './decision-log'

// =============================================================================
// ncclGetBtree — standard binary tree for nRanks ranks (trees.cc:18-86)
//
// For rank r in a tree of nRanks:
//   parent = floor((r - 1) / 2),  or -1 if r == 0
//   left child  = 2*r + 1,         or -1 if >= nRanks
//   right child = 2*r + 2,         or -1 if >= nRanks
// =============================================================================
function getBtree(
  nRanks: number,
  rank: number,
): { up: number; down0: number; down1: number } {
  // trees.cc:23-86 — iterative binary tree construction
  // The NCCL implementation computes bit masks, but the result is equivalent
  // to a standard 0-indexed binary tree layout.

  let up = -1
  let down0 = -1
  let down1 = -1

  if (nRanks < 1) {
    return { up, down0, down1 }
  }

  // trees.cc:26-40 — find the position of the rank in the tree
  // NCCL uses a bitwise method: iterate from the highest bit down to determine
  // parent and children. The resulting tree is the canonical implicit binary
  // tree stored in array order: node i has children 2i+1 and 2i+2.

  // Parent: (rank - 1) / 2, or -1 for the root (rank 0)
  if (rank === 0) {
    up = -1
  } else {
    up = Math.floor((rank - 1) / 2)
  }

  // Children
  const leftChild = 2 * rank + 1
  const rightChild = 2 * rank + 2

  down0 = leftChild < nRanks ? leftChild : -1
  down1 = rightChild < nRanks ? rightChild : -1

  return { up, down0, down1 }
}

// =============================================================================
// ncclGetDtree — double binary tree (trees.cc:88-109)
//
// Tree 0: standard binary tree (getBtree)
// Tree 1: depends on nRanks parity
//   - If nRanks is even: mirror tree — use rank' = (nRanks - 1 - rank)
//   - If nRanks is odd:  shift tree  — use rank' = (rank - 1 + nRanks) % nRanks
//
// The double tree ensures every rank has work in at least one tree,
// improving overlap in reduce-scatter / all-gather operations.
// =============================================================================
export function ncclGetDtree(
  nRanks: number,
  rank: number,
): {
  tree0: { up: number; down0: number; down1: number }
  tree1: { up: number; down0: number; down1: number }
} {
  // Tree 0: standard binary tree (trees.cc:91)
  const tree0 = getBtree(nRanks, rank)

  // Tree 1 (trees.cc:93-108)
  let tree1: { up: number; down0: number; down1: number }

  if (nRanks % 2 === 0) {
    // Even nRanks: mirror tree — reverse the rank indices (trees.cc:94-100)
    const mirrorRank = nRanks - 1 - rank
    const mirrorResult = getBtree(nRanks, mirrorRank)

    // Map the mirrored rank indices back to real ranks
    tree1 = {
      up: mirrorResult.up === -1 ? -1 : nRanks - 1 - mirrorResult.up,
      down0: mirrorResult.down0 === -1 ? -1 : nRanks - 1 - mirrorResult.down0,
      down1: mirrorResult.down1 === -1 ? -1 : nRanks - 1 - mirrorResult.down1,
    }
  } else {
    // Odd nRanks: shift tree — rotate rank indices by 1 (trees.cc:101-108)
    const shiftRank = (rank - 1 + nRanks) % nRanks
    const shiftResult = getBtree(nRanks, shiftRank)

    // Map the shifted rank indices back to real ranks
    tree1 = {
      up: shiftResult.up === -1 ? -1 : (shiftResult.up + 1) % nRanks,
      down0: shiftResult.down0 === -1 ? -1 : (shiftResult.down0 + 1) % nRanks,
      down1: shiftResult.down1 === -1 ? -1 : (shiftResult.down1 + 1) % nRanks,
    }
  }

  return { tree0, tree1 }
}

// =============================================================================
// buildTreeGraph — construct a tree TopoGraph from a ring TopoGraph
//
// Uses ncclGetDtree to assign tree links for each channel.
// Each ring channel produces one tree channel with two sub-trees (tree0, tree1).
// The tree channels are later doubled in connect.ts (setupChannels) to produce
// 2 tree channels per ring channel.
// =============================================================================
export function buildTreeGraph(
  ringGraph: TopoGraph,
  nRanks: number,
  log: DecisionLog,
): TopoGraph {
  log.emit(
    'treeSearch',
    `Building tree graph from ring graph with ${ringGraph.nChannels} channels`,
    `Using ncclGetDtree for ${nRanks} ranks (double binary tree)`,
    'trees.cc:88',
    ['Single binary tree', 'Binomial tree'],
    { nRanks, nChannels: ringGraph.nChannels },
  )

  const channels: GraphChannel[] = []

  for (let ch = 0; ch < ringGraph.nChannels; ch++) {
    const ringChannel = ringGraph.channels[ch]

    // Build tree links using the GPU IDs from the ring ordering.
    // In our model, rank index maps to GPU ID via the ring channel's ringOrder.
    // For intra-node tree construction, we treat the ring order positions as ranks.
    const treeLinks: { parentId: string; childId: string }[] = []
    const treeUp = new Map<string, string>()
    const treeDown = new Map<string, string[]>()

    // Determine the mapping: for this channel, the GPUs are those in ringOrder.
    // We use rank indices 0..nRanks-1 corresponding to gpu-0..gpu-(nRanks-1).
    for (let rank = 0; rank < nRanks; rank++) {
      const gpuId = `gpu-${rank}`
      const { tree0 } = ncclGetDtree(nRanks, rank)

      // Use tree0 for the primary tree structure of this channel.
      // tree1 will be used when channels are doubled in connect.ts.
      const downChildren: string[] = []

      if (tree0.up !== -1) {
        const parentId = `gpu-${tree0.up}`
        treeLinks.push({ parentId, childId: gpuId })
        treeUp.set(gpuId, parentId)
      }

      if (tree0.down0 !== -1) {
        const childId = `gpu-${tree0.down0}`
        downChildren.push(childId)
      }
      if (tree0.down1 !== -1) {
        const childId = `gpu-${tree0.down1}`
        downChildren.push(childId)
      }

      if (downChildren.length > 0) {
        treeDown.set(gpuId, downChildren)
      }
    }

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
    `Tree graph built: ${treeGraph.nChannels} channels`,
    `Each channel has tree links for ${nRanks} ranks using double binary tree`,
    'trees.cc:109',
    [],
    {
      nChannels: treeGraph.nChannels,
      totalTreeLinks: channels.reduce((sum, c) => sum + (c.treeLinks?.length ?? 0), 0),
    },
  )

  return treeGraph
}
