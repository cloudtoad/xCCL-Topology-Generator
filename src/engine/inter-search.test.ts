// =============================================================================
// Inter-node ring search (2-node, NICx↔NICx) — the RecNet mechanism, verified
//
// This is the experiment that validated the "why are rings weird" discussion:
// with per-rail NETs attached, the strict order of operations produces one
// channel per rail, each entering at its NIC's local GPU, each with a
// DIFFERENT ring order — sameChannels sacrificed exactly as predicted from
// search.cc:776-780 (replay) + :1206 (cascade order).
// =============================================================================

import { describe, test, expect } from 'vitest'
import { buildTopoSystem } from './topo'
import { attachRailNetwork } from './network'
import { computeAllPaths, trimSystem } from './paths'
import { ncclTopoCompute, ncclTopoSearchInit } from './search'
import { RingBuildTracer } from './ring-build-trace'
import { GraphPattern, PathType } from './types'
import { createDefaultEnvConfig } from './env'
import { DecisionLog } from './decision-log'
import { dgxH100Config } from './templates/dgx-h100'

function build2Node() {
  const env = createDefaultEnvConfig()
  const log = new DecisionLog()
  const system = buildTopoSystem(dgxH100Config, env, log)
  attachRailNetwork(system, log)
  computeAllPaths(system, env, log)
  trimSystem(system, env, log)
  computeAllPaths(system, env, log)
  ncclTopoSearchInit(system)
  const tracer = new RingBuildTracer()
  const ring = ncclTopoCompute(system, GraphPattern.RING, 1, 32, env, log, tracer)
  return { system, ring, tracer }
}

describe('2-node DGX H100, rail-paired NETs', () => {
  const { system, ring, tracer } = build2Node()

  test('the system is inter with NET-bounded ceilings', () => {
    expect(system.inter).toBe(true)
    expect(system.maxBw).toBe(20) // GPU→NET bottleneck = PCIe Gen5 x16 model
    // NET entry paths are PIX for the rail's local GPUs.
    expect(system.paths.get('net-0->gpu-0')?.type).toBe(PathType.PIX)
  })

  test('every rail fills: 8 channels, one per NET, none left on the table', () => {
    expect(ring.nChannels).toBe(8)
    const netsUsed = new Set(ring.channels.map((c) => c.netIn))
    expect(netsUsed.size).toBe(8) // all 8 NICs carry a channel
    // PCIe (20 GB/s) feeds exactly one 20 GB/s channel per NIC — conservation.
    expect(ring.speedInter).toBe(20)
    expect(ring.speedIntra).toBe(20)
  })

  test('each channel enters AND exits within typeInter at its own rail', () => {
    for (const ch of ring.channels) {
      expect(ch.netIn).toBe(ch.netOut) // crossNic=0 held
      const entry = system.paths.get(`${ch.netIn}->${ch.ringOrder[0]}`)
      const exit = system.paths.get(`${ch.ringOrder[ch.ringOrder.length - 1]}->${ch.netOut}`)
      expect(entry?.type).toBe(PathType.PIX)
      expect(exit?.type).toBe(PathType.PIX)
    }
  })

  test('sameChannels was sacrificed: all 8 ring orders are DIFFERENT', () => {
    const orders = new Set(ring.channels.map((c) => c.ringOrder.join(' ')))
    expect(orders.size).toBe(8)
    // And the cascade shows the sacrifice happened (search.cc:1206 fires
    // before typeInter — reorder rings before degrading NIC locality).
    expect(tracer.events.some((e) => e.kind === 'relax' && e.action.includes('sameChannels'))).toBe(true)
  })

  test('rings span all GPUs and are anchored to their rails', () => {
    for (const ch of ring.channels) {
      expect(new Set(ch.ringOrder).size).toBe(8)
      // Entry GPU is the rail's PIX-local GPU (rail locality).
      expect(ch.ringOrder[0]).toBe(`gpu-${ch.id}`)
    }
  })
})
