// Node type → color mapping (retro-futuristic neon palette)
export const nodeColors = {
  GPU: '#00ffff',     // Cyan
  CPU: '#ff00ff',     // Magenta
  NIC: '#00ff41',     // Green
  NVS: '#ffff00',     // Yellow (NVSwitch)
  PCI: '#ff6600',     // Orange (PCIe switch)
  NET: '#ff6600',     // Orange (network)
} as const

// Link type → color mapping
export const linkColors = {
  NVL: '#00ffff',     // Cyan — NVLink
  NVB: '#0088ff',     // Blue — NVLink via NVSwitch bounce
  PIX: '#ff00ff',     // Magenta — Same PCIe switch
  PXB: '#cc00cc',     // Dark magenta — Cross PCIe switch
  PXN: '#aa00aa',     // Purple — Cross PCIe via NUMA
  PHB: '#8800aa',     // Deep purple — Cross PCIe via CPU
  SYS: '#ffff00',     // Yellow — Cross-socket
  NET: '#00ff41',     // Green — Network
  LOC: '#ffffff',     // White — Loopback
  XGM: '#00ffff',     // Cyan — xGMI (AMD)
} as const

// Path type → color
export const pathColors = {
  LOC: '#ffffff',
  NVL: '#00ffff',
  NVB: '#0088ff',
  PIX: '#ff00ff',
  PXB: '#cc00cc',
  PXN: '#aa00aa',
  PHB: '#8800aa',
  SYS: '#ffff00',
  NET: '#00ff41',
} as const

// =============================================================================
// Tufte layer system — layering & separation + proportional ink
//
// Physical links form the CONTEXT layer: muted, hue-family preserved so color
// memory transfers (cyan-ish NVLink, mauve PCIe, sage NET), with brightness
// and width proportional to bandwidth ("proportional ink" — a 92.7 GB/s
// NVLink should not weigh the same as a 12 GB/s PCIe lane). Muted colors also
// fall below the bloom threshold (0.2), so only the FOCUS layer (rails,
// rings, frames — full saturation) glows. Saturated hover states give
// Tufte's "detail on demand".
// =============================================================================

export const contextLinkColors = {
  NVL: '#5a8a96',   // steel cyan   (was neon cyan)
  NVB: '#4a6a8a',   // slate blue
  PIX: '#7a5a76',   // mauve        (was neon magenta)
  SYS: '#77704a',   // olive        (was neon yellow)
  NET: '#567a5e',   // sage         (was neon green)
  LOC: '#666670',   // gray
} as const

/** Proportional ink: line width (px) ∝ √bandwidth, clamped to a legible range. */
export function linkInkWidth(bwGBs: number): number {
  return 0.8 + 2.4 * Math.sqrt(Math.min(Math.max(bwGBs, 0), 120) / 120)
}

/** Context-layer luminance factor ∝ bandwidth (higher-bw links read brighter). */
export function bwBrightness(bwGBs: number): number {
  return 0.35 + 0.65 * Math.min(1, Math.max(bwGBs, 0) / 100)
}

// Channel colors — distinct colors for up to 64 channels
const channelHues = Array.from({ length: 64 }, (_, i) => (i * 137.508) % 360)
export const channelColors = channelHues.map(
  (h) => `hsl(${h}, 100%, 60%)`
)

// General palette
export const palette = {
  bg: '#0a0a0f',
  surface: '#12121a',
  border: '#222230',
  text: '#e0e0e0',
  textDim: '#888899',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  green: '#00ff41',
  yellow: '#ffff00',
  orange: '#ff6600',
  red: '#ff0040',
} as const
