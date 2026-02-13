import { useRef, useState } from 'react'
import { Text, Edges } from '@react-three/drei'
import type { Mesh } from 'three'
import type { TopoNode } from '../../../engine/types'
import { nodeColors } from '../../../utils/colors'

interface CPUNodeProps {
  node: TopoNode
  position: [number, number, number]
}

export function CPUNode({ node, position }: CPUNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[0.8, 0.3, 0.5]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={nodeColors.CPU}
          emissiveIntensity={hovered ? 0.15 : 0.05}
        />
        <Edges color={nodeColors.CPU} threshold={15} />
      </mesh>
      <Text
        position={[0, 0.35, 0]}
        fontSize={0.12}
        color={nodeColors.CPU}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {node.label ?? `CPU${node.index}`}
      </Text>
    </group>
  )
}
