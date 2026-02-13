import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const mi300xOamConfig: HardwareConfig = {
  name: 'MI300X OAM',
  gpu: {
    count: 8,
    type: 'MI300X',
    cudaCompCap: 0,  // Not NVIDIA
    nvlinksPerPair: 7,  // 7 xGMI links per GPU pair
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.AMD,
    model: 3,  // Genoa
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
    count: 0,  // No NVSwitch — xGMI mesh
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
