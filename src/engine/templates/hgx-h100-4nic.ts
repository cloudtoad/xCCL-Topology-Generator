import type { HardwareConfig } from '../types'
import { CPUArch, CPUVendor, PCIeGen } from '../types'

// The half-ratio deployment: smaller-model shops predictably run half the
// NICs per GPU — 4× 400G for 8 GPUs, one NIC shared by a GPU pair behind a
// common PCIe switch (2 GPUs + 1 NIC per switch).
export const hgxH100FourNicConfig: HardwareConfig = {
  name: 'HGX H100 · 4 NIC',
  gpu: {
    count: 8,
    type: 'H100',
    cudaCompCap: 90,
    nvlinksPerPair: 18,
    gdrSupport: true,
  },
  cpu: {
    count: 2,
    arch: CPUArch.X86,
    vendor: CPUVendor.INTEL,
    model: 3,
  },
  nic: {
    count: 4,
    speed: 50,
    gdrSupport: true,
    collSupport: false,
  },
  pcie: {
    gen: PCIeGen.GEN5,
    width: 16,
    switchesPerCPU: 2, // 4 switches: 2 GPUs + 1 NIC each
  },
  nvswitch: {
    count: 4,
  },
  numaMapping: [0, 0, 0, 0, 1, 1, 1, 1],
}
