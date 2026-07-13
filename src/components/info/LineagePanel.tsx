// =============================================================================
// LineagePanel — the datapoint map, walkable.
//
// "show ip route → get-nexthop → show ip arp → get-mac → show mac-table":
// click any derived value and trace its ancestry upstream, edge by edge, each
// hop naming the connecting function and its NCCL source cite. The missing
// show-command layer, with `| trace upstream` built in.
// =============================================================================
import { useState } from 'react'
import { useTopologyStore } from '../../store/topology-store'
import { useUIStore } from '../../store/ui-store'
import { useAtlasStore } from '../../store/atlas-store'
import { ancestors, dependents } from '../../engine/lineage'
import type { LineageGraph, LineageNode, LineagePhase } from '../../engine/lineage'

const PHASES: { key: LineagePhase; label: string }[] = [
  { key: 'roots', label: 'Roots — operator inputs' },
  { key: 'topology', label: 'Topology' },
  { key: 'search', label: 'Search' },
  { key: 'graphs', label: 'Graphs' },
  { key: 'cluster', label: 'Cluster / QPs' },
  { key: 'tuning', label: 'Tuning' },
]

function NodeRow({ node, onSelect, depth = 0 }: {
  node: LineageNode
  onSelect: (id: string) => void
  depth?: number
}) {
  return (
    <button
      onClick={() => onSelect(node.id)}
      title={`lineage-${node.id}`}
      className="block w-full text-left px-1.5 py-1 rounded hover:bg-neon-cyan/5 transition-colors"
      style={{ marginLeft: depth * 10 }}
    >
      <div className="flex justify-between gap-2">
        <span className={node.kind === 'root' ? 'text-neon-green text-[10px]' : 'text-gray-300 text-[10px]'}>
          {depth > 0 && <span className="text-gray-600">↑ </span>}
          {node.label}
        </span>
        <span className="text-gray-400 font-mono text-[10px] text-right">{node.value}</span>
      </div>
    </button>
  )
}

/** Pure tree build (no render-phase mutation — StrictMode-safe): expand each
 * node's ancestry once; repeat visits render as a stub reference. */
interface TreeEntry { node: LineageNode; children: TreeEntry[]; stub: boolean }

function buildTree(graph: LineageGraph, id: string): TreeEntry[] {
  const seen = new Set<string>([id])
  const expand = (uid: string): TreeEntry | null => {
    const node = graph.nodes.get(uid)
    if (!node) return null
    if (seen.has(uid)) return { node, children: [], stub: true }
    seen.add(uid)
    return {
      node,
      children: node.upstream.map(expand).filter((e): e is TreeEntry => e !== null),
      stub: false,
    }
  }
  const root = graph.nodes.get(id)
  if (!root) return []
  return root.upstream.map(expand).filter((e): e is TreeEntry => e !== null)
}

function UpstreamTree({ entries, onSelect }: {
  entries: TreeEntry[]
  onSelect: (id: string) => void
}) {
  return (
    <div>
      {entries.map(({ node, children, stub }, i) => (
        <div key={`${node.id}-${i}`} style={{ marginLeft: 10 }}>
          <NodeRow node={node} onSelect={onSelect} />
          <div className="ml-1.5 border-l border-surface-600 pl-1">
            {stub ? (
              <div className="text-[9px] text-gray-700 px-1.5 pb-1">↑ shown above</div>
            ) : (
              <>
                <div className="text-[9px] text-gray-600 px-1.5 pb-1">
                  via {node.producedBy}
                  <span className="text-gray-700 font-mono"> · {node.sourceRef}</span>
                </div>
                <UpstreamTree entries={children} onSelect={onSelect} />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function LineagePanel() {
  const lineage = useTopologyStore((s) => s.lineage)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const focusLineage = useAtlasStore((s) => s.focusLineage)
  const [selected, setSelected] = useState<string | null>(null)

  if (!lineage) {
    return <p className="text-gray-600 text-xs">No lineage — switch to any view to load a scenario.</p>
  }

  const sel = selected ? lineage.nodes.get(selected) : null

  if (sel) {
    const deps = dependents(lineage, sel.id)
    const upCount = ancestors(lineage, sel.id).length
    return (
      <div className="text-xs space-y-2">
        <button
          onClick={() => setSelected(null)}
          title="lineage-back"
          className="text-[10px] text-gray-500 hover:text-neon-cyan"
        >
          ← all datapoints
        </button>

        <div className="border border-neon-cyan/30 rounded p-2 bg-neon-cyan/5">
          <div className="flex justify-between gap-2">
            <span className="text-neon-cyan text-[11px] font-medium">{sel.label}</span>
            <span className="text-gray-200 font-mono text-[11px]">{sel.value}</span>
          </div>
          <div className="text-[9px] text-gray-500 mt-1">
            {sel.producedBy}
            <span className="text-gray-600 font-mono"> · {sel.sourceRef}</span>
          </div>
          <button
            title="lineage-view-in-atlas"
            onClick={() => { focusLineage(sel.id); setViewMode('atlas') }}
            className="mt-1.5 px-2 py-0.5 text-[9px] border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/10"
          >
            view in Atlas →
          </button>
        </div>

        <div className="text-[10px] text-gray-500 uppercase tracking-wider">
          Trace upstream · {upCount} ancestor{upCount === 1 ? '' : 's'}
        </div>
        {sel.upstream.length === 0 ? (
          <p className="text-[10px] text-neon-green">
            ● Root — an operator input. The buck stops here.
          </p>
        ) : (
          <UpstreamTree entries={buildTree(lineage, sel.id)} onSelect={setSelected} />
        )}

        {deps.length > 0 && (
          <>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider pt-1">
              Read by
            </div>
            {deps.map((d) => (
              <NodeRow key={d.id} node={d} onSelect={setSelected} />
            ))}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="text-xs space-y-3">
      <p className="text-[10px] text-gray-500 leading-snug">
        Every value dangles from something upstream. Click a datapoint to walk
        its derivation — each hop names the connecting function and its NCCL
        source cite.
      </p>
      {PHASES.map(({ key, label }) => {
        const group = [...lineage.nodes.values()].filter((n) => n.phase === key)
        if (group.length === 0) return null
        return (
          <div key={key}>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">{label}</div>
            {group.map((n) => (
              <NodeRow key={n.id} node={n} onSelect={setSelected} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
