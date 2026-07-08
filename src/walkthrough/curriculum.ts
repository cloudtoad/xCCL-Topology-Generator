// =============================================================================
// The full curriculum — ground zero to QPs/rings/trees established.
//
// Organized the way a network engineer learns BGP or OSPF: as a sequence of
// protocol phases, each with its state transitions, message formats, show-
// command equivalents, and failure signatures. Module 1 reuses the preamble
// beats (stage-0 compact flow); modules 2-4 expand what the preamble's
// "local-search" beat summarizes; modules 5-8 carry through consensus, table
// installation, data-plane bring-up, and steady state.
//
// Every beat is source-cited against ref/src/nccl (2.30.7). The `view` field
// binds a beat to the app view that demonstrates it; `gap` marks beats whose
// visualization does not exist yet (the build list for the wrapper).
// =============================================================================

import type { PreambleBeat } from './preamble'
import { preambleBeat } from './preamble'

export interface CurriculumBeat extends PreambleBeat {
  /** The NCCL_DEBUG / env observable — the "show command" for this beat. */
  showCommand?: string
  /** App view that demonstrates this beat, if built. */
  view?: 'physical' | 'build' | 'sim' | 'decisions' | 'walkthrough'
  /** Set when the visualization for this beat does not exist yet. */
  gap?: string
}

export interface CurriculumModule {
  id: string
  title: string
  /** The networking-curriculum analog for the whole module. */
  analogy: string
  beats: CurriculumBeat[]
}

const fromPreamble = (id: string, extra: Partial<CurriculumBeat>): CurriculumBeat => ({
  ...preambleBeat(id),
  ...extra,
})

export const CURRICULUM: CurriculumModule[] = [
  {
    id: 'session',
    title: 'Session establishment',
    analogy: 'BGP session bring-up: Idle → Connect → OpenSent → Established',
    beats: [
      fromPreamble('bare-metal', { view: 'walkthrough' }),
      fromPreamble('ground-zero', { view: 'walkthrough' }),
      fromPreamble('launch', { view: 'walkthrough' }),
      fromPreamble('rendezvous', {
        showCommand:
          'The "OPEN message" format: ncclUniqueId = ncclBootstrapHandle {magic, addr, nRanks} ' +
          'zero-padded to 128 bytes (static_assert it fits, bootstrap.h:14-20)',
        view: 'walkthrough',
      }),
      fromPreamble('three-stores', { view: 'walkthrough' }),
      fromPreamble('convergence', { view: 'walkthrough' }),
      fromPreamble('bootstrap-ring', {
        showCommand: 'NCCL_DEBUG_SUBSYS=BOOTSTRAP → "Bootstrap: Using eth0" (bootstrap.cc:133)',
        view: 'walkthrough',
      }),
      fromPreamble('allgather1', {
        showCommand:
          'The "LSA contents": ncclPeerInfo {rank, cudaDev, nvmlDev, gdrSupport, hostHash, ' +
          'pidHash, shmDev, busId, gpuUuid, cudaCompCap, ...} (transport.h:43-63)',
        view: 'walkthrough',
      }),
    ],
  },
  {
    id: 'database',
    title: 'Building the database (topology detection)',
    analogy: 'LSDB population: flooding LSAs until every router holds the same graph',
    beats: [
      {
        id: 'detect',
        title: 'Hardware walk → XML',
        narration:
          'Each rank walks sysfs and NVML — PCIe hierarchy, NVLink registers, NIC ' +
          'enumeration — into an XML tree, unless NCCL_TOPO_FILE injects one (VMs, ' +
          'containers, or our Tier-2 fidelity oracle). This XML is the raw LSDB.',
        analogy: 'Receiving type-1/type-2 LSAs from the hardware itself.',
        failureSignature:
          'VM with flattened PCIe → everything looks PHB-distant → search finds weak ' +
          'graphs (log #1197\'s sameChannels=1 is exactly this signature).',
        sourceRef: 'topo.cc:1765-1780',
        showCommand: 'NCCL_TOPO_DUMP_FILE=system.xml dumps the detected topology (topo.cc:1927)',
        view: 'physical',
      },
      {
        id: 'graph-build',
        title: 'XML → typed graph',
        narration:
          'The XML becomes the topo system: six node types (GPU, PCI, NVS, CPU, NIC, NET) ' +
          'and typed links (NVL, PCI, SYS, NET) with bandwidths from the constants table. ' +
          'NVSwitches collapse into one logical NVS node at aggregate bandwidth.',
        analogy: 'LSDB → weighted graph, ready for SPF.',
        failureSignature:
          'Wrong link speed constant (PCIe gen misdetect) shifts every downstream ' +
          'bandwidth decision — the graphs are only as good as this table.',
        sourceRef: 'topo.cc:958',
        view: 'physical',
      },
    ],
  },
  {
    id: 'spf',
    title: 'Running SPF (paths)',
    analogy: 'Dijkstra per router: same LSDB in, same shortest-path tree out',
    beats: [
      {
        id: 'spfa',
        title: 'Path computation (SPFA)',
        narration:
          'Bandwidth-maximizing SPFA from every GPU/NIC/NET to everything else. Each ' +
          'path gets a TYPE from the locality ladder — LOC, NVL, NVB, PIX, PXB, PHB, ' +
          'SYS, NET — the single most quoted NCCL concept (it is what nvidia-smi topo ' +
          '-m prints).',
        analogy: 'SPF run — but maximizing bottleneck bandwidth, not minimizing cost.',
        failureSignature:
          'A path classified PHB when you expected PIX means the PCIe hierarchy was not ' +
          'detected as you think it is — go back one module and read the XML.',
        sourceRef: 'paths.cc:67',
        showCommand: 'nvidia-smi topo -m is this table, computed by the driver',
        view: 'physical',
      },
      {
        id: 'trim',
        title: 'Trim & recompute',
        narration:
          'Nodes unreachable from the local rank are trimmed (other NUMA islands, ' +
          'foreign GPUs), then paths are recomputed — the pipeline runs SPF twice by ' +
          'design.',
        analogy: 'Pruning unreachable stubs from the tree, then re-running SPF.',
        failureSignature:
          'A GPU missing from every ring was trimmed here — check CUDA_VISIBLE_DEVICES ' +
          'and container device cgroups.',
        sourceRef: 'init.cc:1145-1147',
        view: 'physical',
      },
    ],
  },
  {
    id: 'decision',
    title: 'The decision process (graph search)',
    analogy: 'BGP best-path: one fixed tiebreaker cascade, walked in order, no exceptions',
    beats: [
      {
        id: 'ceilings',
        title: 'Search ceilings (maxBw / totalBw)',
        narration:
          'Before searching: maxBw = the best path bandwidth anywhere, totalBw = one ' +
          'GPU\'s injection ceiling. These bound the speed ladder and enable the ' +
          'optimality short-circuit (nChannels × bw ≥ totalBw → stop, you cannot do ' +
          'better).',
        analogy: 'Setting the metric domain before comparing routes.',
        failureSignature:
          'Search "never converges" on odd hardware → ceilings computed from a ' +
          'misdetected topology admit impossible targets.',
        sourceRef: 'search.cc:14-53',
        view: 'build',
      },
      {
        id: 'cascade',
        title: 'The relaxation cascade',
        narration:
          'The search tries the strictest constraints first, then relaxes IN FIXED ' +
          'ORDER: sameChannels → tree type → intra path type → inter path type → ' +
          'crossNic → speed. Every "weird" production graph is this ladder, stopped at ' +
          'a different rung.',
        analogy: 'The BGP tiebreaker cascade itself — weight before local-pref before ' +
          'AS-path, always.',
        failureSignature:
          'GRAPH log shows typeIntra=SYS or low bw → count the rungs: which relaxations ' +
          'fired, and what hardware fact forced each one?',
        sourceRef: 'search.cc:1206-1246',
        showCommand: 'NCCL_DEBUG=INFO GRAPH lines: "Pattern 4, crossNic 0, nChannels 12, bw 30/30..."',
        view: 'build',
      },
      {
        id: 'tiebreakers',
        title: 'Per-hop GPU pick (cmpScore)',
        narration:
          'At every hop, candidates are ranked: interBw → interPciBw → interNhops → ' +
          'intraBw → intraNhops → startIndex. Deterministic — identical inputs give ' +
          'identical rings on every rank, which is what makes independent search safe.',
        analogy: 'Router-ID as final tiebreaker: the cascade always terminates decisively.',
        failureSignature:
          'Rings differ across ranks → inputs differed (heterogeneous detection), not ' +
          'the algorithm.',
        sourceRef: 'search.cc:202-211',
        view: 'build',
      },
      {
        id: 'dup',
        title: 'Channel duplication',
        narration:
          'Found rings are mirrored (6 found → 12 channels at half bandwidth each) to ' +
          'saturate both directions of every link.',
        analogy: 'ECMP: same path installed twice for load-sharing.',
        failureSignature:
          'Odd channel counts in logs are pre-dup; even counts post-dup — know which ' +
          'you are reading.',
        sourceRef: 'search.cc:1319',
        view: 'build',
      },
    ],
  },
  {
    id: 'consensus',
    title: 'Consensus (AllGather3)',
    analogy: 'Capability negotiation: the session runs at the intersection of what peers advertise',
    beats: [
      fromPreamble('consensus', {
        showCommand:
          'rank 0 prints "Local Net device counts across ranks: min X max Y" (init.cc:1319)',
        view: 'walkthrough',
      }),
    ],
  },
  {
    id: 'tables',
    title: 'Installing the tables (preset / postset)',
    analogy: 'RIB → FIB: decisions become forwarding state',
    beats: [
      {
        id: 'preset',
        title: 'Preset (local channel skeletons)',
        narration:
          'Each rank seeds its channel structures from the agreed graphs — ring ' +
          'prev/next, tree up/down slots — still node-local, using intra orders only.',
        analogy: 'Installing locally-originated routes into the RIB.',
        failureSignature: 'Wrong here means wrong everywhere after; effectively never the bug.',
        sourceRef: 'connect.cc:20',
        view: 'walkthrough',
      },
      {
        id: 'postset',
        title: 'Postset (cross-node stitch)',
        narration:
          'Rings stitch across nodes: each node\'s ring exit connects to the next ' +
          'node\'s ring entry (via the rail NICs chosen by the search), using the node ' +
          'numbering derived from ring data. Trees derive from the SAME ring intra ' +
          'order — trees are not searched, they are folded from rings.',
        analogy: 'Redistributing between IGP domains: local trees join into one global graph.',
        failureSignature:
          'A "broken ring" across nodes traces back to consensus disagreement or a NIC ' +
          'the far node numbered differently — never to postset itself.',
        sourceRef: 'connect.cc:380',
        view: 'walkthrough',
      },
    ],
  },
  {
    id: 'dataplane',
    title: 'Data-plane bring-up (transports & QPs)',
    analogy: 'Adjacency formation + hardware FIB programming',
    beats: [
      {
        id: 'transport-select',
        title: 'Transport selection',
        narration:
          'For every channel peer pair, walk the transport list IN ORDER — P2P ' +
          '(NVLink/PCIe direct), SHM (host memory), NET (NIC) — first canConnect wins. ' +
          'An ordered preference list, exactly like administrative distance.',
        analogy: 'Admin distance: connected > static > IGP — first eligible source wins.',
        failureSignature:
          '"WARN No transport found for rank X -> rank Y" (transport.cc:38) — the pair ' +
          'has NO eligible transport; usually P2P assumed across hosts due to the ' +
          'hostHash bug from module 1.',
        sourceRef: 'transport.cc:15-42',
        view: 'walkthrough',
      },
      {
        id: 'qps',
        title: 'Queue pairs',
        narration:
          'Each NET connection becomes IB queue pairs: QPs = nChannels × nNodes × ' +
          'NCCL_IB_QPS_PER_CONNECTION (default 1). This is the number that shows up in ' +
          'your fabric telemetry — and why channel count is a *network-visible* fact.',
        analogy: 'BGP sessions on the wire: the control-plane decision, countable in flow data.',
        failureSignature:
          'QP count in fabric telemetry ≠ nChannels × nNodes → some channels fell back ' +
          'to a different transport or a NIC went unused.',
        sourceRef: 'net_ib/connect.cc:60',
        view: 'physical',
      },
    ],
  },
  {
    id: 'steady-state',
    title: 'Steady state (tuning & first collective)',
    analogy: 'Converged network: FIB programmed, first packets forwarded',
    beats: [
      {
        id: 'tune',
        title: 'Algorithm/protocol tuning',
        narration:
          'With graphs final, each (collective, size) gets an algorithm (ring, tree, ' +
          'NVLS) and protocol (LL, LL128, SIMPLE) from the bandwidth/latency model — ' +
          'the routing policy that steers every future call.',
        analogy: 'PBR/traffic engineering on top of converged routing.',
        failureSignature:
          'Small-message latency regressions live here (LL cutoffs), not in the graphs.',
        sourceRef: 'tuning.cc:306-325',
        view: 'decisions',
      },
      {
        id: 'first-collective',
        title: 'The first collective (packet capture)',
        narration:
          'LL128 frames on the wire: 128-byte lines, 15 data words + 1 flag word. Our ' +
          'sim tags the flag with GPU-of-origin so you can watch data provenance flow ' +
          'around the established rings — the payoff for the whole curriculum.',
        analogy: 'The packet capture that proves the control plane did its job.',
        failureSignature:
          'If you got here, init worked. Everything from now on is performance, not ' +
          'reachability.',
        sourceRef: 'device.h:110-112',
        view: 'sim',
      },
    ],
  },
]

/** All beats in curriculum order (ground zero → established). */
export function allBeats(): CurriculumBeat[] {
  return CURRICULUM.flatMap((m) => m.beats)
}

/** Beats whose visualization does not exist yet — the wrapper build list. */
export function gapBeats(): CurriculumBeat[] {
  return allBeats().filter((b) => b.gap !== undefined)
}
