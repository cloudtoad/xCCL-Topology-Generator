interface TreeIconProps {
  size?: number
  color?: string
  className?: string
}

/** Inverted Y with circular terminals — represents a tree/reduction pattern */
export function TreeIcon({ size = 20, color = 'currentColor', className }: TreeIconProps) {
  const r = 2.2 // terminal radius

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Trunk: root up to fork */}
      <line x1={12} y1={4} x2={12} y2={13} stroke={color} strokeWidth={1.2} opacity={0.5} />
      {/* Left branch */}
      <line x1={12} y1={13} x2={5} y2={20} stroke={color} strokeWidth={1.2} opacity={0.5} />
      {/* Right branch */}
      <line x1={12} y1={13} x2={19} y2={20} stroke={color} strokeWidth={1.2} opacity={0.5} />

      {/* Root terminal */}
      <circle cx={12} cy={4} r={r} fill={color} opacity={0.9} />
      {/* Left terminal */}
      <circle cx={5} cy={20} r={r} fill={color} opacity={0.9} />
      {/* Right terminal */}
      <circle cx={19} cy={20} r={r} fill={color} opacity={0.9} />
    </svg>
  )
}
