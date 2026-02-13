// =============================================================================
// RCCL Constants — from RCCL source code (rocm-systems/projects/rccl/)
// =============================================================================

// --- xGMI bandwidth constants (rccl topo.h:36-39) ---
export const VEGA_XGMI_WIDTH = 24.0      // topo.h:36 — Vega default
export const MI200_XGMI_WIDTH = 36.0     // topo.h:37 — MI200 (gfx90a)
export const GFX94X_XGMI_WIDTH = 48.0    // topo.h:38 — MI300X (gfx942)
export const GFX95X_XGMI_WIDTH = 48.0    // topo.h:39 — gfx95x

// xGMI bandwidth by GPU architecture (rccl topo.h:310-320)
export function xgmiWidth(gcnArch: string): number {
  if (gcnArch.startsWith('gfx95')) return GFX95X_XGMI_WIDTH
  if (gcnArch === 'gfx942' || gcnArch.startsWith('gfx94')) return GFX94X_XGMI_WIDTH
  if (gcnArch === 'gfx90a') return MI200_XGMI_WIDTH
  return VEGA_XGMI_WIDTH
}

// Map GPU type names to GCN architectures
export const gpuTypeToGcnArch: Record<string, string> = {
  'MI300X': 'gfx942',
  'MI300A': 'gfx942',
  'MI250X': 'gfx90a',
  'MI250': 'gfx90a',
  'MI210': 'gfx90a',
  'MI100': 'gfx908',
  'MI60': 'gfx906',
  'MI50': 'gfx906',
}

// --- RCCL topology type flags ---
export const RCCL_TOPO_CR8G = 0x01  // Chordal ring 8 GPUs

// --- Total number of pre-computed Rome models ---
export const ROME_MODEL_COUNT = 46  // rome_models.cc: romeTopoModels[] array

// --- RCCL-specific NCCL_PARAM equivalents ---
// These RCCL_PARAM declarations map to RCCL_* environment variables
export const RCCL_PARAMS = {
  MODEL_REVERSAL_DISABLE: { name: 'RCCL_MODEL_REVERSAL_DISABLE', default: 0, sourceRef: 'rome_models.cc:1811' },
  MSCCL_ENABLE: { name: 'RCCL_MSCCL_ENABLE', default: 1, sourceRef: 'msccl_lifecycle.cc' },
} as const

// --- NBIO grouping mask (rome_models.cc:2383) ---
export const NBIO_MASK = 0xf0000

// --- Chordal ring base for 8-GPU 6-link topology (rome_models.cc:2115) ---
export const CHORDAL_RING_8P6L_BASE =
  '0 1 2 3 5 4 7 6|0 2 4 1 7 3 6 5|0 3 1 5 7 2 6 4|0 6 7 4 5 3 2 1|0 5 6 3 7 1 4 2|0 4 6 2 7 5 1 3'
