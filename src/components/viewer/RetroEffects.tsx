import { EffectComposer, Bloom, Scanline, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

export function RetroEffects() {
  return (
    <EffectComposer>
      <Bloom
        intensity={0.8}
        luminanceThreshold={0.2}
        luminanceSmoothing={0.9}
        mipmapBlur
      />
      <Scanline
        blendFunction={BlendFunction.OVERLAY}
        density={1.2}
        opacity={0.05}
      />
      <Vignette
        offset={0.3}
        darkness={0.7}
      />
    </EffectComposer>
  )
}
