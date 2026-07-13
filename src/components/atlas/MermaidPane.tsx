// Client-side mermaid rendering with atlas-aware click handling and simple
// pan/zoom. The mermaid module loads lazily (dynamic import) so the graph
// atlas costs nothing until opened.
import { useEffect, useRef, useState } from 'react'

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        themeVariables: {
          background: '#0a0a0f',
          primaryColor: '#12121a',
          primaryTextColor: '#e5e5e5',
          primaryBorderColor: '#333344',
          lineColor: '#556677',
          secondaryColor: '#1a1a25',
          tertiaryColor: '#221f00',
          fontFamily: 'JetBrains Mono, Fira Code, monospace',
          fontSize: '13px',
          edgeLabelBackground: '#0a0a0f',
        },
        flowchart: { curve: 'basis', htmlLabels: true },
      })
      return m.default
    })
  }
  return mermaidPromise
}

let renderSeq = 0

export function MermaidPane({ source, onNodeClick }: {
  source: string
  onNodeClick?: (sanitizedId: string) => void
}) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    getMermaid()
      .then((mm) => mm.render(`atlas-${++renderSeq}`, source))
      .then(({ svg }) => { if (live) setSvg(svg) })
      .catch((e) => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [source])

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [source])

  const handleClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest?.('g.node') as SVGGElement | null
    if (!g || !onNodeClick) return
    // mermaid node dom ids look like "<renderId>-flowchart-<sanitized>-<n>"
    const m = g.id.match(/-flowchart-(.+)-\d+$/)
    if (m) onNodeClick(m[1])
  }

  return (
    <div
      className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-surface-900"
      onWheel={(e) => {
        setZoom((z) => Math.min(3, Math.max(0.3, z * (e.deltaY < 0 ? 1.1 : 0.9))))
      }}
      onMouseDown={(e) => { dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y } }}
      onMouseMove={(e) => {
        if (dragging.current) setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y })
      }}
      onMouseUp={() => { dragging.current = null }}
      onMouseLeave={() => { dragging.current = null }}
    >
      {error ? (
        <pre className="text-neon-red text-[10px] p-4 whitespace-pre-wrap">{error}</pre>
      ) : (
        <div
          onClick={handleClick}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
          className="[&_svg]:max-w-none [&_g.node]:cursor-pointer p-6"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
}
