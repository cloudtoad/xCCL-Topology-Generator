// =============================================================================
// RCCL Rome Models — pre-computed topology models from rome_models.cc
//
// Each model represents a known AMD server hardware configuration with
// pre-computed optimal ring and tree orderings. When RCCL detects a matching
// topology, it uses these orderings instead of running the expensive search.
//
// The 46 models cover various AMD Rome/Milan/Genoa configurations with
// different GPU counts, CPU counts, NIC counts, and xGMI link topologies.
// =============================================================================

import { PathType } from '../types'

// =============================================================================
// Types
// =============================================================================

export interface RcclRomeModel {
  id: string              // Model identifier (e.g. "rome_model_22")
  nGpus: number
  nCpus: number
  nNics: number
  nLinks: number          // xGMI links per GPU
  gpuNuma: number[]       // GPU index -> NUMA node
  nicNuma: number[]       // NIC index -> NUMA node
  connMatrix: number[]    // nGpus x nGpus connectivity matrix (flattened)
  gdrLevel: number[]      // nNics x nGpus GDR path levels (flattened)
  pattern: string         // NUMA pattern string (e.g. "10302120")
  ringBase: string        // Pre-computed ring orderings (pipe-separated)
  treeBase?: string       // Pre-computed tree orderings
  treeRail?: string       // Rail tree orderings
  options?: string        // Additional options
}

// =============================================================================
// Model Data — representative subset of the 46 models from rome_models.cc
//
// The full source has 46 models (rome_models.cc lines 55-760). We include
// a representative set covering the most common configurations:
// - 2-link and 3-link xGMI topologies
// - 1, 2, 4, and 8 CPU configurations
// - 0, 1, 2, and 4 NIC configurations
// =============================================================================

// rome_model_22 — Index 0: 8 GPUs, 4 CPUs, 1 NIC, 2 links
const rome_model_22: RcclRomeModel = {
  id: 'rome_model_22',
  nGpus: 8, nCpus: 4, nNics: 1, nLinks: 2,
  gpuNuma: [1, 0, 1, 2, 3, 1, 2, 3],
  nicNuma: [2],
  connMatrix: [
    0, 1, 0, 0, 0, 0, 1, 0,
    1, 0, 1, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 0, 0, 0, 0,
    0, 0, 1, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 0, 0, 1, 0, 1, 0,
    1, 0, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 1, 1, 0, 0, 0,
  ],
  gdrLevel: [PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.SYS, PathType.SYS, PathType.PHB, PathType.SYS],
  pattern: '10302120',
  ringBase: '7 4 5 3 1 0 6 2|4 7 3 5 0 1 2 6',
}

// rome_model_25 — Index 1: 8 GPUs, 4 CPUs, 2 NICs, 2 links
const rome_model_25: RcclRomeModel = {
  id: 'rome_model_25',
  nGpus: 8, nCpus: 4, nNics: 2, nLinks: 2,
  gpuNuma: [0, 1, 1, 1, 2, 2, 2, 3],
  nicNuma: [0, 3],
  connMatrix: [
    0, 1, 0, 1, 0, 0, 0, 0,
    1, 0, 1, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 0, 0, 0, 0,
    1, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 0, 0, 1, 0, 1, 0,
    0, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 0, 0, 1, 0, 1, 0,
  ],
  gdrLevel: [
    PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB,
  ],
  pattern: '11303011',
  ringBase: '2 1 0 3 6 7 5 4|7 6 4 5 1 2 3 0',
}

// rome_model_29 — Index 3: 8 GPUs, 4 CPUs, 1 NIC, 3 links
const rome_model_29: RcclRomeModel = {
  id: 'rome_model_29',
  nGpus: 8, nCpus: 4, nNics: 1, nLinks: 3,
  gpuNuma: [0, 1, 1, 1, 2, 2, 3, 3],
  nicNuma: [2],
  connMatrix: [
    0, 1, 1, 1, 0, 0, 0, 0,
    1, 0, 1, 1, 0, 0, 0, 0,
    1, 1, 0, 1, 0, 0, 0, 0,
    1, 1, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 1, 1,
    0, 0, 0, 0, 1, 0, 1, 1,
    0, 0, 0, 0, 1, 1, 0, 1,
    0, 0, 0, 0, 1, 1, 1, 0,
  ],
  gdrLevel: [PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS],
  pattern: '10302120',
  ringBase: '0 1 3 2 4 5 7 6|6 7 5 4 2 3 1 0|0 1 2 3 4 6 7 5|5 7 6 4 3 2 1 0',
}

// rome_model_52 — Index 20: 8 GPUs, 1 CPU, 0 NICs, 3 links
const rome_model_52: RcclRomeModel = {
  id: 'rome_model_52',
  nGpus: 8, nCpus: 1, nNics: 0, nLinks: 3,
  gpuNuma: [0, 0, 0, 0, 0, 0, 0, 0],
  nicNuma: [],
  connMatrix: [
    0, 1, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 0, 1, 0, 0,
    1, 0, 0, 1, 1, 0, 0, 0,
    0, 1, 1, 0, 0, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 0, 1, 0, 0, 1,
    0, 0, 0, 1, 0, 1, 1, 0,
  ],
  gdrLevel: [],
  pattern: '80',
  ringBase: '0 1 3 2 4 5 7 6|6 7 5 4 2 3 1 0|0 1 5 4 6 7 3 2|2 3 7 6 4 5 1 0',
}

// rome_model_53 — Index 21: 8 GPUs, 4 CPUs, 4 NICs, 3 links
const rome_model_53: RcclRomeModel = {
  id: 'rome_model_53',
  nGpus: 8, nCpus: 4, nNics: 4, nLinks: 3,
  gpuNuma: [1, 1, 3, 3, 5, 5, 7, 7],
  nicNuma: [1, 3, 5, 7],
  connMatrix: [
    0, 1, 1, 1, 0, 0, 0, 0,
    1, 0, 1, 1, 0, 0, 0, 0,
    1, 1, 0, 1, 0, 0, 0, 0,
    1, 1, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 1, 1,
    0, 0, 0, 0, 1, 0, 1, 1,
    0, 0, 0, 0, 1, 1, 0, 1,
    0, 0, 0, 0, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB,
  ],
  pattern: '21212121',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N3|N3 7 6 5 4 3 2 1 0 N0|N1 2 3 0 1 6 7 4 5 N2|N2 5 4 7 6 1 0 3 2 N1',
}

// rome_model_43 — Index 22: 8 GPUs, 4 CPUs, 0 NICs, 3 links
const rome_model_43: RcclRomeModel = {
  id: 'rome_model_43',
  nGpus: 8, nCpus: 4, nNics: 0, nLinks: 3,
  gpuNuma: [0, 0, 1, 1, 2, 2, 3, 3],
  nicNuma: [],
  connMatrix: [
    0, 1, 1, 1, 0, 0, 0, 0,
    1, 0, 1, 1, 0, 0, 0, 0,
    1, 1, 0, 1, 0, 0, 0, 0,
    1, 1, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 1, 1,
    0, 0, 0, 0, 1, 0, 1, 1,
    0, 0, 0, 0, 1, 1, 0, 1,
    0, 0, 0, 0, 1, 1, 1, 0,
  ],
  gdrLevel: [],
  pattern: '20202020',
  ringBase: '0 1 3 2 4 5 7 6|6 7 5 4 2 3 1 0|0 2 3 1 4 6 7 5|5 7 6 4 1 3 2 0',
}

// rome_model_55 — Index 23: 8 GPUs, 2 CPUs, 0 NICs, 7 links (MI300X all-to-all)
const rome_model_55: RcclRomeModel = {
  id: 'rome_model_55',
  nGpus: 8, nCpus: 2, nNics: 0, nLinks: 7,
  gpuNuma: [0, 0, 0, 0, 1, 1, 1, 1],
  nicNuma: [],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [],
  pattern: '4040',
  ringBase: '0 1 2 3 4 5 6 7|7 6 5 4 3 2 1 0|0 2 1 3 4 6 5 7|7 5 6 4 3 1 2 0|0 3 2 1 4 7 6 5|5 6 7 4 1 2 3 0',
}

// rome_model_56 — Index 24: 8 GPUs, 2 CPUs, 2 NICs, 7 links (MI300X with NICs)
const rome_model_56: RcclRomeModel = {
  id: 'rome_model_56',
  nGpus: 8, nCpus: 2, nNics: 2, nLinks: 7,
  gpuNuma: [0, 0, 0, 0, 1, 1, 1, 1],
  nicNuma: [0, 1],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
  ],
  pattern: '4141',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N1|N1 7 6 5 4 3 2 1 0 N0|N0 0 2 1 3 4 6 5 7 N1|N1 7 5 6 4 3 1 2 0 N0',
}

// rome_model_58 — Index 25: 8 GPUs, 2 CPUs, 4 NICs, 7 links (MI300X 4 NICs)
const rome_model_58: RcclRomeModel = {
  id: 'rome_model_58',
  nGpus: 8, nCpus: 2, nNics: 4, nLinks: 7,
  gpuNuma: [0, 0, 0, 0, 1, 1, 1, 1],
  nicNuma: [0, 0, 1, 1],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
  ],
  pattern: '4242',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N3|N3 7 6 5 4 3 2 1 0 N0|N1 0 2 1 3 4 6 5 7 N2|N2 7 5 6 4 3 1 2 0 N1',
}

// rome_model_59 — Index 26: 8 GPUs, 2 CPUs, 8 NICs, 7 links (MI300X 8 NICs)
const rome_model_59: RcclRomeModel = {
  id: 'rome_model_59',
  nGpus: 8, nCpus: 2, nNics: 8, nLinks: 7,
  gpuNuma: [0, 0, 0, 0, 1, 1, 1, 1],
  nicNuma: [0, 0, 0, 0, 1, 1, 1, 1],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PHB, PathType.PHB, PathType.PHB, PathType.PHB,
  ],
  pattern: '4848',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N7|N7 7 6 5 4 3 2 1 0 N0|N1 0 2 1 3 4 6 5 7 N6|N6 7 5 6 4 3 1 2 0 N1|N2 0 3 2 1 4 7 6 5 N5|N5 5 6 7 4 1 2 3 0 N2|N3 0 1 3 2 4 5 7 6 N4|N4 6 7 5 4 2 3 1 0 N3',
}

// rome_model_62 — Index 27: 8 GPUs, 4 CPUs, 0 NICs, 7 links
const rome_model_62: RcclRomeModel = {
  id: 'rome_model_62',
  nGpus: 8, nCpus: 4, nNics: 0, nLinks: 7,
  gpuNuma: [0, 0, 1, 1, 2, 2, 3, 3],
  nicNuma: [],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [],
  pattern: '20202020',
  ringBase: '0 1 2 3 4 5 6 7|7 6 5 4 3 2 1 0|0 2 1 3 4 6 5 7|7 5 6 4 3 1 2 0|0 3 2 1 4 7 6 5|5 6 7 4 1 2 3 0',
}

// rome_model_65 — Index 29: 8 GPUs, 4 CPUs, 4 NICs, 7 links
const rome_model_65: RcclRomeModel = {
  id: 'rome_model_65',
  nGpus: 8, nCpus: 4, nNics: 4, nLinks: 7,
  gpuNuma: [0, 0, 1, 1, 2, 2, 3, 3],
  nicNuma: [0, 1, 2, 3],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB,
  ],
  pattern: '21212121',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N3|N3 7 6 5 4 3 2 1 0 N0|N1 2 3 0 1 6 7 4 5 N2|N2 5 4 7 6 1 0 3 2 N1',
}

// rome_model_66 — Index 30: 8 GPUs, 4 CPUs, 8 NICs, 7 links
const rome_model_66: RcclRomeModel = {
  id: 'rome_model_66',
  nGpus: 8, nCpus: 4, nNics: 8, nLinks: 7,
  gpuNuma: [0, 0, 1, 1, 2, 2, 3, 3],
  nicNuma: [0, 0, 1, 1, 2, 2, 3, 3],
  connMatrix: [
    0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
  ],
  gdrLevel: [
    PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB, PathType.SYS, PathType.SYS,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB,
    PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.SYS, PathType.PXB, PathType.PXB,
  ],
  pattern: '22222222',
  ringBase: 'N0 0 1 2 3 4 5 6 7 N7|N7 7 6 5 4 3 2 1 0 N0|N1 0 2 1 3 4 6 5 7 N6|N6 7 5 6 4 3 1 2 0 N1|N2 0 3 2 1 4 7 6 5 N5|N5 5 6 7 4 1 2 3 0 N2|N3 0 1 3 2 4 5 7 6 N4|N4 6 7 5 4 2 3 1 0 N3',
}

// =============================================================================
// Model Registry — the array that the matching algorithm searches through
// Mirrors romeTopoModels[] from rome_models.cc:1761-1808
// =============================================================================

export const romeTopoModels: RcclRomeModel[] = [
  rome_model_22,   //  0
  rome_model_25,   //  1
  rome_model_29,   //  3 (representative 3-link)
  rome_model_52,   // 20 (single CPU, 3 links)
  rome_model_53,   // 21 (4 CPUs, 4 NICs, 3 links)
  rome_model_43,   // 22 (4 CPUs, 0 NICs, 3 links)
  rome_model_55,   // 23 (MI300X all-to-all, 2 CPUs, 0 NICs)
  rome_model_56,   // 24 (MI300X all-to-all, 2 CPUs, 2 NICs)
  rome_model_58,   // 25 (MI300X all-to-all, 2 CPUs, 4 NICs)
  rome_model_59,   // 26 (MI300X all-to-all, 2 CPUs, 8 NICs)
  rome_model_62,   // 27 (all-to-all, 4 CPUs, 0 NICs)
  rome_model_65,   // 29 (all-to-all, 4 CPUs, 4 NICs)
  rome_model_66,   // 30 (all-to-all, 4 CPUs, 8 NICs)
]
