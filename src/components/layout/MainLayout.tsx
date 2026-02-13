import { useUIStore } from '../../store/ui-store'
import { Toolbar } from './Toolbar'
import { BuilderSidebar } from '../builder/BuilderSidebar'
import { InfoPanel } from '../info/InfoPanel'
import { Scene3D } from '../viewer/Scene3D'

export function MainLayout() {
  const sidePanel = useUIStore((s) => s.sidePanel)
  const infoPanel = useUIStore((s) => s.infoPanel)

  return (
    <div className="h-screen flex flex-col bg-surface-900">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        {sidePanel === 'builder' && (
          <div className="w-80 flex-shrink-0 border-r border-surface-600 overflow-y-auto">
            <BuilderSidebar />
          </div>
        )}

        {/* Center 3D canvas */}
        <div className="flex-1 relative">
          <Scene3D />
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
