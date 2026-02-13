// =============================================================================
// RCCL Topology Parsers — specialized topology recognition algorithms
// from rome_models.cc
//
// These parsers detect specific topology patterns (chordal ring, all-to-all,
// etc.) and produce optimized ring orderings when a pattern is recognized.
// =============================================================================

import type { TopoSystem, TopoGraph, GraphChannel, HardwareConfig } from '../types'
import { NodeType, LinkType, GraphPattern } from '../types'
import { CHORDAL_RING_8P6L_BASE, RCCL_TOPO_CR8G } from '../constants/rccl'
import { DecisionLog } from '../decision-log'

// =============================================================================
// parseChordalRing — rome_models.cc:2114-2185
//
// Detects an 8-GPU chordal ring topology (each GPU connected to 6 others)
// and produces optimized ring orderings.
//
// The chordal ring is identified by checking that every GPU has exactly
// 6 direct NVLink/xGMI connections (all-to-all minus one), and that the
// connectivity follows a specific pattern.
// =============================================================================

export function parseChordalRing(
  system: TopoSystem,
  config: HardwareConfig,
  log: DecisionLog,
): TopoGraph | null {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []
  const nGpus = gpus.length

  // Only applies to exactly 8 GPUs
  if (nGpus !== 8) return null

  // Check that each GPU has exactly 6 direct connections (NVLink/xGMI)
  // This is the hallmark of a chordal ring: 8 GPUs, each connected to 6 others
  const linksPerGpu = new Map<string, number>()
  for (const link of system.links) {
    if (link.type !== LinkType.NVL) continue
    linksPerGpu.set(link.fromId, (linksPerGpu.get(link.fromId) ?? 0) + 1)
  }

  for (const gpu of gpus) {
    const linkCount = linksPerGpu.get(gpu.id) ?? 0
    if (linkCount !== 6) return null
  }

  log.emit(
    'romeModelMatch',
    'Detected chordal ring topology (8 GPUs, 6 links each)',
    'Using pre-computed chordal ring orderings from rome_models.cc:2115',
    'rome_models.cc:2120',
    ['Fall through to generic Rome model matching'],
    { nGpus, linksPerGpu: 6 },
  )

  // Parse the hardcoded chordal ring base
  const rings = parseChordalRingBase(CHORDAL_RING_8P6L_BASE)

  // Determine bandwidth from a representative path
  let ringBw = 0
  if (rings.length > 0 && rings[0].length >= 2) {
    const path = system.paths.get(`${rings[0][0]}->${rings[0][1]}`)
    if (path) ringBw = path.bandwidth
  }
  if (ringBw === 0) ringBw = system.maxBw

  const channels: GraphChannel[] = rings.map((ring, idx) => ({
    id: idx,
    bandwidth: ringBw,
    ringOrder: ring,
  }))

  return {
    id: 'chordal-ring-8p6l',
    pattern: GraphPattern.RING,
    nChannels: channels.length,
    channels,
    speedIntra: ringBw,
    speedInter: 0,
    typeIntra: LinkType.NVL,
    typeInter: LinkType.NET,
  }
}

function parseChordalRingBase(ringBase: string): string[][] {
  const rings: string[][] = []
  for (const ringStr of ringBase.split('|')) {
    const indices = ringStr.trim().split(/\s+/).map(Number)
    if (indices.some(isNaN)) continue
    rings.push(indices.map(i => `gpu-${i}`))
  }
  return rings
}

// =============================================================================
// parseAllToAll — detects all-to-all (fully connected) topology
//
// When every GPU has direct links to every other GPU (nLinks = nGpus - 1),
// this produces optimized ring orderings that maximize bandwidth utilization.
// =============================================================================

export function parseAllToAll(
  system: TopoSystem,
  config: HardwareConfig,
  log: DecisionLog,
): TopoGraph | null {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []
  const nGpus = gpus.length

  if (nGpus < 2) return null

  // Check all-to-all: every GPU must have links to all other GPUs
  for (const gpu of gpus) {
    let linkCount = 0
    for (const link of system.links) {
      if (link.fromId === gpu.id && link.type === LinkType.NVL) {
        linkCount++
      }
    }
    if (linkCount < nGpus - 1) return null
  }

  log.emit(
    'romeModelMatch',
    `Detected all-to-all topology (${nGpus} GPUs, ${nGpus - 1} links each)`,
    'Generating optimized ring orderings for fully connected mesh',
    'rome_models.cc:2461',
    ['Fall through to generic search'],
    { nGpus, linksPerGpu: nGpus - 1 },
  )

  // For all-to-all with 8 GPUs, generate multiple diverse ring orderings
  // These maximize link utilization across channels
  const rings = generateAllToAllRings(nGpus, config.numaMapping)

  let ringBw = system.maxBw
  const path = system.paths.get(`gpu-0->gpu-1`)
  if (path) ringBw = path.bandwidth

  const channels: GraphChannel[] = rings.map((ring, idx) => ({
    id: idx,
    bandwidth: ringBw,
    ringOrder: ring,
  }))

  return {
    id: 'all-to-all-rings',
    pattern: GraphPattern.RING,
    nChannels: channels.length,
    channels,
    speedIntra: ringBw,
    speedInter: 0,
    typeIntra: LinkType.NVL,
    typeInter: LinkType.NET,
  }
}

/**
 * Generate optimized ring orderings for all-to-all topology.
 * Each ring visits all GPUs. Multiple rings use different orderings
 * to spread link utilization evenly.
 */
function generateAllToAllRings(nGpus: number, numaMapping: number[]): string[][] {
  const rings: string[][] = []

  if (nGpus === 8) {
    // Pre-computed orderings for 8-GPU all-to-all
    // These are from the MI300X Rome models (rome_model_55)
    const patterns = [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [0, 2, 1, 3, 4, 6, 5, 7],
      [7, 5, 6, 4, 3, 1, 2, 0],
      [0, 3, 2, 1, 4, 7, 6, 5],
      [5, 6, 7, 4, 1, 2, 3, 0],
    ]

    for (const pattern of patterns) {
      rings.push(pattern.map(i => `gpu-${i}`))
    }
  } else {
    // Generic: just use forward and reverse orderings
    const forward = Array.from({ length: nGpus }, (_, i) => `gpu-${i}`)
    const reverse = [...forward].reverse()
    rings.push(forward, reverse)
  }

  return rings
}

// =============================================================================
// detectRcclTopologyType — determines which RCCL-specific topology pattern
// the current system matches, if any
// =============================================================================

export interface RcclTopoDetection {
  type: 'chordal-ring' | 'all-to-all' | 'partial-mesh' | 'none'
  flags: number // Bitmask: RCCL_TOPO_CR8G etc.
}

export function detectRcclTopologyType(
  system: TopoSystem,
  config: HardwareConfig,
): RcclTopoDetection {
  const gpus = system.nodesByType.get(NodeType.GPU) ?? []
  const nGpus = gpus.length

  if (nGpus === 0) return { type: 'none', flags: 0 }

  // Count NVLink connections per GPU
  const linksPerGpu = new Map<string, number>()
  for (const link of system.links) {
    if (link.type !== LinkType.NVL) continue
    linksPerGpu.set(link.fromId, (linksPerGpu.get(link.fromId) ?? 0) + 1)
  }

  const linkCounts = gpus.map(gpu => linksPerGpu.get(gpu.id) ?? 0)
  const minLinks = Math.min(...linkCounts)
  const maxLinks = Math.max(...linkCounts)

  // All-to-all: every GPU connects to all others
  if (minLinks === nGpus - 1 && maxLinks === nGpus - 1) {
    return { type: 'all-to-all', flags: 0 }
  }

  // Chordal ring: 8 GPUs, 6 links each
  if (nGpus === 8 && minLinks === 6 && maxLinks === 6) {
    return { type: 'chordal-ring', flags: RCCL_TOPO_CR8G }
  }

  // Partial mesh: some but not all connections
  if (minLinks > 0) {
    return { type: 'partial-mesh', flags: 0 }
  }

  return { type: 'none', flags: 0 }
}
