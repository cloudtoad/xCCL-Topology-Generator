import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const hgxA100Config: HardwareConfig = {
  name: 'HGX A100',
  gpu: {
    count: 8,
    type: 'A100',
    cudaCompCap: 80,
    nvlinksPerPair: 12,  // 12 NVLink 3.0 per GPU
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.INTEL,
    model: 2,  // Skylake/Cascade Lake
  },
  nic: {
    count: 8,
    speed: 25,  // 200Gbps CX-6
    gdrSupport: true,
    collSupport: false,
  },
  pcie: {
    gen: PCIeGen.GEN4,
    width: 16,
    switchesPerCPU: 2,
  },
  nvswitch: {
    count: 6,  // 6 NVSwitch
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
