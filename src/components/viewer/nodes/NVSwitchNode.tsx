import { useRef, useState } from 'react'
import { Text, Edges } from '@react-three/drei'
import type { Mesh } from 'three'
import type { TopoNode } from '../../../engine/types'
import { nodeColors } from '../../../utils/colors'

interface NVSwitchNodeProps {
  node: TopoNode
  position: [number, number, number]
}

export function NVSwitchNode({ node, position }: NVSwitchNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        rotation={[0, Math.PI / 4, 0]}
      >
        <octahedronGeometry args={[0.25]} />
        <meshStandardMaterial
          color="#0a0a0f"
          emissive={nodeColors.NVS}
          emissiveIntensity={hovered ? 0.15 : 0.05}
        />
        <Edges color={nodeColors.NVS} threshold={15} />
      </mesh>
      <Text
        position={[0, 0.45, 0]}
        fontSize={0.1}
        color={nodeColors.NVS}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {node.label ?? `NVS${node.index}`}
      </Text>
    </group>
  )
}
