import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const customConfig: HardwareConfig = {
  name: 'Custom',
  gpu: { count: 8, type: 'Custom', cudaCompCap: 90, nvlinksPerPair: 0, gdrSupport: false },
  cpu: { count: 2, arch: CPUArch.X86, vendor: CPUVendor.INTEL, model: 2 },
  nic: { count: 2, speed: 12.5, gdrSupport: false, collSupport: false },
  pcie: { gen: PCIeGen.GEN4, width: 16, switchesPerCPU: 1 },
  nvswitch: { count: 0 },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
