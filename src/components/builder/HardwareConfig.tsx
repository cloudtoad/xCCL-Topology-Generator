import { useTopologyStore } from '../../store/topology-store'
import { CPUArch, CPUVendor, PCIeGen } from '../../engine/types'

export function HardwareConfig() {
  const config = useTopologyStore((s) => s.hardwareConfig)
  const setHardwareConfig = useTopologyStore((s) => s.setHardwareConfig)

  if (!config) {
    return (
      <div className="text-xs text-gray-600 p-2">
        Select a template first
      </div>
    )
  }

  const update = (path: string, value: number | string | boolean) => {
    const newConfig = structuredClone(config)
    const parts = path.split('.')
    let obj: any = newConfig
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]]
    }
    obj[parts[parts.length - 1]] = value
    setHardwareConfig(newConfig)
  }

  return (
    <div className="space-y-3">
      {/* GPU section */}
      <Section title="GPU">
        <Row label="Count">
          <NumberInput value={config.gpu.count} min={1} max={72} onChange={(v) => update('gpu.count', v)} />
        </Row>
        <Row label="Type">
          <TextInput value={config.gpu.type} onChange={(v) => update('gpu.type', v)} />
        </Row>
        <Row label="Compute Cap">
          <NumberInput value={config.gpu.cudaCompCap} min={0} max={200} onChange={(v) => update('gpu.cudaCompCap', v)} />
        </Row>
        <Row label="NVLinks/pair">
          <NumberInput value={config.gpu.nvlinksPerPair} min={0} max={18} onChange={(v) => update('gpu.nvlinksPerPair', v)} />
        </Row>
        <Row label="GDR">
          <Toggle value={config.gpu.gdrSupport} onChange={(v) => update('gpu.gdrSupport', v)} />
        </Row>
      </Section>

      {/* CPU section */}
      <Section title="CPU">
        <Row label="Count">
          <NumberInput value={config.cpu.count} min={1} max={8} onChange={(v) => update('cpu.count', v)} />
        </Row>
        <Row label="Arch">
          <Select
            value={config.cpu.arch}
            options={[
              { value: CPUArch.X86, label: 'x86' },
              { value: CPUArch.POWER, label: 'POWER' },
              { value: CPUArch.ARM, label: 'ARM' },
            ]}
            onChange={(v) => update('cpu.arch', v)}
          />
        </Row>
        <Row label="Vendor">
          <Select
            value={config.cpu.vendor}
            options={[
              { value: CPUVendor.INTEL, label: 'Intel' },
              { value: CPUVendor.AMD, label: 'AMD' },
              { value: CPUVendor.ZHAOXIN, label: 'Zhaoxin' },
            ]}
            onChange={(v) => update('cpu.vendor', v)}
          />
        </Row>
        <Row label="Model">
          <NumberInput value={config.cpu.model} min={0} max={10} onChange={(v) => update('cpu.model', v)} />
        </Row>
      </Section>

      {/* NIC section */}
      <Section title="NIC">
        <Row label="Count">
          <NumberInput value={config.nic.count} min={0} max={32} onChange={(v) => update('nic.count', v)} />
        </Row>
        <Row label="Speed (GB/s)">
          <NumberInput value={config.nic.speed} min={0} max={200} step={0.5} onChange={(v) => update('nic.speed', v)} />
        </Row>
        <Row label="GDR">
          <Toggle value={config.nic.gdrSupport} onChange={(v) => update('nic.gdrSupport', v)} />
        </Row>
        <Row label="CollNet">
          <Toggle value={config.nic.collSupport} onChange={(v) => update('nic.collSupport', v)} />
        </Row>
      </Section>

      {/* PCIe section */}
      <Section title="PCIe">
        <Row label="Generation">
          <Select
            value={config.pcie.gen}
            options={[
              { value: PCIeGen.GEN3, label: 'Gen3' },
              { value: PCIeGen.GEN4, label: 'Gen4' },
              { value: PCIeGen.GEN5, label: 'Gen5' },
            ]}
            onChange={(v) => update('pcie.gen', v)}
          />
        </Row>
        <Row label="Width">
          <Select
            value={config.pcie.width}
            options={[
              { value: 8, label: 'x8' },
              { value: 16, label: 'x16' },
            ]}
            onChange={(v) => update('pcie.width', v)}
          />
        </Row>
        <Row label="Switches/CPU">
          <NumberInput value={config.pcie.switchesPerCPU} min={0} max={4} onChange={(v) => update('pcie.switchesPerCPU', v)} />
        </Row>
      </Section>

      {/* NVSwitch section */}
      <Section title="NVSwitch / xGMI">
        <Row label="NVSwitch Count">
          <NumberInput value={config.nvswitch.count} min={0} max={8} onChange={(v) => update('nvswitch.count', v)} />
        </Row>
      </Section>
    </div>
  )
}

// --- Sub-components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
        {title}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-gray-500 flex-shrink-0">{label}</span>
      {children}
    </div>
  )
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input w-16 text-right text-[10px] py-0.5"
    />
  )
}

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input w-20 text-[10px] py-0.5"
    />
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-8 h-4 rounded-full transition-colors relative ${
        value ? 'bg-neon-cyan/30' : 'bg-surface-600'
      }`}
    >
      <div
        className={`w-3 h-3 rounded-full absolute top-0.5 transition-all ${
          value ? 'left-4.5 bg-neon-cyan' : 'left-0.5 bg-gray-500'
        }`}
        style={{ left: value ? '14px' : '2px' }}
      />
    </button>
  )
}

function Select({
  value,
  options,
  onChange,
}: {
  value: number
  options: { value: number; label: string }[]
  onChange: (v: number) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input text-[10px] py-0.5 w-20"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
