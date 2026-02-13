import { useUIStore, type XCCLMode } from '../../store/ui-store'

export function ModeToggle() {
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)

  const modes: { value: XCCLMode; label: string; color: string }[] = [
    { value: 'nccl', label: 'NCCL', color: 'text-neon-green' },
    { value: 'rccl', label: 'RCCL', color: 'text-neon-orange' },
  ]

  return (
    <div className="flex items-center gap-1">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => setMode(m.value)}
          className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all duration-150 border ${
            mode === m.value
              ? `${m.color} border-current bg-current/10`
              : 'text-gray-500 border-transparent hover:text-gray-300'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
