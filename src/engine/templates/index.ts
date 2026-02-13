import { dgxH100Config } from './dgx-h100'
import { dgxB200Config } from './dgx-b200'
import { hgxA100Config } from './hgx-a100'
import { mi300xOamConfig } from './mi300x-oam'
import { mi250xConfig } from './mi250x'
import { customConfig } from './custom'
import type { HardwareConfig } from '../types'

export interface TemplateEntry {
  id: string
  config: HardwareConfig
  description: string
  mode: 'nccl' | 'rccl' | 'both'
}

export const templates: TemplateEntry[] = [
  { id: 'dgx-h100', config: dgxH100Config, description: '8x H100 SXM, 4 NVSwitch, 2x Intel SRP, 8x CX-7 400G', mode: 'nccl' },
  { id: 'dgx-b200', config: dgxB200Config, description: '8x B200 Blackwell, 4 NVSwitch, 2x Intel ERP, 8x CX-7 400G', mode: 'nccl' },
  { id: 'hgx-a100', config: hgxA100Config, description: '8x A100 SXM, 6 NVSwitch, 2x Intel SKL, 8x CX-6 200G', mode: 'nccl' },
  { id: 'mi300x-oam', config: mi300xOamConfig, description: '8x MI300X, xGMI mesh, 2x AMD Genoa, 8x CX-7 400G', mode: 'rccl' },
  { id: 'mi250x', config: mi250xConfig, description: '8x MI250X (4 OAM), xGMI, 2x AMD Rome, 4x CX-6 200G', mode: 'rccl' },
  { id: 'custom', config: customConfig, description: 'Blank configuration for manual build', mode: 'both' },
]

export function getTemplate(id: string): TemplateEntry | undefined {
  return templates.find((t) => t.id === id)
}

export function getTemplatesForMode(mode: 'nccl' | 'rccl'): TemplateEntry[] {
  return templates.filter((t) => t.mode === mode || t.mode === 'both')
}
