// =============================================================================
// AtlasView — the graph atlas, navigable.
//
// One graph per question, one key space across all of them: CFG (what runs
// next), DFD (what code touches what state), lineage (why is this value).
// Click any node → detail card with its source cite and jump buttons into
// the other views: Lineage tab, Build view (seek to the demonstrating trace
// event), Guide beat.
// =============================================================================
import { useMemo } from 'react'
import { useAtlasStore } from '../../store/atlas-store'
import { useTopologyStore } from '../../store/topology-store'
import { useBuildStore } from '../../store/build-store'
import { useWalkthroughStore } from '../../store/walkthrough-store'
import { useUIStore } from '../../store/ui-store'
import { MermaidPane } from './MermaidPane'
import { ATLAS, ATLAS_BY_MID, mid } from '../../atlas/ids'
import type { AtlasEntry } from '../../atlas/ids'
import { L0_DFD, L0_DFD_TITLE } from '../../atlas/graphs/l0-dfd'
import { L2_CFG, L2_CFG_TITLE } from '../../atlas/graphs/l2-cfg'
import { L2_DFD, L2_DFD_TITLE } from '../../atlas/graphs/l2-dfd'
import { toMermaid } from '../../engine/lineage'
import { CURRICULUM } from '../../walkthrough/curriculum'

const GRAPHS = [
  { key: 'l0-dfd' as const, label: 'L0 · Init pipeline' },
  { key: 'l2-cfg' as const, label: 'L2 · Control flow' },
  { key: 'l2-dfd' as const, label: 'L2 · Data flow' },
  { key: 'lineage' as const, label: 'Lineage map' },
]

function findBeat(beatId: string): { m: number; b: number } | null {
  for (let m = 0; m < CURRICULUM.length; m++) {
    const b = CURRICULUM[m].beats.findIndex((x) => x.id === beatId)
    if (b >= 0) return { m, b }
  }
  return null
}

function DetailCard({ entry }: { entry: AtlasEntry }) {
  const lineage = useTopologyStore((s) => s.lineage)
  const trace = useTopologyStore((s) => s.ringBuildTrace)
  const seek = useBuildStore((s) => s.seek)
  const setTrace = useBuildStore((s) => s.setTrace)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const setInfoPanel = useUIStore((s) => s.setInfoPanel)
  const setBeat = useWalkthroughStore((s) => s.setBeat)
  const focusLineage = useAtlasStore((s) => s.focusLineage)
  const setGraph = useAtlasStore((s) => s.setGraph)

  const lineageNode = entry.lineageId ? lineage?.nodes.get(entry.lineageId) : null

  const buildEventIdx = useMemo(() => {
    if (!entry.buildEvent || !trace) return -1
    return trace.events.findIndex((e) => {
      if (e.kind !== entry.buildEvent!.kind) return false
      if (!entry.buildEvent!.includes) return true
      return JSON.stringify(e).includes(entry.buildEvent!.includes)
    })
  }, [entry, trace])

  const beatLoc = entry.guideBeat ? findBeat(entry.guideBeat) : null

  return (
    <div className="border border-neon-cyan/30 rounded p-2.5 bg-neon-cyan/5 space-y-1.5">
      <div className="text-neon-cyan text-[11px] font-medium">{entry.title}</div>
      {lineageNode && (
        <div className="flex justify-between gap-2 text-[10px]">
          <span className="text-gray-500">live value</span>
          <span className="text-gray-200 font-mono">{lineageNode.value}</span>
        </div>
      )}
      <p className="text-[10px] text-gray-400 leading-snug">{entry.blurb}</p>
      <div className="text-[9px] text-gray-600 font-mono">{entry.sourceRef}</div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {entry.drill && (
          <button
            title="atlas-drill"
            onClick={() => setGraph(entry.drill!.graph)}
            className="px-2 py-0.5 text-[9px] border border-neon-magenta/40 rounded text-neon-magenta hover:bg-neon-magenta/10"
          >
            {entry.drill.label}
          </button>
        )}
        {entry.lineageId && lineageNode && (
          <button
            title="atlas-jump-lineage"
            onClick={() => focusLineage(entry.lineageId!)}
            className="px-2 py-0.5 text-[9px] border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/10"
          >
            trace upstream →
          </button>
        )}
        {entry.lineageId && lineageNode && (
          <button
            title="atlas-jump-lineage-tab"
            onClick={() => setInfoPanel('lineage')}
            className="px-2 py-0.5 text-[9px] border border-surface-600 rounded text-gray-400 hover:text-neon-cyan"
          >
            lineage tab →
          </button>
        )}
        {buildEventIdx >= 0 && (
          <button
            title="atlas-jump-build"
            onClick={() => {
              if (trace) { setTrace(trace); seek(buildEventIdx + 1); setViewMode('build') }
            }}
            className="px-2 py-0.5 text-[9px] border border-neon-green/40 rounded text-neon-green hover:bg-neon-green/10"
          >
            build view @ event {buildEventIdx} →
          </button>
        )}
        {beatLoc && (
          <button
            title="atlas-jump-guide"
            onClick={() => { setBeat(beatLoc.m, beatLoc.b); setViewMode('walkthrough') }}
            className="px-2 py-0.5 text-[9px] border border-neon-orange/40 rounded text-neon-orange hover:bg-neon-orange/10"
          >
            guide beat →
          </button>
        )}
      </div>
    </div>
  )
}

export function AtlasView() {
  const graph = useAtlasStore((s) => s.graph)
  const setGraph = useAtlasStore((s) => s.setGraph)
  const selected = useAtlasStore((s) => s.selected)
  const select = useAtlasStore((s) => s.select)
  const lineageFocus = useAtlasStore((s) => s.lineageFocus)
  const focusLineage = useAtlasStore((s) => s.focusLineage)
  const lineage = useTopologyStore((s) => s.lineage)

  const source = useMemo(() => {
    if (graph === 'l0-dfd') return L0_DFD
    if (graph === 'l2-cfg') return L2_CFG
    if (graph === 'l2-dfd') return L2_DFD
    if (!lineage) return 'flowchart LR\n  none["no lineage loaded"]'
    return toMermaid(lineage, lineageFocus ?? undefined)
  }, [graph, lineage, lineageFocus])

  const title =
    graph === 'l0-dfd' ? L0_DFD_TITLE
    : graph === 'l2-cfg' ? L2_CFG_TITLE
    : graph === 'l2-dfd' ? L2_DFD_TITLE
    : lineageFocus
      ? `Lineage · ancestry of ${lineageFocus}`
      : 'Lineage · the full datapoint map (two-node scenario)'

  const entry = selected ? ATLAS[selected] : null
  const lineageSelected = selected && !entry ? lineage?.nodes.get(selected) : null

  const onNodeClick = (sanitized: string) => {
    const reg = ATLAS_BY_MID[sanitized]
    if (reg) { select(reg.id); return }
    // lineage-map nodes: reverse-map sanitized id against lineage node ids
    if (lineage) {
      for (const id of lineage.nodes.keys()) {
        if (mid(id) === sanitized) { select(id); return }
      }
    }
  }

  return (
    <div className="absolute inset-0 flex bg-surface-900 overflow-hidden">
      {/* left rail */}
      <div className="w-72 flex-shrink-0 border-r border-surface-600 flex flex-col">
        <div className="p-3 space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Graph atlas · one graph per question
          </div>
          {GRAPHS.map((g) => (
            <button
              key={g.key}
              title={`atlas-graph-${g.key}`}
              onClick={() => setGraph(g.key)}
              className={`block w-full text-left px-2 py-1.5 text-[11px] rounded transition-colors ${
                graph === g.key
                  ? 'text-neon-cyan bg-neon-cyan/10 border border-neon-cyan/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {g.label}
            </button>
          ))}
          {graph === 'lineage' && lineageFocus && (
            <button
              title="atlas-lineage-unfocus"
              onClick={() => focusLineage(null)}
              className="text-[10px] text-gray-500 hover:text-neon-cyan px-2"
            >
              ← full map
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {entry && <DetailCard entry={entry} />}
          {lineageSelected && (
            <div className="border border-neon-cyan/30 rounded p-2.5 bg-neon-cyan/5 space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-neon-cyan text-[11px] font-medium">{lineageSelected.label}</span>
                <span className="text-gray-200 font-mono text-[10px]">{lineageSelected.value}</span>
              </div>
              <p className="text-[10px] text-gray-400">{lineageSelected.producedBy}</p>
              <div className="text-[9px] text-gray-600 font-mono">{lineageSelected.sourceRef}</div>
              <button
                title="atlas-focus-selected"
                onClick={() => focusLineage(lineageSelected.id)}
                className="px-2 py-0.5 text-[9px] border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/10"
              >
                focus ancestry →
              </button>
            </div>
          )}
          {!entry && !lineageSelected && (
            <p className="text-[10px] text-gray-600 leading-snug">
              Click any node. Registered nodes carry their source cite, live
              value, and jump buttons into the Lineage tab, the Build view
              (seeked to the demonstrating event), and the Guide.
            </p>
          )}
        </div>
      </div>

      {/* graph pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-surface-600 text-[11px] text-gray-400">
          {title}
          <span className="text-gray-600 ml-3 text-[9px]">wheel = zoom · drag = pan · click = inspect</span>
        </div>
        <div className="flex-1 relative">
          <MermaidPane source={source} onNodeClick={onNodeClick} />
        </div>
      </div>
    </div>
  )
}
