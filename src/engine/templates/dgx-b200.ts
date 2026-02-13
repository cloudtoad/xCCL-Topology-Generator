import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const dgxB200Config: HardwareConfig = {
  name: 'DGX B200',
  gpu: {
    count: 8,
    type: 'B200',
    cudaCompCap: 100,
    nvlinksPerPair: 18,
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.INTEL,
    model: 4,  // Emerald Rapids
  },
  nic: {
    count: 8,
    speed: 50,  // 400Gbps CX-7
    gdrSupport: true,
    collSupport: false,
  },
  pcie: {
    gen: PCIeGen.GEN5,
    width: 16,
    switchesPerCPU: 2,
  },
  nvswitch: {
    count: 4,
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
