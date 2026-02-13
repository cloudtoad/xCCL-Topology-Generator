import { useMemo } from 'react'
import * as THREE from 'three'

export function Grid() {
  const gridGeometry = useMemo(() => {
    const points: THREE.Vector3[] = []
    const size = 20
    const divisions = 40
    const step = size / divisions

    for (let i = -divisions / 2; i <= divisions / 2; i++) {
      const pos = i * step
      // X-parallel lines
      points.push(new THREE.Vector3(-size / 2, 0, pos))
      points.push(new THREE.Vector3(size / 2, 0, pos))
      // Z-parallel lines
      points.push(new THREE.Vector3(pos, 0, -size / 2))
      points.push(new THREE.Vector3(pos, 0, size / 2))
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    return geometry
  }, [])

  return (
    <lineSegments geometry={gridGeometry}>
      <lineBasicMaterial
        color="#00ffff"
        transparent
        opacity={0.06}
        depthWrite={false}
      />
    </lineSegments>
  )
}
