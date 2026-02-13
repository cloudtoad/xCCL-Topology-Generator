import { useState, useCallback } from 'react'
import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { useEnvStore } from '../../store/env-store'
import { useDecisionStore } from '../../store/decision-store'
import { TemplateSelector } from './TemplateSelector'
import { HardwareConfig } from './HardwareConfig'
import { SUBuilder } from './SUBuilder'
import { EnvVarPanel } from './EnvVarPanel'
import { runInit } from '../../engine/init'

type AccordionSection = 'template' | 'hardware' | 'su' | 'env' | null

export function BuilderSidebar() {
  const mode = useUIStore((s) => s.mode)
  const [openSection, setOpenSection] = useState<AccordionSection>('template')

  const hardwareConfig = useTopologyStore((s) => s.hardwareConfig)
  const suConfig = useTopologyStore((s) => s.suConfig)
  const setSystem = useTopologyStore((s) => s.setSystem)
  const setRingGraph = useTopologyStore((s) => s.setRingGraph)
  const setTreeGraph = useTopologyStore((s) => s.setTreeGraph)
  const setGenerating = useTopologyStore((s) => s.setGenerating)
  const setGenerationError = useTopologyStore((s) => s.setGenerationError)
  const isGenerating = useTopologyStore((s) => s.isGenerating)
  const envConfig = useEnvStore((s) => s.config)
  const addEntries = useDecisionStore((s) => s.addEntries)
  const clearDecisions = useDecisionStore((s) => s.clear)

  const toggle = (section: AccordionSection) => {
    setOpenSection((prev) => (prev === section ? null : section))
  }

  const handleGenerate = useCallback(() => {
    if (!hardwareConfig) return

    setGenerating(true)
    setGenerationError(null)
    clearDecisions()

    // Run in a microtask to allow UI to update
    setTimeout(() => {
      try {
        const result = runInit(hardwareConfig, envConfig, suConfig)
        setSystem(result.system)
        setRingGraph(result.ringGraph)
        setTreeGraph(result.treeGraph)
        addEntries(result.log.getEntries())
        setGenerating(false)
      } catch (err) {
        setGenerationError(err instanceof Error ? err.message : String(err))
        setGenerating(false)
      }
    }, 10)
  }, [hardwareConfig, suConfig, envConfig, setSystem, setRingGraph, setTreeGraph, setGenerating, setGenerationError, addEntries, clearDecisions])

  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Header */}
      <div className="panel-header flex items-center justify-between">
        <span className={mode === 'nccl' ? 'text-neon-green' : 'text-neon-orange'}>
          {mode.toUpperCase()} Builder
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Template Selector */}
        <AccordionPanel
          title="Templates"
          isOpen={openSection === 'template'}
          onToggle={() => toggle('template')}
        >
          <TemplateSelector />
        </AccordionPanel>

        {/* Hardware Config */}
        <AccordionPanel
          title="Hardware"
          isOpen={openSection === 'hardware'}
          onToggle={() => toggle('hardware')}
        >
          <HardwareConfig />
        </AccordionPanel>

        {/* Scalable Unit */}
        <AccordionPanel
          title="Scalable Unit"
          isOpen={openSection === 'su'}
          onToggle={() => toggle('su')}
        >
          <SUBuilder />
        </AccordionPanel>

        {/* Environment Variables */}
        <AccordionPanel
          title="Environment"
          isOpen={openSection === 'env'}
          onToggle={() => toggle('env')}
        >
          <EnvVarPanel />
        </AccordionPanel>
      </div>

      {/* Generate button */}
      <div className="p-3 border-t border-surface-600">
        <button
          onClick={handleGenerate}
          disabled={!hardwareConfig || isGenerating}
          className={`w-full py-2 rounded text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
            !hardwareConfig
              ? 'bg-surface-700 text-gray-600 cursor-not-allowed'
              : isGenerating
                ? 'bg-neon-cyan/20 text-neon-cyan cursor-wait'
                : 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 active:bg-neon-cyan/30'
          }`}
        >
          {isGenerating ? 'Generating...' : 'Generate Topology'}
        </button>
      </div>
    </div>
  )
}

function AccordionPanel({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-surface-600">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium hover:bg-surface-700/30 transition-colors"
      >
        <span className={isOpen ? 'text-gray-200' : 'text-gray-400'}>{title}</span>
        <span className="text-gray-600 text-[10px]">{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}
