import { useEffect } from 'react'
import { useUIStore } from '../../store/ui-store'
import { Toolbar } from './Toolbar'
import { InfoPanel } from '../info/InfoPanel'
import { scenarioFor, loadScenario } from '../../scenarios'
import { Scene3D } from '../viewer/Scene3D'
import { SimControls } from '../controls/SimControls'
import { BuildControls } from '../controls/BuildControls'
import { WalkthroughView } from '../walkthrough/WalkthroughView'
import { AtlasView } from '../atlas/AtlasView'

export function MainLayout() {
  const infoPanel = useUIStore((s) => s.infoPanel)
  const viewMode = useUIStore((s) => s.viewMode)

  // Auto-load the canonical example each view runs on (2-node for the
  // search-detail views, 4-node for the cluster views). Preload the cluster
  // scenario at mount so the first view switch is instant.
  useEffect(() => {
    loadScenario(scenarioFor(viewMode) ?? 'four-node')
  }, [viewMode])

  return (
    <div className="h-screen flex flex-col bg-surface-900">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        {/* Center: 3D canvas, or the DOM walkthrough */}
        <div className="flex-1 relative">
          {viewMode === 'walkthrough' ? (
            <WalkthroughView />
          ) : viewMode === 'atlas' ? (
            <AtlasView />
          ) : (
            <>
              <Scene3D />
              {viewMode === 'sim' && <SimControls />}
              {viewMode === 'build' && <BuildControls />}
            </>
          )}
        </div>

        {/* Right info panel */}
        {infoPanel !== 'none' && (
          <div className="w-96 flex-shrink-0 border-l border-surface-600 overflow-y-auto">
            <InfoPanel />
          </div>
        )}
      </div>
    </div>
  )
}
