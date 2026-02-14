import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { DecisionLog } from './DecisionLog'
import { AIExplainer } from './AIExplainer'
import { PathInspector } from './PathInspector'
import { NodeType } from '../../engine/types'

export function InfoPanel() {
  const infoPanel = useUIStore((s) => s.infoPanel)
  const setInfoPanel = useUIStore((s) => s.setInfoPanel)
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const system = useTopologyStore((s) => s.system)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const treeGraph = useTopologyStore((s) => s.treeGraph)
  const generationError = useTopologyStore((s) => s.generationError)

  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Tab bar */}
      <div className="flex border-b border-surface-600">
        {(['info', 'decisions', 'ai'] as const).map((tab) => (
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
