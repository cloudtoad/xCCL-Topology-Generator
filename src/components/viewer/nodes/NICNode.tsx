import { useRef, useState } from 'react'
import { Text, Edges } from '@react-three/drei'
import type { Mesh } from 'three'
import type { TopoNode } from '../../../engine/types'
import { nodeColors } from '../../../utils/colors'

interface NICNodeProps {
  node: TopoNode
  position: [number, number, number]
}

export function NICNode({ node, position }: NICNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[0.3, 0.2, 0.2]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={nodeColors.NIC}
          emissiveIntensity={hovered ? 0.15 : 0.05}
        />
        <Edges color={nodeColors.NIC} threshold={15} />
      </mesh>
      <Text
        position={[0, 0.25, 0]}
        fontSize={0.1}
        color={nodeColors.NIC}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {node.label ?? `NIC${node.index}`}
      </Text>
    </group>
  )
}
