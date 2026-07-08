// =============================================================================
// Walkthrough stage 0 — the preamble: launch → rendezvous → bootstrap →
// discovery → independent search → consensus.
//
// The rulebook's Phase P (docs/ORDER-OF-OPERATIONS.md) as narrated beats for
// the guided walkthrough. Framed the way a network engineer debugs: these are
// the session-establishment phases that must complete IN ORDER before any
// topology work is visible — like BGP reaching Established before best-path
// means anything. Each beat carries its failure signature because that is how
// the phases are actually experienced in production: as the place init hung.
// =============================================================================

export interface PreambleBeat {
  id: string
  title: string
  /** What happens, in network-engineer voice. */
  narration: string
  /** BGP/networking analogy — the tutorial's connective tissue. */
  analogy: string
  /** How this phase looks when it breaks (symptom → cause). */
  failureSignature: string
  sourceRef: string
}

export const PREAMBLE_BEATS: PreambleBeat[] = [
  {
    id: 'launch',
    title: 'Launch & device binding',
    narration:
      'Before NCCL exists, the launcher (torchrun / mpirun / srun) assigns RANK, ' +
      'WORLD_SIZE and LOCAL_RANK, and the framework binds each rank to a device. ' +
      'The rank↔GPU mapping that later makes ring printouts look scrambled is ' +
      'decided here.',
    analogy:
      'Router-ID and interface assignment — configured before any protocol packet is sent.',
    failureSignature:
      'Two ranks on one GPU → "WARN Multiple Ranks are using the same GPU" at discovery ' +
      '(a LOCAL_RANK mapping bug that only surfaces two phases later).',
    sourceRef: 'init.cc:1053-1060',
  },
  {
    id: 'rendezvous',
    title: 'The rendezvous (ncclGetUniqueId)',
    narration:
      'Rank 0 mints the "unique ID" — which is not an ID at all, but the bootstrap ' +
      'root\'s socket address plus a magic number, padded to 128 bytes. It must reach ' +
      'every rank out-of-band: MPI_Bcast (manual), torchrun\'s TCPStore (automatic), ' +
      'or NCCL_COMM_ID (operator-set).',
    analogy:
      'The BGP neighbor statement: someone has to tell each peer where the session lives. ' +
      'Manual vs automatic is purely a property of the framework above NCCL.',
    failureSignature:
      'Ranks hang in ncclCommInitRank with ZERO NCCL output — the ID never arrived, or ' +
      'the root address is unreachable from their network.',
    sourceRef: 'init.cc:183',
  },
  {
    id: 'bootstrap-ring',
    title: 'The bootstrap ring (TCP)',
    narration:
      'Every rank phones the root; the root forwards each rank its successor\'s listen ' +
      'address as it checks in. The result is a TCP socket ring, rank→rank+1 — the ' +
      'first ring NCCL ever builds, before any topology exists. Every out-of-band ' +
      'collective from here on walks this ring.',
    analogy:
      'The TCP session under BGP: no Established, no UPDATE messages, no best-path. ' +
      'Rings all the way down.',
    failureSignature:
      '"Bootstrap: Using <if>" shows the wrong interface (mgmt vs fabric) → fix ' +
      'NCCL_SOCKET_IFNAME. Some ranks connect, others retry then die → firewall between ' +
      'rank and root (34 retries × 100 ms by default).',
    sourceRef: 'bootstrap.cc:133, 355-390',
  },
  {
    id: 'allgather1',
    title: 'AllGather1 — peer discovery',
    narration:
      'Each rank publishes ncclPeerInfo (busId, hostHash, …) over the socket ring. ' +
      '"Same node" is a hostHash equivalence class: hash(hostname + boot_id), ' +
      'overridable with NCCL_HOSTID. Nobody configures the cluster shape — NCCL ' +
      'discovers it here.',
    analogy:
      'OSPF hello / neighbor discovery: who is out there, and which of them share my segment.',
    failureSignature:
      'Containers corrupting hostname or boot_id merge two hosts into one "node" (SHM ' +
      'across machines → crash) or split one host into two (NET between local GPUs → ' +
      'silent perf mystery).',
    sourceRef: 'init.cc:1034-1067, utils.cc:95-158',
  },
  {
    id: 'local-search',
    title: 'Independent local search',
    narration:
      'Each rank now runs the entire L0 pipeline alone on its OWN detected topology: ' +
      'paths → trim → search → rings and trees. No coordination — on identical ' +
      'hardware every rank derives identical graphs. This is the phase the Build view ' +
      'walks through hop by hop.',
    analogy:
      'Every router runs SPF on its own copy of the LSDB — identical inputs, identical trees.',
    failureSignature:
      'A straggler here (downtrained PCIe link, missing NIC, VM-flattened topology) ' +
      'produces a weaker graph than its peers — invisible until the next phase merges it.',
    sourceRef: 'init.cc:1141-1215',
  },
  {
    id: 'consensus',
    title: 'AllGather3 — graph consensus',
    narration:
      'Every rank publishes its graph tuple {pattern, nChannels, sameChannels, bwIntra, ' +
      'bwInter, types, crossNic} plus topoRanks. The merge is a capability negotiation: ' +
      'min() on channels and bandwidth, max() on path types — the communicator is only ' +
      'as strong as its weakest rank. Node numbering itself derives from the exchanged ' +
      'ring data (nodesFirstRank = each ring\'s first rank).',
    analogy:
      'BGP capability negotiation: the session runs at the intersection of what both ' +
      'peers advertise.',
    failureSignature:
      'Channel count mysteriously lower than the hardware supports → ONE degraded rank ' +
      'dragged everyone down. NVLS silently absent → its search found 0 channels ' +
      'somewhere, support revoked communicator-wide.',
    sourceRef: 'init.cc:1438-1446, 1291-1300',
  },
]

/** Sanity accessor — beats in fixed order, ids unique. */
export function preambleBeat(id: string): PreambleBeat {
  const beat = PREAMBLE_BEATS.find((b) => b.id === id)
  if (!beat) throw new Error(`unknown preamble beat: ${id}`)
  return beat
}
