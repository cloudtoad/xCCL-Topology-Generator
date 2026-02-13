import type { TopoSystem, TopoGraph, HardwareConfig, DecisionEntry } from '../engine/types'
import type { EnvConfig, EnvVarDef } from '../engine/env'

export function buildContext(
  config: HardwareConfig | null,
  system: TopoSystem | null,
  ringGraph: TopoGraph | null,
  treeGraph: TopoGraph | null,
  envConfig: EnvConfig,
  decisions: DecisionEntry[],
): string {
  const parts: string[] = []

  // Hardware config
  if (config) {
    parts.push(`## Hardware Configuration
- GPUs: ${config.gpu.count}× ${config.gpu.type} (compute cap ${config.gpu.cudaCompCap})
- NVLinks per pair: ${config.gpu.nvlinksPerPair}
- NVSwitches: ${config.nvswitch.count}
- CPUs: ${config.cpu.count}× (arch=${config.cpu.arch}, vendor=${config.cpu.vendor}, model=${config.cpu.model})
- NICs: ${config.nic.count}× at ${config.nic.speed} GB/s (GDR: ${config.nic.gdrSupport})
- PCIe: Gen${config.pcie.gen} x${config.pcie.width}
- NUMA mapping: [${config.numaMapping.join(', ')}]`)
  }

  // Environment overrides
  const overrides: EnvVarDef[] = []
  for (const v of envConfig.values()) {
    if (v.value !== null) overrides.push(v)
  }
  if (overrides.length > 0) {
    parts.push(`## Environment Variable Overrides
${overrides.map((v) => `- ${v.name} = ${v.value} (default: ${v.default})`).join('\n')}`)
  }

  // Topology summary
  if (system) {
    parts.push(`## Topology Summary
- Max BW: ${system.maxBw.toFixed(1)} GB/s
- Total BW: ${system.totalBw.toFixed(1)} GB/s
- Inter-node: ${system.inter}
- Nodes: ${system.nodes.length}
- Links: ${system.links.length}
- Paths computed: ${system.paths.size}`)
  }

  // Ring graph
  if (ringGraph) {
    parts.push(`## Ring Graph
- Channels: ${ringGraph.nChannels}
- BW Intra: ${ringGraph.speedIntra.toFixed(1)} GB/s
- BW Inter: ${ringGraph.speedInter.toFixed(1)} GB/s
- Type Intra: ${ringGraph.typeIntra}
- Type Inter: ${ringGraph.typeInter}`)

    // Show first few channel orderings
    const showChannels = Math.min(ringGraph.nChannels, 4)
    for (let i = 0; i < showChannels; i++) {
      const ch = ringGraph.channels[i]
      if (ch) {
        parts.push(`  Channel ${i}: ${ch.ringOrder.join(' → ')}`)
      }
    }
  }

  // Tree graph
  if (treeGraph) {
    parts.push(`## Tree Graph
- Channels: ${treeGraph.nChannels}
- BW Intra: ${treeGraph.speedIntra.toFixed(1)} GB/s`)
  }

  // Decision log (truncated for token budget)
  if (decisions.length > 0) {
    const maxDecisions = 50
    const shown = decisions.slice(-maxDecisions)
    parts.push(`## Decision Log (last ${shown.length} of ${decisions.length})
${shown.map((d) => `[${d.step}] ${d.phase}: ${d.action} — ${d.reason} (${d.sourceRef})`).join('\n')}`)
  }

  return parts.join('\n\n')
}
