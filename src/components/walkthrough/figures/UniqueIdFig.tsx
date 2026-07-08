// The "OPEN message": ncclUniqueId is a ncclBootstrapHandle zero-padded to
// 128 bytes (bootstrap.h:14-20). Byte widths drawn to scale.
const SEGMENTS = [
  { label: 'magic', bytes: 8, color: '#00ffff', note: 'uint64_t — session cookie' },
  { label: 'addr', bytes: 28, color: '#ff00ff', note: 'union ncclSocketAddress — the ROOT’s IP:port' },
  { label: 'nRanks', bytes: 4, color: '#00ff41', note: 'int — existing ranks' },
  { label: 'zero padding', bytes: 88, color: '#333344', note: 'reset to 0 (init.cc:192)' },
]
const TOTAL = 128

export function UniqueIdFig() {
  return (
    <div className="font-mono text-[11px]">
      <div className="text-gray-400 mb-2">
        ncclUniqueId — 128 bytes, what MPI_Bcast / TCPStore actually carries:
      </div>
      <div className="flex w-full h-10 rounded overflow-hidden border border-surface-600">
        {SEGMENTS.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-center text-[10px] text-black font-bold"
            style={{
              width: `${(s.bytes / TOTAL) * 100}%`,
              backgroundColor: s.color,
              opacity: s.label === 'zero padding' ? 0.6 : 0.9,
            }}
          >
            <span className={s.label === 'zero padding' ? 'text-gray-400' : ''}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex w-full text-[9px] text-gray-500 mt-1">
        {SEGMENTS.map((s, i) => (
          <div key={s.label} style={{ width: `${(s.bytes / TOTAL) * 100}%` }}>
            {SEGMENTS.slice(0, i).reduce((a, x) => a + x.bytes, 0)}
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1">
        {SEGMENTS.map((s) => (
          <li key={s.label} className="flex gap-2 items-baseline">
            <span
              className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-gray-300">{s.label}</span>
            <span className="text-gray-500">— {s.bytes} B, {s.note}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-gray-500">
        Not an ID — an <span className="text-gray-300">address</span>. static_assert
        (sizeof handle ≤ sizeof uniqueId), bootstrap.h:19. If this blob doesn&rsquo;t
        reach a rank, that rank hangs with zero NCCL output.
      </div>
    </div>
  )
}
