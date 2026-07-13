// PXN (ledger #18): a GPU reaches a non-local rail's NET by passing THROUGH
// the NVLink peer that owns that rail's NIC — never by borrowing the NIC
// directly, and only through the host bridge when PXN is unavailable.
// paths.cc:725-749 · NCCL 2.12 blog ("PXN: PCI × NVLink").
import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'
import { PathType } from './types'

describe('PXN pass-through paths (2-node, rail-paired)', () => {
  const two = runInit(dgxH100Config, createDefaultEnvConfig(), {
    serverCount: 2, railCount: 8, networkType: 'rail-optimized',
  })
  const sys = two.buildSystem!

  test('cross-rail GPU→NET is PXN via a rail-local peer GPU, not host-bridge', () => {
    const p = sys.paths.get('gpu-0->net-3')!
    expect(PathType[p.type]).toBe('PXN')
    // the pass-through: hops run THROUGH the peer GPU that is PIX-local to
    // net-3's rail. With dedicated 2-port switches (ledger #19) that peer is
    // uniquely gpu-3 — but the invariant we pin is locality, not the id.
    const viaGpu = p.hops.map((h) => h.nodeId).find((id) => id.startsWith('gpu-'))
    expect(viaGpu).toBeDefined()
    const peerLocal = sys.paths.get(`${viaGpu}->net-3`)!
    expect(PathType[peerLocal.type]).toBe('PIX')
  })

  test('local-rail GPU→NET stays PIX and direct (no GPU intermediates)', () => {
    const p = sys.paths.get('gpu-0->net-0')!
    expect(PathType[p.type]).toBe('PIX')
    expect(p.hops.some((h) => h.nodeId.startsWith('gpu-'))).toBe(false)
  })

  test('PXN bandwidth = min(NVLink leg, peer local-rail leg)', () => {
    const pxn = sys.paths.get('gpu-0->net-3')!
    const local = sys.paths.get('gpu-3->net-3')!
    expect(pxn.bandwidth).toBeLessThanOrEqual(local.bandwidth)
    expect(pxn.bandwidth).toBe(20) // rail PCIe is the bottleneck, not NVLink
  })

  test('when PXN is disabled, cross-rail falls back to the host bridge', () => {
    const env = createDefaultEnvConfig()
    env.get('NCCL_PXN_DISABLE')!.value = 1
    const noPxn = runInit(dgxH100Config, env, {
      serverCount: 2, railCount: 8, networkType: 'rail-optimized',
    })
    const p = noPxn.buildSystem!.paths.get('gpu-0->net-3')!
    expect(p.type).toBeGreaterThanOrEqual(PathType.PHB)
  })
})
