import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const mi250xConfig: HardwareConfig = {
  name: 'MI250X',
  gpu: {
    count: 8,
    type: 'MI250X',
    cudaCompCap: 0,
    nvlinksPerPair: 4,  // 4 xGMI links
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.AMD,
    model: 1,  // Rome/Milan
  },
  nic: {
    count: 4,
    speed: 25,  // 200Gbps
    gdrSupport: true,
    collSupport: false,
  },
  pcie: {
    gen: PCIeGen.GEN4,
    width: 16,
    switchesPerCPU: 2,
  },
  nvswitch: {
    count: 0,
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
