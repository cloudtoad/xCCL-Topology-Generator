// =============================================================================
// Log replay — validate real NCCL GRAPH log lines against the source-derived
// parser, and cross-examine them for implied facts.
//
// Fixtures are verbatim from NVIDIA/nccl issue #1197 (NCCL 2.19.4, H100-class
// NVSwitch system, 2 nodes). Format: search.cc:1319-1321; type strings
// topo.cc:34; relaxation cascade search.cc:1197-1246.
// =============================================================================

import { describe, test, expect } from 'vitest'
import {
  PATH_TYPE_STR,
  parseGraphLog,
  formatGraphLog,
  formatTopoGraph,
  impliedRelaxations,
  minNicsForInterBw,
} from '../log-replay'
import { PathType, GraphPattern, Algorithm } from '../types'
import { runInit } from '../init'
import { createDefaultEnvConfig } from '../env'
import { dgxH100Config } from '../templates/dgx-h100'

// --- Verbatim lines from NVIDIA/nccl#1197 ---
const RING_1197 =
  'Pattern 4, crossNic 0, nChannels 12, bw 30.000000/30.000000, type NVL/PIX, sameChannels 1'
const TREE_1197 =
  'Pattern 1, crossNic 0, nChannels 12, bw 30.000000/30.000000, type NVL/PIX, sameChannels 1'
const NVLS_1197 =
  'Pattern 5, crossNic 0, nChannels 8, bw 40.000000/60.000000, type NVL/PIX, sameChannels 0'

describe('format fidelity (search.cc:1319, topo.cc:34)', () => {
  test('PATH_TYPE_STR order matches our PathType enum exactly', () => {
    // topo.cc:34: {"LOC","NVL","NVB","C2C","PIX","PXB","P2C","PXN","PHB","SYS","NET","DIS"}
    expect(PATH_TYPE_STR[PathType.LOC]).toBe('LOC')
    expect(PATH_TYPE_STR[PathType.NVL]).toBe('NVL')
    expect(PATH_TYPE_STR[PathType.NVB]).toBe('NVB')
    expect(PATH_TYPE_STR[PathType.C2C]).toBe('C2C')
    expect(PATH_TYPE_STR[PathType.PIX]).toBe('PIX')
    expect(PATH_TYPE_STR[PathType.PXB]).toBe('PXB')
    expect(PATH_TYPE_STR[PathType.P2C]).toBe('P2C')
    expect(PATH_TYPE_STR[PathType.PXN]).toBe('PXN')
    expect(PATH_TYPE_STR[PathType.PHB]).toBe('PHB')
    expect(PATH_TYPE_STR[PathType.SYS]).toBe('SYS')
    expect(PATH_TYPE_STR[PathType.NET]).toBe('NET')
    expect(PATH_TYPE_STR[PathType.DIS]).toBe('DIS')
  })

  test('parses the #1197 ring line — bwIntra comes FIRST', () => {
    const g = parseGraphLog(RING_1197)!
    expect(g.pattern).toBe(GraphPattern.RING) // "Pattern 4"
    expect(g.crossNic).toBe(0)
    expect(g.nChannels).toBe(12)
    expect(g.bwIntra).toBe(30)
    expect(g.bwInter).toBe(30)
    expect(g.typeIntra).toBe(PathType.NVL)
    expect(g.typeInter).toBe(PathType.PIX)
    expect(g.sameChannels).toBe(1)
  })

  test('parses the #1197 NVLS line — bwInter (60) exceeds bwIntra (40)', () => {
    const g = parseGraphLog(NVLS_1197)!
    expect(g.pattern).toBe(GraphPattern.NVLS) // "Pattern 5"
    expect(g.nChannels).toBe(8)
    expect(g.bwIntra).toBe(40)
    expect(g.bwInter).toBe(60) // pass-2 raises NVLS bwInter (search.cc:1274)
  })

  test('round-trips every fixture byte-for-byte', () => {
    for (const line of [RING_1197, TREE_1197, NVLS_1197]) {
      expect(formatGraphLog(parseGraphLog(line)!)).toBe(line)
    }
  })
})

describe('back-propagating a line through the relaxation cascade', () => {
  test('#1197 ring: ZERO relaxations fired (sameChannels 1, type NVL/PIX, crossNic 0)', () => {
    const r = impliedRelaxations(parseGraphLog(RING_1197)!)
    expect(r.noneFired).toBe(true)
  })

  test('#1197 NVLS: sameChannels=0 is the NVLS *starting* state, not a relaxation', () => {
    // trySameChannels = pattern==NVLS ? 0 : 1 (search.cc:1105)
    const r = impliedRelaxations(parseGraphLog(NVLS_1197)!)
    expect(r.sameChannelsRelaxed).toBe(false)
    expect(r.noneFired).toBe(true)
  })

  test('a hypothetical relaxed line is detected', () => {
    const g = parseGraphLog(
      'Pattern 4, crossNic 1, nChannels 2, bw 6.000000/6.000000, type SYS/PHB, sameChannels 0',
    )!
    const r = impliedRelaxations(g)
    expect(r.sameChannelsRelaxed).toBe(true)
    expect(r.typeIntraRelaxed).toBe(true) // SYS > NVL
    expect(r.typeInterRelaxed).toBe(true) // PHB > PIX
    expect(r.crossNicEnabled).toBe(true)
    expect(r.noneFired).toBe(false)
  })
})

describe('bandwidth-conservation inference (the "illumination")', () => {
  test('#1197 ring implies ≥8 NICs at 400G — refuting a 4-NIC reading', () => {
    const g = parseGraphLog(RING_1197)!
    // 12 channels × 30 GB/s = 360 GB/s inter per node per direction.
    expect(minNicsForInterBw(g, 50)).toBe(8) // 400G ConnectX-7 → 50 GB/s
    expect(minNicsForInterBw(g, 50)).toBeGreaterThan(4) // 4 NICs is impossible
  })
})

describe('our engine speaks the same language', () => {
  test('single-node H100 NVLS graph formats as a real-looking Pattern 5 line', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    expect(result.tuning?.algorithm).toBe(Algorithm.NVLS)
    const line = formatTopoGraph(result.nvlsGraph!, { sameChannels: 0 })
    // Same shape as the dump's NVLS line: 8 heads, bwIntra 40, NVL intra.
    expect(line).toMatch(/^Pattern 5, crossNic 0, nChannels 8, bw 40\.000000\//)
    expect(line).toContain('type NVL/')
    // And it parses back through the same grammar as real dumps.
    const parsed = parseGraphLog(line)!
    expect(parsed.pattern).toBe(GraphPattern.NVLS)
    expect(parsed.nChannels).toBe(8)
    expect(parsed.bwIntra).toBe(40)
  })

  test('ring graph emits a parseable Pattern 4 line', () => {
    const result = runInit(dgxH100Config, createDefaultEnvConfig())
    const parsed = parseGraphLog(formatTopoGraph(result.ringGraph))!
    expect(parsed.pattern).toBe(GraphPattern.RING)
    expect(parsed.nChannels).toBe(result.ringGraph.nChannels)
  })
})
