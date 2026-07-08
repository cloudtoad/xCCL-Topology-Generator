// The true 2-node init path: real inter-node search (local view + NETs),
// traced for the Build view, cluster rings + QPs from the searched channels.
import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { dgxH100Config } from './templates/dgx-h100'
import { NodeType } from './types'

const su = { serverCount: 2, railCount: 8, networkType: 'rail-optimized' as const }

describe('runInit 2-node true path', () => {
  const result = runInit(dgxH100Config, createDefaultEnvConfig(), su)

  test('display system is the full 2-server topology; buildSystem is the local view with NETs', () => {
    const displayGpus = result.system.nodesByType.get(NodeType.GPU) ?? []
    expect(displayGpus.length).toBe(16)

    expect(result.buildSystem).not.toBeNull()
    const localGpus = result.buildSystem!.nodesByType.get(NodeType.GPU) ?? []
    const nets = result.buildSystem!.nodesByType.get(NodeType.NET) ?? []
    expect(localGpus.length).toBe(8)
    expect(nets.length).toBe(8)
    expect(result.buildSystem!.inter).toBe(true)
  })

  test('ring graph comes from the real inter search: 8 channels, NET in === out', () => {
    expect(result.ringGraph.nChannels).toBe(8)
    const netIns = new Set<string>()
    for (const ch of result.ringGraph.channels) {
      expect(ch.netIn).toBeDefined()
      expect(ch.netOut).toBe(ch.netIn) // crossNic=0
      netIns.add(ch.netIn!)
      expect(ch.ringOrder[0]).toBe(`gpu-${ch.id}`) // entry at the rail's PIX GPU
    }
    expect(netIns.size).toBe(8) // NIC rotation fills all rails
  })

  test('build trace exists and carries NET entry/exit events', () => {
    expect(result.ringBuildTrace).not.toBeNull()
    const events = result.ringBuildTrace!.events
    const starts = events.filter((e) => e.kind === 'channel-start' && 'net' in e && e.net)
    const dones = events.filter((e) => e.kind === 'channel-done' && 'netIn' in e && e.netIn)
    expect(starts.length).toBeGreaterThanOrEqual(8)
    expect(dones.length).toBe(8)
  })

  test('cluster rings + QPs derive from the searched channels', () => {
    expect(result.clusterTopo).not.toBeNull()
    expect(result.clusterTopo!.nChannels).toBe(8)
    for (const ch of result.clusterTopo!.channels) {
      expect(ch.hops.length).toBe(2) // s0→s1 and s1→s0
      expect(ch.globalOrder.length).toBe(16)
    }
    // QPs = nChannels × nNodes × qpsPerConnection (net_ib/connect.cc:60)
    expect(result.qpPlan!.total).toBe(8 * 2 * 1)
  })
})
