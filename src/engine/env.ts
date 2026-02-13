// =============================================================================
// Environment Variable Configuration — all NCCL + RCCL env vars
// =============================================================================

export type EnvVarType = 'int' | 'string' | 'bool' | 'float'
export type EnvCategory = 'topology' | 'channels' | 'transport' | 'network' | 'tuning' | 'debug' | 'rccl'

export interface EnvVarDef {
  name: string
  default: number | string | null
  value: number | string | null
  type: EnvVarType
  description: string
  sourceRef: string
  category: EnvCategory
}

function def(
  name: string,
  defaultVal: number | string | null,
  type: EnvVarType,
  description: string,
  sourceRef: string,
  category: EnvCategory,
): EnvVarDef {
  return { name, default: defaultVal, value: null, type, description, sourceRef, category }
}

// -2 = auto (NCCL_CONFIG_UNDEF_INT in NCCL source)
const AUTO = -2

export function createDefaultEnvConfig(): Map<string, EnvVarDef> {
  const vars: EnvVarDef[] = [
    // === TOPOLOGY ===
    def('NCCL_TOPO_FILE', null, 'string', 'Load XML topology file instead of hardware detection', 'topo.cc:1432', 'topology'),
    def('NCCL_GRAPH_FILE', null, 'string', 'Load pre-computed graph (skip search)', 'search.cc:1049', 'topology'),
    def('NCCL_TOPO_DUMP_FILE', null, 'string', 'Dump detected topology to XML file', 'topo.cc', 'topology'),
    def('NCCL_GRAPH_DUMP_FILE', null, 'string', 'Dump computed graph to XML file', 'search.cc:1272', 'topology'),
    def('NCCL_NVB_DISABLE', 0, 'int', 'Disable NVLink bounce routing through intermediate GPUs', 'paths.cc:34', 'topology'),
    def('NCCL_IGNORE_DISABLED_P2P', 0, 'int', 'Ignore NVML P2P disabled status (0=check, 1=ignore, 2=ignore without NVML)', 'paths.cc:255', 'topology'),
    def('NCCL_PXN_DISABLE', 0, 'int', 'Disable PXN (proxy through NVLink for rail-local network)', 'paths.cc:592', 'topology'),
    def('NCCL_PXN_C2C', 1, 'int', 'Use C2C path in PXN selection', 'paths.cc:643', 'topology'),
    def('NCCL_NET_DISABLE_INTRA', 0, 'int', 'Disable network for intra-node communication', 'paths.cc:533', 'topology'),

    // === CHANNELS ===
    def('NCCL_MIN_NCHANNELS', AUTO, 'int', 'Minimum number of channels (-2=auto)', 'search.cc', 'channels'),
    def('NCCL_MAX_NCHANNELS', AUTO, 'int', 'Maximum number of channels (-2=auto)', 'search.cc', 'channels'),
    def('NCCL_MIN_P2P_NCHANNELS', 1, 'int', 'Minimum P2P channels', 'paths.cc:859', 'channels'),
    def('NCCL_MAX_P2P_NCHANNELS', 64, 'int', 'Maximum P2P channels (MAXCHANNELS)', 'paths.cc:860', 'channels'),
    def('NCCL_NVLS_NCHANNELS', AUTO, 'int', 'NVLS channel count', 'init.cc:55', 'channels'),

    // === TRANSPORT ===
    def('NCCL_P2P_LEVEL', AUTO, 'int', 'P2P feasibility threshold (-2=auto, 0=LOC, 1=NVL, 4=PIX, 5=PXB, 8=PHB, 9=SYS)', 'paths.cc', 'transport'),
    def('NCCL_P2P_DISABLE', 0, 'int', 'Completely disable P2P transport', 'transport.cc', 'transport'),
    def('NCCL_SHM_DISABLE', 0, 'int', 'Disable shared memory transport', 'transport.cc', 'transport'),
    def('NCCL_P2P_PER_CHANNEL_NET_BW', 14, 'int', 'Target bandwidth per channel for network P2P (GB/s)', 'paths.cc:823', 'transport'),

    // === NETWORK ===
    def('NCCL_CROSS_NIC', 2, 'int', 'Cross-NIC policy (0=no, 1=yes, 2=auto)', 'search.cc:15', 'network'),
    def('NCCL_NET_GDR_LEVEL', AUTO, 'int', 'GPU Direct RDMA distance threshold', 'paths.cc', 'network'),
    def('NCCL_NET_GDR_READ', AUTO, 'int', 'GPU Direct RDMA read support (-2=auto, 0=off, 1=on)', 'paths.cc:411', 'network'),
    def('NCCL_NET_GDR_C2C', 1, 'int', 'Use GDRDMA on NICs connected via C2C', 'paths.cc:416', 'network'),
    def('NCCL_NET_FORCE_FLUSH', 0, 'int', 'Force flush on Hopper when using GDR', 'paths.cc:508', 'network'),
    def('NCCL_IB_DISABLE', 0, 'int', 'Disable InfiniBand', 'net.cc', 'network'),
    def('NCCL_SOCKET_IFNAME', null, 'string', 'Network interface for bootstrap', 'bootstrap.cc', 'network'),
    def('NCCL_COLLNET_ENABLE', AUTO, 'int', 'Enable CollNet collective network offload', 'init.cc:54', 'network'),
    def('NCCL_NVLS_ENABLE', AUTO, 'int', 'Enable NVLS (NVLink SHARP)', 'init.cc', 'network'),
    def('NCCL_MNNVL_SCATTER_NETS_ENABLE', 1, 'int', 'Enable MNNVL scatter nets strategy', 'search.cc:507', 'network'),
    def('NCCL_MNNVL_RAIL_PER_HOST', 0, 'int', 'MNNVL rails per host override', 'search.cc:557', 'network'),
    def('NCCL_P2P_PXN_LEVEL', 2, 'int', 'PXN usage for P2P (0=none, 1=if needed, 2=maximize aggregation)', 'search.cc:1315', 'network'),

    // === TUNING ===
    def('NCCL_ALGO', AUTO, 'int', 'Force algorithm (-2=auto, 0=tree, 1=ring, 2=collnet_direct, 3=collnet_chain, 4=nvls, 5=nvls_tree)', 'tuning.cc', 'tuning'),
    def('NCCL_PROTO', AUTO, 'int', 'Force protocol (-2=auto, 0=LL, 1=LL128, 2=Simple)', 'tuning.cc', 'tuning'),
    def('NCCL_NTHREADS', AUTO, 'int', 'Kernel thread count (-2=auto)', 'tuning.cc', 'tuning'),
    def('NCCL_BUFFSIZE', AUTO, 'int', 'Buffer size per channel (-2=auto)', 'init.cc', 'tuning'),
    def('NCCL_THREAD_THRESHOLDS', null, 'string', 'Override LL/LL128/SIMPLE thread thresholds', 'tuning.cc:552', 'tuning'),

    // === DEBUG ===
    def('NCCL_DEBUG', null, 'string', 'Debug log level (VERSION, WARN, INFO, ABORT, TRACE)', 'debug.cc', 'debug'),
    def('NCCL_DEBUG_SUBSYS', null, 'string', 'Debug subsystem filter (INIT, GRAPH, ENV, etc.)', 'debug.cc', 'debug'),
    def('NCCL_DEBUG_FILE', null, 'string', 'Debug output file path', 'debug.cc', 'debug'),

    // === RCCL-SPECIFIC ===
    def('RCCL_MODEL_MATCHING_DISABLE', 0, 'int', 'Disable Rome model matching, fall through to dynamic search', 'rome_models.cc', 'rccl'),
    def('RCCL_MODEL_REVERSAL_DISABLE', 0, 'int', 'Disable automatic reversal in ring parsing', 'rome_models.cc:1811', 'rccl'),
    def('RCCL_MSCCL_ENABLE', 1, 'int', 'Enable MSCCL (Microsoft Collective Communication Library)', 'msccl_lifecycle.cc', 'rccl'),
    def('RCCL_DUMP_ROME_MODEL_FILE', null, 'string', 'Dump detected topology in Rome model format', 'rome_models.cc:2320', 'rccl'),
  ]

  const map = new Map<string, EnvVarDef>()
  for (const v of vars) {
    map.set(v.name, v)
  }
  return map
}

export type EnvConfig = Map<string, EnvVarDef>

// Get the effective value of an env var (user value or default)
export function getEnvValue(config: EnvConfig, name: string): number | string | null {
  const v = config.get(name)
  if (!v) return null
  return v.value !== null ? v.value : v.default
}

// Get numeric env var value, returning default if not set
export function getEnvInt(config: EnvConfig, name: string): number {
  const val = getEnvValue(config, name)
  if (val === null) return -2
  return typeof val === 'number' ? val : parseInt(val, 10)
}

// Check if an env var has been overridden from its default
export function isEnvOverridden(config: EnvConfig, name: string): boolean {
  const v = config.get(name)
  return v !== undefined && v.value !== null
}
