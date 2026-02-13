interface ChainIconProps {
  size?: number
  color?: string
  className?: string
}

/** Two interlocking chain links — represents a chain/pipeline pattern */
export function ChainIcon({ size = 20, color = 'currentColor', className }: ChainIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Left link — rounded rectangle outline, tilted */}
      <rect
        x={3} y={6}
        width={10} height={5.5}
        rx={2.75}
        stroke={color}
        strokeWidth={1.8}
        transform="rotate(-30 8 8.75)"
        opacity={0.9}
      />
      {/* Right link — rounded rectangle outline, tilted */}
      <rect
        x={11} y={12.5}
        width={10} height={5.5}
        rx={2.75}
        stroke={color}
        strokeWidth={1.8}
        transform="rotate(-30 16 15.25)"
        opacity={0.9}
      />
    </svg>
  )
}
