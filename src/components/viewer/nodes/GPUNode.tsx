import { useRef, useState } from 'react'
import { Text, Edges } from '@react-three/drei'
import type { Mesh } from 'three'
import type { TopoNode } from '../../../engine/types'
import { useUIStore } from '../../../store/ui-store'
import { nodeColors } from '../../../utils/colors'

interface GPUNodeProps {
  node: TopoNode
  position: [number, number, number]
}

export function GPUNode({ node, position }: GPUNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const selectNode = useUIStore((s) => s.selectNode)
  const selectedNodes = useUIStore((s) => s.selectedNodes)
  const showLabels = useUIStore((s) => s.showLabels)
  const isSelected = selectedNodes.includes(node.id)

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={() => selectNode(node.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[0.6, 0.4, 0.3]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={nodeColors.GPU}
          emissiveIntensity={isSelected ? 0.3 : hovered ? 0.15 : 0.05}
        />
        <Edges color={nodeColors.GPU} threshold={15} />
      </mesh>
      {showLabels && (
        <Text
          position={[0, 0.45, 0]}
          fontSize={0.15}
          color={nodeColors.GPU}
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {node.label ?? `GPU${node.index}`}
        </Text>
      )}
    </group>
  )
}
