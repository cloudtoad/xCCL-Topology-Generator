import { useUIStore } from '../../store/ui-store'
import { useTopologyStore } from '../../store/topology-store'

export function ChannelSelector() {
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const setSelectedChannel = useUIStore((s) => s.setSelectedChannel)
  const viewMode = useUIStore((s) => s.viewMode)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const treeGraph = useTopologyStore((s) => s.treeGraph)

  const nChannels = (viewMode === 'tree' ? treeGraph?.nChannels : ringGraph?.nChannels) ?? 0

  if (nChannels === 0) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-600 uppercase">Ch</span>
        <span className="text-[10px] text-gray-600">&mdash;</span>
      </div>
    )
  }

  const prev = () => {
    if (selectedChannel === null || selectedChannel === 0) {
      setSelectedChannel(nChannels - 1)
    } else {
      setSelectedChannel(selectedChannel - 1)
    }
  }

  const next = () => {
    if (selectedChannel === null || selectedChannel >= nChannels - 1) {
      setSelectedChannel(0)
    } else {
      setSelectedChannel(selectedChannel + 1)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-500 mr-1 uppercase">Ch</span>
      <button onClick={prev} className="btn-secondary text-[10px] px-1">&lsaquo;</button>
      <select
        value={selectedChannel ?? 'all'}
        onChange={(e) => {
          const v = e.target.value
          setSelectedChannel(v === 'all' ? null : parseInt(v))
        }}
        className="input py-0.5 text-[10px] w-16"
      >
        <option value="all">All</option>
        {Array.from({ length: nChannels }, (_, i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
      <button onClick={next} className="btn-secondary text-[10px] px-1">&rsaquo;</button>
    </div>
  )
}
