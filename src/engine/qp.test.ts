// =============================================================================
// QP (queue pair) model — tests
//
// Fidelity anchor: each channel ring gives every node exactly one net send +
// one net recv (transport.cc:25-26,123), so connections = nChannels × nNodes;
// NCCL_IB_QPS_PER_CONNECTION default 1 (net_ib/connect.cc:60).
// =============================================================================

import { describe, test, expect } from 'vitest'
import { buildClusterChannels } from './cluster'
import { buildQPs, qpsByRail, qpsBySourceServer, DEFAULT_QPS_PER_CONNECTION } from './qp'

const identity = [0, 1, 2, 3, 4, 5, 6, 7]

function topo(nChannels: number, serverCount = 4, railCount = 8) {
  return buildClusterChannels({
    serverCount,
    gpuPerServer: 8,
    nicCount: 8,
    railCount,
    intraOrders: Array.from({ length: nChannels }, () => identity),
  })
}

describe('buildQPs', () => {
  test('QPs = nChannels × nNodes × qpsPerConn', () => {
    const plan = buildQPs(topo(16), 1)
    expect(plan.total).toBe(16 * 4 * 1) // 64 — one net edge per node per channel
  })

  test('default is 1 QP per connection (net_ib/connect.cc:60)', () => {
    expect(DEFAULT_QPS_PER_CONNECTION).toBe(1)
    expect(buildQPs(topo(18)).total).toBe(18 * 4)
  })

  test('qpsPerConnection multiplies the count (fabric spread)', () => {
    const plan = buildQPs(topo(2), 4)
    expect(plan.total).toBe(2 * 4 * 4)
    const oneConn = plan.qps.filter((q) => q.channel === 0 && q.fromId === 's0-gpu-7')
    expect(oneConn.map((q) => q.qpIndex).sort()).toEqual([0, 1, 2, 3])
  })

  test('each QP rides its channel\'s rail', () => {
    const plan = buildQPs(topo(16))
    for (const qp of plan.qps) {
      expect(qp.rail).toBe(qp.channel % 8)
    }
  })

  test('18 channels over 8 rails split unevenly — rails 0-1 carry 3 channels', () => {
    // 18 = 2×8 + 2 → channels 16,17 land on rails 0,1.
    const byRail = qpsByRail(buildQPs(topo(18)))
    expect(byRail.get(0)).toBe(3 * 4) // 3 channels × 4 edges
    expect(byRail.get(1)).toBe(3 * 4)
    for (let r = 2; r < 8; r++) expect(byRail.get(r)).toBe(2 * 4)
  })

  test('every server originates exactly nChannels × qpsPerConn QPs', () => {
    const byServer = qpsBySourceServer(buildQPs(topo(16)))
    expect(byServer.size).toBe(4)
    for (const count of byServer.values()) expect(count).toBe(16) // one edge per channel
  })

  test('single-server cluster has no QPs', () => {
    expect(buildQPs(topo(16, 1)).total).toBe(0)
  })

  test('QP ids are unique and stable', () => {
    const plan = buildQPs(topo(4), 2)
    expect(new Set(plan.qps.map((q) => q.id)).size).toBe(plan.qps.length)
    expect(plan.qps[0].id).toBe('ch0-rail0-s0g7>s1g0-q0')
  })
})
