import { create } from 'zustand'

export type XCCLMode = 'nccl' | 'rccl'
export type ViewMode = 'physical' | 'ring' | 'tree'
export type ScaleView = 'cluster' | 'node'
export type SidePanel = 'builder' | 'none'
export type InfoPanel = 'info' | 'decisions' | 'ai' | 'none'

interface UIState {
  mode: XCCLMode
  viewMode: ViewMode
  scaleView: ScaleView
  sidePanel: SidePanel
  infoPanel: InfoPanel
  selectedChannel: number | null  // null = show all
  selectedNodes: string[]         // IDs of selected nodes (for path inspector)
  selectedServer: number | null   // null = none selected (show all)
  showGrid: boolean
  showLabels: boolean
  showCPUs: boolean

  setMode: (mode: XCCLMode) => void
  setViewMode: (viewMode: ViewMode) => void
  setScaleView: (scaleView: ScaleView) => void
  setSidePanel: (panel: SidePanel) => void
  setInfoPanel: (panel: InfoPanel) => void
  setSelectedChannel: (channel: number | null) => void
  selectNode: (nodeId: string) => void
  selectServer: (serverIdx: number | null) => void
  clearSelection: () => void
  toggleGrid: () => void
  toggleLabels: () => void
  toggleCPUs: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  mode: 'nccl',
  viewMode: 'physical',
  scaleView: 'cluster',
  sidePanel: 'builder',
  infoPanel: 'info',
  selectedChannel: null,
  selectedNodes: [],
  selectedServer: null,
  showGrid: false,
  showLabels: true,
  showCPUs: false,

  setMode: (mode) => set({ mode }),
  setViewMode: (viewMode) => set({ viewMode }),
  setScaleView: (scaleView) => set({ scaleView, selectedServer: scaleView === 'cluster' ? get().selectedServer : 0 }),
  setSidePanel: (panel) => set({ sidePanel: panel }),
  setInfoPanel: (panel) => set({ infoPanel: panel }),
  setSelectedChannel: (channel) => set({ selectedChannel: channel }),

  selectNode: (nodeId) => {
    const { selectedNodes } = get()
    if (selectedNodes.includes(nodeId)) {
      set({ selectedNodes: selectedNodes.filter((id) => id !== nodeId) })
    } else if (selectedNodes.length >= 2) {
      set({ selectedNodes: [selectedNodes[1], nodeId] })
    } else {
      set({ selectedNodes: [...selectedNodes, nodeId] })
    }
  },

  selectServer: (serverIdx) => {
    const { selectedServer } = get()
    // Toggle: click same server again to deselect
    if (serverIdx === selectedServer) {
      set({ selectedServer: null })
    } else {
      set({ selectedServer: serverIdx })
    }
  },

  clearSelection: () => set({ selectedNodes: [], selectedServer: null }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleCPUs: () => set((s) => ({ showCPUs: !s.showCPUs })),
}))
