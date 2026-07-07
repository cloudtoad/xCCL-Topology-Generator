import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Grid } from './Grid'
import { RetroEffects } from './RetroEffects'
import { PhysicalView } from './PhysicalView'
import { RingView } from './RingView'
import { TreeView } from './TreeView'
import { NvlsView } from './NvlsView'
import { SimView } from './SimView'
import { BuildView } from './BuildView'
import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'
import * as THREE from 'three'

/** Frames the camera for cluster/node view — and when a cluster is generated. */
function CameraReset() {
  const scaleView = useUIStore((s) => s.scaleView)
  const selectedServer = useUIStore((s) => s.selectedServer)
  const viewMode = useUIStore((s) => s.viewMode)
  const system = useTopologyStore((s) => s.system)
  const isMultiNode = useMemo(
    () => !!system?.nodes.some((n) => /^s\d+-/.test(n.id)),
    [system],
  )
  const { camera } = useThree()
  const controlsRef = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  const prevView = useRef(scaleView)
  const prevServer = useRef(selectedServer)
  const prevMulti = useRef(isMultiNode)
  const prevMode = useRef(viewMode)

  useEffect(() => {
    const viewChanged = prevView.current !== scaleView
    const serverChanged = scaleView === 'node' && prevServer.current !== selectedServer
    const multiChanged = prevMulti.current !== isMultiNode
    const modeChanged = prevMode.current !== viewMode
    prevView.current = scaleView
    prevServer.current = selectedServer
    prevMulti.current = isMultiNode
    prevMode.current = viewMode

    if (!viewChanged && !serverChanged && !multiChanged && !modeChanged) return

    if (viewMode === 'sim') {
      // Head-on framing for the scoreboard row + conveyor lanes.
      camera.position.set(0, 2.4, 17.5)
      if (controlsRef) controlsRef.target.set(0, 2.2, 0)
    } else if (viewMode === 'build') {
      // Angled-down single-server framing: ring arcs read above the GPU row.
      camera.position.set(0, 7.5, 11)
      if (controlsRef) controlsRef.target.set(0, 0.6, -1)
    } else if (scaleView === 'cluster') {
      // Elevated, angled-down framing so stacked server rows read as a grid.
      if (isMultiNode) camera.position.set(0, 22, 24)
      else camera.position.set(0, 8, 14)
      if (controlsRef) controlsRef.target.set(0, 0, 0)
    } else {
      camera.position.set(0, 6, 12)
      if (controlsRef) controlsRef.target.set(0, 0, -1)
    }
  }, [scaleView, selectedServer, isMultiNode, viewMode, camera, controlsRef])

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
      {viewMode === 'nvls' && <NvlsView />}
      {viewMode === 'sim' && <SimView />}
      {viewMode === 'build' && <BuildView />}

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
