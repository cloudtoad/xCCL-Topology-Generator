import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Grid } from './Grid'
import { RetroEffects } from './RetroEffects'
import { PhysicalView } from './PhysicalView'
import { RingView } from './RingView'
import { TreeView } from './TreeView'
import { useUIStore } from '../../store/ui-store'

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
        minDistance={3}
        maxDistance={50}
      />

      <RetroEffects />
    </Canvas>
  )
}
