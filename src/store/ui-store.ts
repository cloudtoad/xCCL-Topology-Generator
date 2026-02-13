import { create } from 'zustand'

export type XCCLMode = 'nccl' | 'rccl'
export type ViewMode = 'physical' | 'ring' | 'tree' | 'paths'
export type LayoutMode = 'flat' | '3d'
export type SidePanel = 'builder' | 'none'
export type InfoPanel = 'info' | 'decisions' | 'ai' | 'none'

interface UIState {
  mode: XCCLMode
  viewMode: ViewMode
  layoutMode: LayoutMode
  sidePanel: SidePanel
  infoPanel: InfoPanel
  selectedChannel: number | null  // null = show all
  selectedNodes: string[]         // IDs of selected nodes (for path inspector)
  showGrid: boolean
  showLabels: boolean

  setMode: (mode: XCCLMode) => void
  setViewMode: (viewMode: ViewMode) => void
  setLayoutMode: (layoutMode: LayoutMode) => void
  setSidePanel: (panel: SidePanel) => void
  setInfoPanel: (panel: InfoPanel) => void
  setSelectedChannel: (channel: number | null) => void
  selectNode: (nodeId: string) => void
  clearSelection: () => void
  toggleGrid: () => void
  toggleLabels: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  mode: 'nccl',
  viewMode: 'physical',
  layoutMode: 'flat',
  sidePanel: 'builder',
  infoPanel: 'info',
  selectedChannel: null,
  selectedNodes: [],
  showGrid: false,
  showLabels: true,

  setMode: (mode) => set({ mode }),
  setViewMode: (viewMode) => set({ viewMode }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
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

  clearSelection: () => set({ selectedNodes: [] }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
}))
