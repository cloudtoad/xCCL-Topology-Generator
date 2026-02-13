import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

export const dgxH100Config: HardwareConfig = {
  name: 'DGX H100',
  gpu: {
    count: 8,
    type: 'H100',
    cudaCompCap: 90,
    nvlinksPerPair: 18,  // 18 NVLink 4.0 per GPU
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.INTEL,
    model: 3,  // Sapphire Rapids (IntelCPUModel.SRP)
  },
  nic: {
    count: 8,
    speed: 50,  // 400Gbps = 50 GB/s per ConnectX-7
    gdrSupport: true,
    collSupport: false,
  },
  pcie: {
    gen: PCIeGen.GEN5,
    width: 16,
    switchesPerCPU: 2,
  },
  nvswitch: {
    count: 4,  // 4 NVSwitch
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],  // GPUs 0-3 on CPU0, 4-7 on CPU1
}
