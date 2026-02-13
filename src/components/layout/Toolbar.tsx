import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { useEnvStore } from '../../store/env-store'
import { useDecisionStore } from '../../store/decision-store'
import { computeAllPaths } from '../../engine/paths'
import { DecisionLog } from '../../engine/decision-log'
import { getEnvInt } from '../../engine/env'
import { ModeToggle } from '../controls/ModeToggle'
import { ViewModeSelector } from '../controls/ViewModeSelector'
import { ChannelSelector } from '../controls/ChannelSelector'

export function Toolbar() {
  const sidePanel = useUIStore((s) => s.sidePanel)
  const setSidePanel = useUIStore((s) => s.setSidePanel)
  const infoPanel = useUIStore((s) => s.infoPanel)
  const setInfoPanel = useUIStore((s) => s.setInfoPanel)
  const scaleView = useUIStore((s) => s.scaleView)
  const setScaleView = useUIStore((s) => s.setScaleView)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const showCPUs = useUIStore((s) => s.showCPUs)
  const toggleCPUs = useUIStore((s) => s.toggleCPUs)

  const system = useTopologyStore((s) => s.system)
  const setSystem = useTopologyStore((s) => s.setSystem)
  const envConfig = useEnvStore((s) => s.config)
  const setEnvVar = useEnvStore((s) => s.setVar)
  const addEntries = useDecisionStore((s) => s.addEntries)

  const pxnEnabled = getEnvInt(envConfig, 'NCCL_PXN_DISABLE') === 0

  const handlePXNToggle = () => {
    const newDisabled = pxnEnabled ? 1 : 0
    setEnvVar('NCCL_PXN_DISABLE', newDisabled)

    if (system) {
      // Recompute paths with updated PXN setting
      const updatedEnv = new Map(envConfig)
      const v = updatedEnv.get('NCCL_PXN_DISABLE')
      if (v) updatedEnv.set('NCCL_PXN_DISABLE', { ...v, value: newDisabled })

      const log = new DecisionLog()
      computeAllPaths(system, updatedEnv, log)
      addEntries(log.getEntries())
      // Force React re-render with new reference
      setSystem({ ...system })
    }
  }

  return (
    <div className="h-11 flex-shrink-0 border-b border-surface-600 bg-surface-800 flex items-center px-3 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <span className="text-neon-cyan font-bold text-sm neon-text">xCCL</span>
        <span className="text-gray-400 text-xs">Topology Generator</span>
      </div>

      <div className="w-px h-6 bg-surface-600" />

      {/* Mode toggle */}
      <ModeToggle />

      <div className="w-px h-6 bg-surface-600" />

      {/* View mode */}
      <ViewModeSelector />

      <div className="w-px h-6 bg-surface-600" />

      {/* Scale view: Cluster / Node */}
      <div className="flex items-center gap-1">
        <span className="text-gray-500 text-[10px] mr-1">Scale</span>
        <button
          onClick={() => setScaleView('cluster')}
          className={`btn-secondary text-[10px] ${scaleView === 'cluster' ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
        >
          Cluster
        </button>
        <button
          onClick={() => setScaleView('node')}
          className={`btn-secondary text-[10px] ${scaleView === 'node' ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
        >
          Node
        </button>
        {selectedServer !== null && (
          <span className="text-neon-magenta text-[10px] ml-1">S{selectedServer}</span>
        )}
      </div>

      <div className="w-px h-6 bg-surface-600" />

      {/* Channel selector */}
      <ChannelSelector />

      <div className="w-px h-6 bg-surface-600" />

      {/* Display toggles */}
      <div className="flex items-center gap-1">
        <span className="text-gray-500 text-[10px] mr-1">Show</span>
        <button
          onClick={toggleCPUs}
          className={`btn-secondary text-[10px] ${showCPUs ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
        >
          CPUs
        </button>
        <button
          onClick={handlePXNToggle}
          className={`btn-secondary text-[10px] ${pxnEnabled ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
          title="PXN: Route GPU→NIC traffic through NVLink-connected peer GPU"
        >
          PXN
        </button>
      </div>

      <div className="flex-1" />

      {/* Panel toggles */}
      <button
        onClick={() => setSidePanel(sidePanel === 'builder' ? 'none' : 'builder')}
        className={`btn-secondary text-[10px] ${sidePanel === 'builder' ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
      >
        Builder
      </button>
      <button
        onClick={() => setInfoPanel(infoPanel === 'info' ? 'none' : 'info')}
        className={`btn-secondary text-[10px] ${infoPanel !== 'none' ? 'text-neon-cyan border-neon-cyan/30' : ''}`}
      >
        Info
      </button>
    </div>
  )
}
