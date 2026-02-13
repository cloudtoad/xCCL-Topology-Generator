import { useState } from 'react'
import { Line, Text } from '@react-three/drei'
import { type TopoLink, LinkType } from '../../engine/types'
import { linkColors } from '../../utils/colors'
import { nodeRadius } from '../../utils/geometry'

const linkTypeToKey: Record<number, keyof typeof linkColors> = {
  [LinkType.LOC]: 'LOC',
  [LinkType.NVL]: 'NVL',
  [LinkType.C2C]: 'NVB',
  [LinkType.PCI]: 'PIX',
  [LinkType.SYS]: 'SYS',
  [LinkType.NET]: 'NET',
}

const DIM_COLOR = '#181822'

interface LinkLineProps {
  link: TopoLink
  from: [number, number, number]
  to: [number, number, number]
  dimmed?: boolean
}

export function LinkLine({ link, from, to, dimmed = false }: LinkLineProps) {
  const [hovered, setHovered] = useState(false)

  // Shorten endpoints so links stop at shape edges
  let p0: [number, number, number] = from
  let p1: [number, number, number] = to
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len > 0) {
    const nx = dx / len, nz = dz / len
    const r0 = nodeRadius(link.fromId)
    const r1 = nodeRadius(link.toId)
    p0 = [from[0] + nx * r0, from[1], from[2] + nz * r0]
    p1 = [to[0] - nx * r1, to[1], to[2] - nz * r1]
  }

  const color = dimmed ? DIM_COLOR : (linkColors[linkTypeToKey[link.type] ?? 'LOC'] ?? '#444466')
  const midpoint: [number, number, number] = [
    (p0[0] + p1[0]) / 2,
    (p0[1] + p1[1]) / 2 + 0.15,
    (p0[2] + p1[2]) / 2,
  ]

  return (
    <group>
      <Line
        points={[p0, p1]}
        color={color}
        lineWidth={hovered && !dimmed ? 2 : 1}
        transparent
        opacity={dimmed ? 0.08 : hovered ? 0.9 : 0.35}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      />
      {hovered && !dimmed && (
        <Text
          position={midpoint}
          fontSize={0.1}
          color={color}
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {`${linkTypeToKey[link.type] ?? 'UNK'} ${link.bandwidth.toFixed(1)} GB/s`}
        </Text>
      )}
    </group>
  )
}
