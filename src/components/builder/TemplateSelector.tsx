import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import { templates, type TemplateEntry } from '../../engine/templates'

export function TemplateSelector() {
  const mode = useUIStore((s) => s.mode)
  const setHardwareConfig = useTopologyStore((s) => s.setHardwareConfig)

  const filtered = templates.filter(
    (t) => t.mode === mode || t.mode === 'both',
  )

  return (
    <div className="space-y-2">
      {filtered.map((t) => (
        <TemplateCard key={t.id} template={t} onSelect={() => setHardwareConfig({ ...t.config })} />
      ))}
    </div>
  )
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: TemplateEntry
  onSelect: () => void
}) {
  const hardwareConfig = useTopologyStore((s) => s.hardwareConfig)
  const isSelected = hardwareConfig?.name === template.config.name

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-2.5 rounded border transition-all duration-150 ${
        isSelected
          ? 'border-neon-cyan/50 bg-neon-cyan/5'
          : 'border-surface-600 hover:border-surface-600/80 hover:bg-surface-700/30'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={`text-xs font-semibold ${
            isSelected ? 'text-neon-cyan' : 'text-gray-200'
          }`}
        >
          {template.config.name}
        </span>
        <span className="text-[9px] text-gray-500 uppercase">
          {template.config.gpu.count}× {template.config.gpu.type}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        {template.description}
      </p>
    </button>
  )
}
