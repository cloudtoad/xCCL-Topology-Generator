import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { DecisionLog } from './DecisionLog'
import { AIExplainer } from './AIExplainer'
import { LineagePanel } from './LineagePanel'
import { PathInspector } from './PathInspector'
import { NodeType, Algorithm, Protocol } from '../../engine/types'

export function InfoPanel() {
  const infoPanel = useUIStore((s) => s.infoPanel)
  const setInfoPanel = useUIStore((s) => s.setInfoPanel)
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const system = useTopologyStore((s) => s.system)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const treeGraph = useTopologyStore((s) => s.treeGraph)
  const nvlsGraph = useTopologyStore((s) => s.nvlsGraph)
  const nvlsSupported = useTopologyStore((s) => s.nvlsSupported)
  const nvlsReason = useTopologyStore((s) => s.nvlsReason)
  const nvlsRuntimeChannels = useTopologyStore((s) => s.nvlsRuntimeChannels)
  const tuning = useTopologyStore((s) => s.tuning)
  const clusterTopo = useTopologyStore((s) => s.clusterTopo)
  const qpPlan = useTopologyStore((s) => s.qpPlan)
  const generationError = useTopologyStore((s) => s.generationError)

  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Tab bar */}
      <div className="flex border-b border-surface-600">
        {(['info', 'decisions', 'lineage', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setInfoPanel(tab)}
            className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-wider transition-colors ${
              infoPanel === tab
                ? 'text-neon-cyan border-b border-neon-cyan bg-neon-cyan/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'ai' ? 'AI Explain' : tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {infoPanel === 'info' && (
          <div className="space-y-3">
            {/* Error display */}
            {generationError && (
              <div className="p-2 rounded border border-neon-red/30 bg-neon-red/5 text-[10px] text-neon-red">
                {generationError}
              </div>
            )}

            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Topology Summary
            </h3>
            {system ? (
              <div className="space-y-2 text-xs">
                <InfoRow label="GPUs" value={system.nodesByType.get(NodeType.GPU)?.length ?? 0} />
                <InfoRow label="NVSwitches" value={system.nodesByType.get(NodeType.NVS)?.length ?? 0} />
                <InfoRow label="CPUs" value={system.nodesByType.get(NodeType.CPU)?.length ?? 0} />
                <InfoRow label="NICs" value={system.nodesByType.get(NodeType.NIC)?.length ?? 0} />
                <InfoRow label="Links" value={system.links.length} />
                <InfoRow label="Paths" value={system.paths.size} />
                <InfoRow label="Max BW" value={`${system.maxBw.toFixed(1)} GB/s`} />
                <InfoRow label="Total BW" value={`${system.totalBw.toFixed(1)} GB/s`} />

                {/* Rail-optimized cluster fabric (multi-node) */}
                {clusterTopo && qpPlan && qpPlan.total > 0 && (
                  <>
                    <div className="border-t border-surface-600 pt-2 mt-2" />
                    <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                      Rail-Optimized Fabric
                    </div>
                    <InfoRow label="Servers" value={clusterTopo.serverCount} />
                    <InfoRow label="Rails" value={clusterTopo.railCount} />
                    <InfoRow label="Channel rings" value={clusterTopo.nChannels} />
                    <InfoRow
                      label="Ring span"
                      value={`${clusterTopo.serverCount * clusterTopo.gpuPerServer} GPUs`}
                    />
                    <InfoRow label="Net hops / ring" value={clusterTopo.serverCount} />
                    <InfoRow
                      label="QPs (total)"
                      value={`${qpPlan.total} (${clusterTopo.nChannels}ch × ${clusterTopo.serverCount} nodes)`}
                    />
                  </>
                )}
                {ringGraph && (
                  <>
                    <div className="border-t border-surface-600 pt-2 mt-2" />
                    <InfoRow label="Ring Channels" value={ringGraph.nChannels} />
                    <InfoRow label="Ring BW/ch" value={`${ringGraph.speedIntra.toFixed(1)} GB/s`} />
                  </>
                )}
                {treeGraph && (
                  <>
                    <InfoRow label="Tree Channels" value={treeGraph.nChannels} />
                    <InfoRow label="Tree BW/ch" value={`${treeGraph.speedIntra.toFixed(1)} GB/s`} />
                  </>
                )}

                {/* NVLS (NVLink SHARP) */}
                {ringGraph && (
                  <>
                    <div className="border-t border-surface-600 pt-2 mt-2" />
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">NVLS (NVLink SHARP)</span>
                      <span
                        className={nvlsSupported ? 'text-neon-green font-medium' : 'text-gray-500 font-medium'}
                        title={nvlsReason}
                      >
                        {nvlsSupported ? 'Supported' : 'Unavailable'}
                      </span>
                    </div>
                    {nvlsSupported && nvlsGraph ? (
                      <>
                        <InfoRow label="NVLS Heads (graph)" value={`${nvlsGraph.nChannels} (1/GPU)`} />
                        <InfoRow label="NVLS CTAs (runtime)" value={nvlsRuntimeChannels} />
                        <InfoRow label="NVLS BW/head" value={`${nvlsGraph.speedIntra.toFixed(1)} GB/s`} />
                      </>
                    ) : (
                      nvlsReason && (
                        <p className="text-[10px] text-gray-600 leading-snug">{nvlsReason}</p>
                      )
                    )}
                  </>
                )}

                {/* Tuning: recommended algorithm for a large all-reduce */}
                {tuning && (
                  <>
                    <div className="border-t border-surface-600 pt-2 mt-2" />
                    <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                      Tuning · 128 MB all-reduce
                    </div>
                    <InfoRow label="Algorithm" value={Algorithm[tuning.algorithm]} />
                    <InfoRow label="Protocol" value={Protocol[tuning.protocol]} />
                    <InfoRow label="Est. bus BW" value={`${tuning.bandwidth.toFixed(0)} GB/s`} />
                    <InfoRow label="Est. latency" value={`${tuning.latency.toFixed(1)} µs`} />
                  </>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-xs">
                No topology generated. Select a template and click Generate.
              </p>
            )}

            {/* Path inspector when 2 nodes are selected */}
            {selectedNodes.length >= 2 && system && (
              <>
                <div className="border-t border-surface-600 pt-3 mt-3" />
                <PathInspector />
              </>
            )}
          </div>
        )}

        {infoPanel === 'decisions' && <DecisionLog />}

        {infoPanel === 'lineage' && <LineagePanel />}

        {infoPanel === 'ai' && <AIExplainer />}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 font-medium">{String(value)}</span>
    </div>
  )
}
