import { useRef, useState } from 'react'
import { Text, Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import type { Mesh } from 'three'
import type { TopoNode } from '../../../engine/types'
import { useUIStore } from '../../../store/ui-store'
import { nodeColors } from '../../../utils/colors'

const DIM_COLOR = '#222233'

interface NVSwitchNodeProps {
  node: TopoNode
  position: [number, number, number]
  dimmed?: boolean
  onClick?: () => void
}

export function NVSwitchNode({ node, position, dimmed = false, onClick }: NVSwitchNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const selectNode = useUIStore((s) => s.selectNode)
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const isSelected = selectedNodes.includes(node.id)

  const color = dimmed ? DIM_COLOR : nodeColors.NVS
  const intensity = dimmed ? 0.02 : isSelected ? 0.3 : hovered ? 0.15 : 0.05

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => { e.stopPropagation(); onClick?.(); selectNode(node.id) }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[0.25, 24]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={color}
          emissiveIntensity={intensity}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
        <Edges color={color} threshold={15} />
      </mesh>
      <Text
        position={[0, 0.3, 0]}
        fontSize={0.1}
        color={color}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {node.label ?? `NVS${node.index}`}
      </Text>
    </group>
  )
}
