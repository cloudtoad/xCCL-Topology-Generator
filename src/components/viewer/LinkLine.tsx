import { useState } from 'react'
import { Line, Text } from '@react-three/drei'
import { type TopoLink, LinkType } from '../../engine/types'
import { linkColors } from '../../utils/colors'

const linkTypeToKey: Record<number, keyof typeof linkColors> = {
  [LinkType.LOC]: 'LOC',
  [LinkType.NVL]: 'NVL',
  [LinkType.C2C]: 'NVB',
  [LinkType.PCI]: 'PIX',
  [LinkType.SYS]: 'SYS',
  [LinkType.NET]: 'NET',
}

interface LinkLineProps {
  link: TopoLink
  from: [number, number, number]
  to: [number, number, number]
}

export function LinkLine({ link, from, to }: LinkLineProps) {
  const [hovered, setHovered] = useState(false)

  const color = linkColors[linkTypeToKey[link.type] ?? 'LOC'] ?? '#444466'
  const midpoint: [number, number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2 + 0.15,
    (from[2] + to[2]) / 2,
  ]

  return (
    <group>
      <Line
        points={[from, to]}
        color={color}
        lineWidth={hovered ? 2 : 1}
        transparent
        opacity={hovered ? 0.9 : 0.35}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      />
      {hovered && (
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
