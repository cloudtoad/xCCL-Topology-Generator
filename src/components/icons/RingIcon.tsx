interface RingIconProps {
  size?: number
  color?: string
  className?: string
}

/** 8 rectangles arranged end-to-end in a closed ring */
export function RingIcon({ size = 20, color = 'currentColor', className }: RingIconProps) {
  const n = 8
  const cx = 12, cy = 12
  const r = 7
  const rectW = 4, rectH = 2.2

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {Array.from({ length: n }, (_, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2
        const x = cx + r * Math.cos(angle)
        const y = cy + r * Math.sin(angle)
        const deg = (angle * 180) / Math.PI + 90
        return (
          <rect
            key={i}
            x={x - rectW / 2}
            y={y - rectH / 2}
            width={rectW}
            height={rectH}
            rx={0.5}
            transform={`rotate(${deg} ${x} ${y})`}
            fill={color}
            opacity={0.9}
          />
        )
      })}
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={0.6} fill="none" opacity={0.3} />
    </svg>
  )
}
