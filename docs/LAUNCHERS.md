# Launchers — Who Assigns Identity, Who Moves the 128 Bytes

*Companion to [ORDER-OF-OPERATIONS.md](ORDER-OF-OPERATIONS.md) Phase P. The launcher owns
everything below P1: placing the code, spawning the processes, assigning identity, and
carrying the uniqueId. Everything after — the bootstrap TCP ring, AllGather1, the search —
is NCCL and identical regardless of launcher.*

A quiet observation runs through this document. NCCL and RCCL are **network protocols**
— a control plane (the bootstrap ring, the AllGather consensus), a data plane (LL128,
SIMPLE, IB verbs), path selection, capability negotiation — but they were developed
outside the network-protocol community, in the lineage of MPI and the single-tenant
machine room. A protocol from the IETF tradition bootstraps *itself*: well-known ports,
discovery, in-band version negotiation, authenticated sessions. NCCL instead delegates
its entire session-establishment layer to whichever job launcher happens to be present —
three different ecosystems with three different answers. The result works, and works at
enormous scale, but it is a hodge-podge, and the seams are exactly where production
clusters break. This document maps the seams.

Every launcher must answer the same questions, one layer at a time:

- **P−1 — code placement**: how do the same bytes end up runnable on every host?
- **P−0.5 — remote execution**: what mechanism starts a process on host X?
- **P0 — identity**: who tells each process its global rank, world size, local rank
  (→ which GPU it binds)?
- **P1 — rendezvous**: who carries the 128-byte `ncclUniqueId` (the bootstrap root's
  socket address + magic, bootstrap.h:14-20) from rank 0 to every other rank?

And every answer has a hidden dimension: **which network each leg rides.** The launcher's
control plane, the uniqueId's journey, and NCCL's bootstrap ring
(`NCCL_SOCKET_IFNAME` ladder, socket.cc:196-230) are three independent path selections.

---

## Layer P−1: nobody distributes your code

The launchers almost never move application bytes. The universal assumption is
**infrastructural sameness**: every host sees identical code because of a shared
filesystem (NFS/Lustre) or an identical container image. What travels per-job is only
*path + argv + environment* over a control channel.

| | Remote-exec mechanism | What travels per job | Code bytes moved? |
|---|---|---|---|
| Slurm | persistent root daemon (`slurmd`) on every node, always running | step-launch RPCs: path, argv, env, cgroup spec | No (exceptions: `sbatch` uploads the *batch script text* to the controller; `sbcast` exists for diskless nodes) |
| MPI runtimes | transient daemon tree spawned **via ssh** (or via the scheduler inside an allocation) | launch command down the tree; env per forwarding policy | No (`--preload-binary` exists, rarely used) |
| torchrun | **none** — something else already started one agent per node | nothing; distribution happened before torchrun ran | In Kubernetes, effectively yes: the **image pull** is the container era's code-distribution mechanism |

The protocol-community observation: because distribution is *assumed sameness* rather
than *actual copying*, **sameness violations are a first-class failure family** — a stale
NFS cache serving yesterday's `.so`, one pod on an old image. The job launches (paths
resolve everywhere), identity assigns, rendezvous succeeds — and then AllGather1 fires
`WARN Mismatched NCCL version detected` (init.cc:1042). There is no version negotiation
in this protocol; there is version *verification*, after the session is already up.

---

## 1. mpirun — the MPI runtime family (fully manual)

**P−0.5, in detail.** `mpirun -np 16 -H nodeA:8,nodeB:8 ./app` spawns a helper daemon on
each remote host — `orted` (Open MPI 4.x / ORTE) or `prted` (5.x / PRRTE), `hydra_pmi_proxy`
for MPICH — using **ssh** in the default case, or the scheduler's native spawner
(`srun`, `qrsh`) when inside an allocation. The daemons form a routed **out-of-band TCP
tree** among themselves; the launch command propagates down it; each daemon forks the
local ranks and forwards their stdio back up. Environment forwarding policy differs by
implementation (Open MPI whitelists via `-x`; MPICH's hydra forwards most of the caller's
env by default) — a real portability trap for `NCCL_*` tuning vars.

**P0 — identity.** From the MPI library after `MPI_Init`: `MPI_Comm_rank/size`. Local
rank for device binding is **not in the MPI standard** — apps use
`OMPI_COMM_WORLD_LOCAL_RANK` or `MPI_Comm_split_type(SHARED)`, then
`cudaSetDevice(localRank)`. **The app author writes that line.** Getting it wrong is the
"Multiple Ranks are using the same GPU" WARN (init.cc:1053-1060).

**P1 — the 128 bytes.** The canonical pattern (nccl-tests, virtually every HPC code):

```c
ncclUniqueId id;
if (rank == 0) ncclGetUniqueId(&id);              // init.cc:183 — root listener now live
MPI_Bcast(&id, sizeof(id), MPI_BYTE, 0, MPI_COMM_WORLD);
ncclCommInitRank(&comm, nRanks, id, rank);
```

Fully **manual** — the broadcast is application code, and nothing verifies you wrote it.
Note what this is, structurally: one message-passing system (MPI, itself bootstrapped by
PMI and an ssh daemon tree) being used as the out-of-band channel to bootstrap a *second*
message-passing system. Protocols from the networking tradition do not do this; MPI-family
software has always done it, because in the machine room there was always already a
launcher underneath you.

**Which network.** Three planes, potentially three wires: ssh + daemon tree control
traffic (management network); the `MPI_Bcast` payload (MPI's transport — UCX/verbs on
many clusters, so the 128 bytes may well transit the **RDMA fabric**); NCCL's bootstrap
ring afterward (NCCL's own ladder — `ib*` first, socket.cc:207).

**Failure signatures.**
| Symptom | Cause |
|---|---|
| All ranks hang in `ncclCommInitRank`, zero output | forgot the `MPI_Bcast` — every rank minted its OWN uniqueId and waits to be its own root |
| `nRanks` mismatch / hang | `MPI_COMM_WORLD` size vs sub-communicator confusion |
| "Multiple Ranks are using the same GPU" | local-rank → `cudaSetDevice` mapping bug |
| NCCL env tuning "doesn't work" on MPICH-but-not-OMPI (or vice versa) | env forwarding policy — the var never reached the remote ranks |
| Works single-node, hangs multi-node | MPI wired up fine; NCCL's bootstrap interface isn't routable between nodes — check `Bootstrap: Using <if>` on every node |

---

## 2. srun — the scheduler-native family (identity automatic, rendezvous BYO)

**P−0.5, in detail.** Slurm's remote-exec plane is a **persistent root daemon**: `slurmd`
on every compute node, always up, authenticated by **MUNGE** credentials (shared-key HMAC
on every RPC — the closest thing this stack has to session security). The chain:
`sbatch` uploads the script text to `slurmctld` (spooled on the controller) → at
schedule time the controller hands it to the *first* allocated node's `slurmd`, which
runs it as the batch step → `srun` inside the script asks the controller to create a
job step, then talks **directly to each node's `slurmd`** with step-launch RPCs → each
`slurmd` forks a `slurmstepd` per step, which builds the cgroup, binds devices, execs
the tasks, and streams stdio back to `srun` over TCP. No ssh anywhere; the daemons were
there before your job and remain after.

**P0 — identity.** In the environment before `main()`: `SLURM_PROCID` (global),
`SLURM_NTASKS` (world), `SLURM_LOCALID` (local). Device binding can be done FOR you:
`--gpus-per-task=1` + cgroup isolation means each task *sees only its GPU* (always CUDA
device 0). Powerful, and a trap — NCCL's trim stage removes what a rank can't see, so a
mis-scoped cgroup surfaces later as "a GPU missing from every ring."

**P1 — the 128 bytes.** Slurm doesn't know what NCCL is, and a plain NCCL binary under
srun has **no runtime message channel at all** — srun forked it and walked away. Three
real-world paths:

1. **Link MPI anyway** (`srun --mpi=pmix ./app`): PMIx — the Process Management
   Interface — is the HPC world's *standardized version of the hodge-podge*: the
   launcher exposes a key-value store (put/fence/get) over the slurmstepd channels, MPI
   wires itself up through it, and then you're in the mpirun pattern above.
   Deep-dive on the whole PMI/PMI-2/PMIx lineage: [PMIX.md](PMIX.md).
2. **`NCCL_COMM_ID=nodeA:29500`** — NCCL-native and scheduler-shaped. The insight
   (bootstrap.cc:430-458): the default uniqueId contains two values unknowable before
   runtime — an ephemeral OS-assigned port and a random 64-bit magic. `NCCL_COMM_ID`
   removes both: operator-chosen fixed port, and `magic = NCCL_MAGIC`, a **compile-time
   constant** (:446). The handle becomes a pure function of a static string; every rank
   reconstructs it locally from its environment; **zero bytes move between ranks at P1.**
   The one channel srun natively has — launch-time env propagation — becomes the
   rendezvous. The trade: well-known port + constant cookie instead of ephemeral port +
   random cookie; port collisions and crosstalk protection are now the operator's
   problem. Static-config-vs-negotiated-session, the oldest trade in networking.
3. **torchrun under sbatch**: Slurm allocates; torchrun launches — the store family
   below, with `--rdzv-endpoint=$(scontrol show hostnames | head -1)`-style glue.

**Which network.** Slurm control plane (RPCs, PMIx, stdio): the management network
slurmd lives on. `NCCL_COMM_ID` check-ins: whatever network the configured hostname
resolves to — the operator chose it when they wrote the address. Bootstrap ring
afterward: NCCL's ladder, as always.

**Failure signatures.**
| Symptom | Cause |
|---|---|
| Every rank thinks it's rank 0 / world 1 | app read `RANK` (unset under srun) instead of `SLURM_PROCID` — missing glue |
| Hang with `NCCL_COMM_ID` set | fixed port blocked between nodes, address on an unroutable interface, or two jobs collided on host:port |
| GPU count wrong per rank; rings missing GPUs | `--gpus-per-task`/`--gpu-bind` cgroup scoping vs app expectation |
| Works with mpirun, hangs with srun | PMI flavor mismatch — `--mpi=pmix` vs `pmi2` vs what the MPI library expects |
| Whole-job launch failures with auth errors | MUNGE clock skew / key mismatch — the control plane's own session security failing |

---

## 3. torchrun — the elastic store family (fully automatic)

**P−0.5, in detail.** torchrun performs **no remote execution**. One agent per node must
already be running — started by sbatch, pdsh, systemd, or (dominantly now) a Kubernetes
operator that created one pod per node from an image. In the K8s world the *operator*
(Kubeflow PyTorchJob and kin) is doing P−1 and P0 both: the image pull distributes the
code; the pod spec injects `RANK`-determining env per pod. torchrun's own footprint
begins only after all agents exist.

**P0 — identity.** Two-stage: the node **agents** rendezvous first (c10d backend at
`--rdzv-endpoint`), agree on the node set and world size, then each agent forks its
local workers with the full kit in env: `RANK`, `WORLD_SIZE`, `LOCAL_RANK`,
`MASTER_ADDR`, `MASTER_PORT`. User code does `torch.cuda.set_device(LOCAL_RANK)` and
`init_process_group("nccl")`.

**P1 — the 128 bytes.** Fully **automatic**, and the app never sees them: the rendezvous
established a **TCPStore** — a tiny TCP key-value server at the endpoint. When a process
group initializes, rank 0 calls `ncclGetUniqueId` and `set()`s the blob under a
well-known key; every other rank blocks on `get()` (ProcessGroupNCCL's
broadcast-unique-id step). Every subgroup created later (`new_group()`) moves its own
uniqueId through the **same store** — one KV server serves the job's entire lifetime of
communicator creation. Deep-dive on the store itself: [TCPSTORE.md](TCPSTORE.md).

Squint and the TCPStore is a re-invention of PMI's KVS, one ecosystem over — the same
put/fence/get shape, unstandardized, incompatible, solving the identical problem. This
is what "protocols developed outside the protocol community" looks like in practice: the
out-of-band rendezvous store has now been independently invented at least three times
(PMI/PMIx, TCPStore, and every cloud ML platform's flavor), where the networking
tradition would have specified one and moved on.

Elasticity is the family's reason to exist: on worker failure the agents re-rendezvous
and restart from checkpoint with a new world — something PMI and mpirun structurally
don't do.

**Which network.** TCPStore traffic: TCP to whatever `MASTER_ADDR` resolves to — on most
clusters the frontend. Bootstrap ring afterward: NCCL's ladder, independent of
`MASTER_ADDR`.

**Failure signatures.**
| Symptom | Cause |
|---|---|
| Multi-node hang at `init_process_group`, single-node fine | `MASTER_ADDR` resolves to 127.0.0.1 / wrong interface on workers (classic with container hostnames) |
| Timeout after exactly N minutes | store `get()` expired — one agent never joined the rendezvous (did it start? is the endpoint port open?) |
| Random ranks fail on restart | stale TCPStore from the previous incarnation still bound to the port |
| NCCL init OK, first collective hangs | identity and store are fine — a *plane* is down: NCCL bootstrap or data fabric; go to the Phase-P table |

---

## The one-table summary

| | mpirun | srun | torchrun |
|---|---|---|---|
| P−1 code placement | shared FS assumed | shared FS assumed (`sbcast` otherwise) | image pull / shared FS |
| P−0.5 remote exec | ssh-spawned daemon tree (orted/prted/hydra) | persistent `slurmd` + MUNGE-auth'd RPCs | none — BYO (sbatch, pdsh, K8s operator) |
| Identity source | MPI library calls | `SLURM_*` env | `RANK`/`LOCAL_RANK` env from agent |
| Device binding | app code | cgroups can do it | `LOCAL_RANK` convention |
| uniqueId transport | `MPI_Bcast` **in app code** | `NCCL_COMM_ID` env (or PMIx→MPI, or nested torchrun) | TCPStore, invisible to app |
| Manual/automatic | manual (author) | manual (operator) | automatic |
| uniqueId leg rides | MPI's transport (often the RDMA fabric) | the network in the configured address | network `MASTER_ADDR` resolves to |
| Elastic restart | no | no | yes — the raison d'être |

After P1, all three converge: `bootstrapInit` forms the same TCP ring by the same
interface ladder, AllGather1 discovers the same node structure, and the search proceeds
identically. (Who guarantees rank order handed over here actually tracks the physical
fabric — schedulers, frameworks, discovery services — is its own layer cake:
[PLACEMENT.md](PLACEMENT.md).) **The launcher decides only how the first 128 bytes travel — but nearly
every "mysterious init hang" lives in exactly that leg.**

---

## Coda: a protocol without a bootstrap protocol

Line the bootstrap up against the idioms the network-protocol community standardized
decades ago:

| Concern | The protocol-community idiom | The NCCL reality |
|---|---|---|
| Peer discovery | multicast hellos, well-known ports (BGP: TCP/179) | none — peers are *told*, by a foreign system |
| Session address | well-known / negotiated | ephemeral port inside a 128-B blob, carried by MPI, a Python KV store, or an env var |
| Authentication | MD5/TCP-AO/TLS on the session | a random 64-bit cookie — or a **compile-time constant** under `NCCL_COMM_ID` |
| Version negotiation | capabilities exchanged in the OPEN | none — equality *verified* after the session is up (WARN at AllGather1) |
| Wire format | specified, versioned, endian-defined | `memcpy` of C structs (`extInfo`, `ncclBootstrapHandle`) — an ABI, not a protocol; works because homogeneity is assumed |
| Operational telemetry | MIBs, `show` commands | `NCCL_DEBUG=INFO` grep (RAS, recently, is a real management plane growing in) |

None of this is an indictment — it's lineage. NCCL grew from the MPI world, where an
omniscient scheduler owns a single-tenant, homogeneous, trusted machine room, and where
"the launcher will hand you your identity and a side channel" has been the ground truth
since PMI. The internet protocol community assumed the opposite on every axis
(multi-tenant, adversarial, heterogeneous, no central authority), and its protocols
carry their own bootstrap because nothing else could be trusted to.

The two traditions are now colliding: GPU fabrics are the largest, fastest networks in
the building, run by people who think in BGP and OSPF. The convergence is visible from
both directions — NCCL growing protocol-shaped organs (`NCCL_COMM_ID` as a well-known
port, RAS as a management plane, the OOB-net plugin), and the network community arriving
with standardization efforts (Ultra Ethernet, UALink) that treat collective transport as
a first-class protocol problem. Until that convergence completes, the seams documented
above — three ecosystems, three rendezvous stores, sameness by assumption — are where
the pager goes off.
