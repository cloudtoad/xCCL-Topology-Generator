import { useTopologyStore } from '../../store/topology-store'

export function SUBuilder() {
  const suConfig = useTopologyStore((s) => s.suConfig)
  const setSUConfig = useTopologyStore((s) => s.setSUConfig)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">Server Count</span>
        <input
          type="number"
          value={suConfig.serverCount}
          min={1}
          max={64}
          onChange={(e) => setSUConfig({ serverCount: Number(e.target.value) })}
          className="input w-14 text-right text-[10px] py-0.5"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">Rail Count</span>
        <input
          type="number"
          value={suConfig.railCount}
          min={1}
          max={32}
          onChange={(e) => setSUConfig({ railCount: Number(e.target.value) })}
          className="input w-14 text-right text-[10px] py-0.5"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">Network</span>
        <select
          value={suConfig.networkType}
          onChange={(e) =>
            setSUConfig({ networkType: e.target.value as 'rail-optimized' | 'fat-tree' })
          }
          className="input text-[10px] py-0.5 w-28"
        >
          <option value="rail-optimized">Rail-Optimized</option>
          <option value="fat-tree">Fat-Tree</option>
        </select>
      </div>

      {suConfig.serverCount > 1 && (
        <div className="text-[9px] text-gray-600 mt-1 p-1.5 bg-surface-900 rounded">
          Total GPUs: {suConfig.serverCount * 8} across {suConfig.serverCount} servers,
          {suConfig.railCount} rails
        </div>
      )}
    </div>
  )
}
