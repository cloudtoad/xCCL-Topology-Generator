import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Grid } from './Grid'
import { RetroEffects } from './RetroEffects'
import { PhysicalView } from './PhysicalView'
import { RingView } from './RingView'
import { TreeView } from './TreeView'
import { useUIStore } from '../../store/ui-store'
import * as THREE from 'three'

/** Resets camera target + position when switching between cluster/node view */
function CameraReset() {
  const scaleView = useUIStore((s) => s.scaleView)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const { camera } = useThree()
  const controlsRef = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  const prevView = useRef(scaleView)
  const prevServer = useRef(selectedServer)

  useEffect(() => {
    const viewChanged = prevView.current !== scaleView
    const serverChanged = scaleView === 'node' && prevServer.current !== selectedServer
    prevView.current = scaleView
    prevServer.current = selectedServer

    if (!viewChanged && !serverChanged) return

    if (scaleView === 'cluster') {
      camera.position.set(0, 12, 25)
      if (controlsRef) controlsRef.target.set(0, 0, 0)
    } else {
      camera.position.set(0, 6, 12)
      if (controlsRef) controlsRef.target.set(0, 0, -1)
    }
  }, [scaleView, selectedServer, camera, controlsRef])

  return null
}

export function Scene3D() {
  const viewMode = useUIStore((s) => s.viewMode)
  const showGrid = useUIStore((s) => s.showGrid)

  return (
    <Canvas
      camera={{ position: [0, 8, 12], fov: 50 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#0a0a0f' }}
    >
      <color attach="background" args={['#0a0a0f']} />
      <ambientLight intensity={0.15} />
      <pointLight position={[10, 10, 10]} intensity={0.3} color="#00ffff" />
      <pointLight position={[-10, 10, -10]} intensity={0.2} color="#ff00ff" />

      {showGrid && <Grid />}

      {viewMode === 'physical' && <PhysicalView />}
      {viewMode === 'ring' && <RingView />}
      {viewMode === 'tree' && <TreeView />}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enablePan
        panSpeed={1.5}
        minDistance={1}
        maxDistance={100}
      />

      <CameraReset />
      <RetroEffects />
    </Canvas>
  )
}
