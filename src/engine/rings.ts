// =============================================================================
// Ring Connection Setup — mirrors rings.cc from NCCL source
//
// Builds prev/next maps for each ring channel from the computed ring ordering.
// After graph search produces a ring ordering (ringOrder), this module sets up
// the bidirectional prev/next pointers that each GPU uses at runtime.
// =============================================================================

import type { TopoGraph, GraphChannel } from './types'
import { DecisionLog } from './decision-log'

// =============================================================================
// setupRings — populate prev/next maps for each ring channel (rings.cc)
//
// For each channel in the ring graph:
//   ringOrder = [gpu-a, gpu-b, gpu-c, ...]
//   next[gpu-a] = gpu-b, next[gpu-b] = gpu-c, ..., next[last] = gpu-a
//   prev[gpu-b] = gpu-a, prev[gpu-c] = gpu-b, ..., prev[gpu-a] = last
//
// This is called after ncclTopoCompute (ring search) produces the ring ordering
// and before setupChannels wires everything together.
// =============================================================================
export function setupRings(graph: TopoGraph, log: DecisionLog): void {
  log.emit(
    'channelSetup',
    `Setting up ring connections for ${graph.nChannels} channels`,
    'Building prev/next maps from ring ordering for each channel',
    'rings.cc',
    [],
    { nChannels: graph.nChannels },
  )

  for (let ch = 0; ch < graph.nChannels; ch++) {
    const channel = graph.channels[ch]
    const order = channel.ringOrder

    if (!order || order.length === 0) {
      log.emit(
        'channelSetup',
        `Channel ${ch}: empty ring order, skipping`,
        'No GPUs in ring ordering — channel is unused',
        'rings.cc',
      )
      continue
    }

    const len = order.length

    // Build prev and next maps for this channel
    // These may already exist as empty maps on the GraphChannel; we populate them.
    // The ring is circular: order[i] -> next = order[(i+1) % len]
    //                        order[i] -> prev = order[(i-1+len) % len]
    const prevMap = new Map<string, string>()
    const nextMap = new Map<string, string>()

    for (let i = 0; i < len; i++) {
      const current = order[i]
      const nextNode = order[(i + 1) % len]
      const prevNode = order[(i - 1 + len) % len]

      nextMap.set(current, nextNode)
      prevMap.set(current, prevNode)
    }

    // Store the maps back into the channel.
    // GraphChannel doesn't have explicit prev/next fields in the type definition,
    // but the ring order encodes them implicitly. We attach them as additional
    // data so downstream code (connect.ts) can wire the connections.
    //
    // We use a type-safe approach: store them on the ringOrder-based channel
    // and let connect.ts rebuild from ringOrder. However, for convenience and
    // to match the NCCL pattern of pre-computing, we also store the ring info
    // as a computed property. Since the GraphChannel type includes ringOrder,
    // downstream code can derive prev/next from ringOrder directly.
    //
    // For the engine's internal use, we annotate the channel object.
    ;(channel as GraphChannel & {
      ringPrev?: Map<string, string>
      ringNext?: Map<string, string>
    }).ringPrev = prevMap
    ;(channel as GraphChannel & {
      ringPrev?: Map<string, string>
      ringNext?: Map<string, string>
    }).ringNext = nextMap

    log.emit(
      'channelSetup',
      `Channel ${ch}: ring of ${len} GPUs wired`,
      `Ring: ${order.join(' -> ')} -> ${order[0]}`,
      'rings.cc',
      [],
      {
        channelId: ch,
        ringLength: len,
        ringOrder: order,
      },
    )
  }

  log.emit(
    'channelSetup',
    `Ring setup complete for ${graph.nChannels} channels`,
    'All prev/next maps populated from ring orderings',
    'rings.cc',
  )
}
