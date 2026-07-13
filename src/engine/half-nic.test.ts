// The half-ratio deployment (4 NICs : 8 GPUs): each NIC serves a GPU pair
// behind a shared switch. Bandwidth conservation predicts exactly 4 channels
// on a 2-node fabric — one per NIC — each entering at one of its pair.
import { describe, test, expect } from 'vitest'
import { runInit } from './init'
import { createDefaultEnvConfig } from './env'
import { hgxH100FourNicConfig } from './templates/hgx-h100-4nic'
import { NodeType, PathType } from './types'

describe('half-NIC ratio (HGX H100 · 4 NIC, 2-node)', () => {
  const two = runInit(hgxH100FourNicConfig, createDefaultEnvConfig(), {
    serverCount: 2, railCount: 4, networkType: 'rail-optimized',
  })
  const sys = two.buildSystem!

  test('topology: 4 switches, each hosting 2 GPUs + 1 NIC', () => {
    expect((sys.nodesByType.get(NodeType.PCI) ?? []).length).toBe(4)
    // NIC n serves GPUs {2n, 2n+1}: both are PIX-local to it
    for (let n = 0; n < 4; n++) {
      expect(sys.paths.get(`gpu-${2 * n}->net-${n}`)!.type).toBe(PathType.PIX)
      expect(sys.paths.get(`gpu-${2 * n + 1}->net-${n}`)!.type).toBe(PathType.PIX)
    }
  })

  test('4 NICs carry exactly 4 channels — conservation at the half ratio', () => {
    expect(two.ringGraph.nChannels).toBe(4)
    const nets = new Set(two.ringGraph.channels.map((c) => c.netIn))
    expect(nets.size).toBe(4)
  })

  test("each channel enters at a GPU from its NIC's served pair", () => {
    for (const ch of two.ringGraph.channels) {
      const railIdx = Number(ch.netIn!.replace('net-', ''))
      const entryIdx = Number(ch.ringOrder[0].replace('gpu-', ''))
      expect([2 * railIdx, 2 * railIdx + 1]).toContain(entryIdx)
    }
  })
})
