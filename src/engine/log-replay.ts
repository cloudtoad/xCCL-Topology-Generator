// =============================================================================
// Log replay — speak and cross-examine NCCL's GRAPH dump language
//
// Real NCCL prints one line per computed graph (ncclTopoPrintGraph,
// search.cc:1319-1321):
//
//   Pattern %d, crossNic %d, nChannels %d, bw %f/%f, type %s/%s, sameChannels %d
//        pattern    crossNic    nChannels    bwIntra/bwInter  typeIntra/typeInter
//
// Field order matters: bwIntra comes FIRST in this INFO line. (Beware: the
// disabled debug printf at search.cc:1186 prints bwInter first — a real trap
// when reading dumps.) Path type strings come from topo.cc:34.
//
// This module lets us treat a real log line as a *witness* and the source as
// the *constraint system*:
//   - parseGraphLog / formatGraphLog — round-trip NCCL's exact format, so our
//     engine's graphs can be diffed line-for-line against real dumps.
//   - impliedRelaxations — back-propagates a line through the relaxation
//     cascade's conditionals (which steps must / must not have fired).
//   - minNicsForInterBw — bandwidth-conservation inference: nChannels×bwInter
//     of inter traffic per node bounds the NIC count from below.
//
// Worked example (NVIDIA/nccl#1197, NCCL 2.19.4 H100-class 2-node system):
//   "Pattern 4, crossNic 0, nChannels 12, bw 30.000000/30.000000, type NVL/PIX, sameChannels 1"
//   → 12×30 = 360 GB/s inter per node ⇒ with 50 GB/s (400G) NICs, ≥8 NICs —
//     the issue's topology was often misread as 4 NICs; the log disproves it.
//   → sameChannels=1, typeInter=PIX (the minimum), crossNic=0 ⇒ the search
//     found this solution with ZERO relaxations fired (search.cc:1197-1246).
// =============================================================================

import { PathType, GraphPattern } from './types'
import type { TopoGraph } from './types'
import { LinkType } from './types'

/** Path type names in NCCL log order — topo.cc:34. Index == PathType value. */
export const PATH_TYPE_STR = [
  'LOC', 'NVL', 'NVB', 'C2C', 'PIX', 'PXB', 'P2C', 'PXN', 'PHB', 'SYS', 'NET', 'DIS',
] as const

export interface GraphLogLine {
  pattern: number // GraphPattern — real IDs (graph.h:160-169), as printed
  crossNic: number
  nChannels: number
  bwIntra: number
  bwInter: number
  typeIntra: PathType
  typeInter: PathType
  sameChannels: number
}

const LINE_RE =
  /Pattern (\d+), crossNic (\d+), nChannels (\d+), bw ([\d.]+)\/([\d.]+), type (\w+)\/(\w+), sameChannels (\d+)/

/** Parse one NCCL GRAPH log line (the ncclTopoPrintGraph INFO format). */
export function parseGraphLog(line: string): GraphLogLine | null {
  const m = line.match(LINE_RE)
  if (!m) return null
  const typeIntra = PATH_TYPE_STR.indexOf(m[6] as (typeof PATH_TYPE_STR)[number])
  const typeInter = PATH_TYPE_STR.indexOf(m[7] as (typeof PATH_TYPE_STR)[number])
  if (typeIntra < 0 || typeInter < 0) return null
  return {
    pattern: parseInt(m[1], 10),
    crossNic: parseInt(m[2], 10),
    nChannels: parseInt(m[3], 10),
    bwIntra: parseFloat(m[4]),
    bwInter: parseFloat(m[5]),
    typeIntra: typeIntra as PathType,
    typeInter: typeInter as PathType,
    sameChannels: parseInt(m[8], 10),
  }
}

/** Emit a graph in NCCL's exact log format — so our output diffs against real dumps. */
export function formatGraphLog(g: GraphLogLine): string {
  return (
    `Pattern ${g.pattern}, crossNic ${g.crossNic}, nChannels ${g.nChannels}, ` +
    `bw ${g.bwIntra.toFixed(6)}/${g.bwInter.toFixed(6)}, ` +
    `type ${PATH_TYPE_STR[g.typeIntra]}/${PATH_TYPE_STR[g.typeInter]}, ` +
    `sameChannels ${g.sameChannels}`
  )
}

/**
 * Best-effort NCCL-format line for one of our TopoGraphs.
 * Known lossiness: our TopoGraph stores LinkType (not PathType) for
 * typeIntra/typeInter, so we upconvert via the closest path class.
 */
export function formatTopoGraph(
  graph: TopoGraph,
  opts: { crossNic?: number; sameChannels?: number } = {},
): string {
  const linkToPath = (lt: LinkType): PathType => {
    switch (lt) {
      case LinkType.LOC: return PathType.LOC
      case LinkType.NVL: return PathType.NVL
      case LinkType.C2C: return PathType.C2C
      case LinkType.PCI: return PathType.PIX
      case LinkType.SYS: return PathType.SYS
      case LinkType.NET: return PathType.NET
      default: return PathType.PIX
    }
  }
  return formatGraphLog({
    pattern: graph.pattern,
    crossNic: opts.crossNic ?? 0,
    nChannels: graph.nChannels,
    bwIntra: graph.speedIntra,
    bwInter: graph.speedInter,
    typeIntra: linkToPath(graph.typeIntra),
    typeInter: linkToPath(graph.typeInter),
    sameChannels: opts.sameChannels ?? 1,
  })
}

/**
 * Which relaxation-cascade conditionals (search.cc:1197-1246) must have fired
 * to produce this line — the "back-propagation" through the source.
 *
 * NVLS nuance: sameChannels STARTS at 0 for NVLS (trySameChannels =
 * pattern==NVLS ? 0 : 1, search.cc:1105), so sameChannels=0 on an NVLS line
 * is the starting condition, not a relaxation.
 */
export function impliedRelaxations(g: GraphLogLine): {
  sameChannelsRelaxed: boolean
  typeIntraRelaxed: boolean // beyond the best NVLink class
  typeInterRelaxed: boolean // beyond PIX, the inter minimum (PATH_PIX start)
  crossNicEnabled: boolean
  noneFired: boolean
} {
  const sameChannelsRelaxed = g.sameChannels === 0 && g.pattern !== GraphPattern.NVLS
  const typeIntraRelaxed = g.typeIntra > PathType.NVL
  const typeInterRelaxed = g.typeInter > PathType.PIX
  const crossNicEnabled = g.crossNic !== 0
  return {
    sameChannelsRelaxed,
    typeIntraRelaxed,
    typeInterRelaxed,
    crossNicEnabled,
    noneFired: !sameChannelsRelaxed && !typeIntraRelaxed && !typeInterRelaxed && !crossNicEnabled,
  }
}

/**
 * Bandwidth-conservation inference: each node moves nChannels×bwInter GB/s in
 * each direction over its NICs, so nNics ≥ ceil(nChannels×bwInter / nicBw).
 * Robust regardless of per-NIC channel accounting.
 */
export function minNicsForInterBw(g: GraphLogLine, nicBwGBs: number): number {
  if (nicBwGBs <= 0) return 0
  return Math.ceil((g.nChannels * g.bwInter) / nicBwGBs)
}
