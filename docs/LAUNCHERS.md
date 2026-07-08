# Launchers — Who Assigns Identity, Who Moves the 128 Bytes

*Companion to [ORDER-OF-OPERATIONS.md](ORDER-OF-OPERATIONS.md) Phase P. The launcher owns
P0 (identity + device binding) and P1 (moving the uniqueId). Everything after — the
bootstrap TCP ring, AllGather1, the search — is NCCL and identical regardless of launcher.*

Every launcher must answer the same two questions:

1. **Identity** — who tells each process its global rank, world size, and local rank
   (→ which GPU it binds)?
2. **Rendezvous** — who carries the 128-byte `ncclUniqueId` (really the bootstrap root's
   socket address + magic, bootstrap.h:14-20) from rank 0 to every other rank?

And every answer has a third, hidden dimension: **which network each leg rides.** The
uniqueId's journey (launcher-owned) and NCCL's bootstrap ring (NCCL-owned,
`NCCL_SOCKET_IFNAME` ladder, socket.cc:196-230) are independent path selections — a
symptom must be attributed to the right leg before it can be debugged.

The three below are the canonical representatives of the three launcher families. Most
others reduce to one of them: Ray Train / DeepSpeed / HF Accelerate wrap the torchrun
(store-based) machinery; Kubeflow MPIJob wraps mpirun; Kubeflow PyTorchJob wraps
torchrun; `mpiexec` is mpirun.

---

## 1. mpirun — the MPI runtime family (fully manual)

**How processes start.** `mpirun -np 16 -H nodeA:8,nodeB:8 ./app` spawns its own per-node
daemons (Open MPI `prted`, MPICH `hydra`) over ssh or the scheduler, and those daemons
fork the ranks. Identity comes from the MPI library itself: `MPI_Comm_rank/size` —
before NCCL is anywhere in the picture, `MPI_Init` has already run MPI's *own* wire-up
(which has its own rendezvous story and its own network selection).

**Identity.**
- Global rank: `MPI_Comm_rank(MPI_COMM_WORLD, &rank)`
- Local rank (for device binding): NOT part of the MPI standard — apps use
  `OMPI_COMM_WORLD_LOCAL_RANK` / `MPI_COMM_TYPE_SHARED` splits, then `cudaSetDevice(localRank)`.
  **The app author writes this line.** Getting it wrong is the classic
  "Multiple Ranks are using the same GPU" WARN (init.cc:1053-1060).

**The 128 bytes.** The canonical pattern (nccl-tests, virtually every HPC code):

```c
ncclUniqueId id;
if (rank == 0) ncclGetUniqueId(&id);              // init.cc:183
MPI_Bcast(&id, sizeof(id), MPI_BYTE, 0, MPI_COMM_WORLD);
ncclCommInitRank(&comm, nRanks, id, rank);
```

Fully **manual** — the broadcast is application code. Nothing checks that you did it.

**Which network.** Three separate planes, potentially three different wires:
- mpirun's daemon control plane (ssh, stdout, env): management network.
- The `MPI_Bcast` payload: **MPI's transport** (UCX/verbs on many clusters) — the 128
  bytes may well transit the RDMA fabric.
- NCCL's bootstrap ring afterward: NCCL's own interface ladder — `ib*` first, so IPoIB
  if present, else frontend (socket.cc:207).

**Failure signatures.**
| Symptom | Cause |
|---|---|
| All ranks hang in `ncclCommInitRank`, zero output | forgot the `MPI_Bcast` — every rank minted its OWN uniqueId and is waiting to be its own root |
| `nRanks` mismatch errors / hangs | passed `MPI_COMM_WORLD` size but init'd NCCL over a sub-communicator (or vice versa) |
| "Multiple Ranks are using the same GPU" | local-rank → `cudaSetDevice` mapping bug |
| Works single-node, hangs multi-node | MPI wired up fine (its own transport) but NCCL's bootstrap interface isn't routable between nodes — check `Bootstrap: Using <if>` on every node |

---

## 2. srun — the scheduler-native family (identity automatic, rendezvous BYO)

**How processes start.** Slurm's `slurmstepd` forks the tasks directly on each allocated
node — no ssh, no user-visible daemons. Identity is in the environment before `main()`
runs:

**Identity.**
- Global rank: `SLURM_PROCID`; world: `SLURM_NTASKS`; local rank: `SLURM_LOCALID`.
- Device binding: Slurm can do it FOR you — `--gpus-per-task=1` + cgroup device isolation
  means each task *sees only its own GPU* (CUDA device 0). Powerful, and a trap: NCCL's
  trim stage removes GPUs a rank can't see, so a mis-scoped cgroup shows up later as
  "a GPU missing from every ring" (Phase-P troubleshooting table).

**The 128 bytes.** Slurm doesn't know what NCCL is. Three real-world paths:
1. **App uses MPI anyway** (`srun --mpi=pmix ./app`): PMIx provides the key-value store
   MPI wires up through; then it's the mpirun pattern above — `MPI_Bcast` in app code.
2. **`NCCL_COMM_ID=nodeA:29500 srun ./app`** — NCCL-native, scheduler-friendly: every
   rank parses the address from the env (bootstrap.cc:405-430, `bootstrapCreateRoot`
   with `idFromEnv`); the rank that owns that address listens, everyone else dials in.
   No broadcast needed — the "broadcast" is the batch script's env export. **Manual,
   operator-flavored.**
3. **torchrun under sbatch** (very common): Slurm allocates, torchrun launches — that's
   the store-based family below, with `--rdzv-endpoint=$SLURMD_NODENAME`-style glue.

**Which network.**
- Slurm's control plane (env, stdout, PMIx KVS): the management network slurmd lives on.
- `NCCL_COMM_ID` check-ins: whatever network the configured hostname resolves to —
  **the operator chose it when they wrote the address.**
- Bootstrap ring afterward: NCCL's ladder, as always.

**Failure signatures.**
| Symptom | Cause |
|---|---|
| Every rank thinks it's rank 0 / world size 1 | app read `RANK` (unset under srun) instead of `SLURM_PROCID` — the env-var mapping glue is missing |
| Hang with `NCCL_COMM_ID` set | fixed port blocked between nodes, address resolves to an unroutable interface, or two jobs collided on the same host:port |
| GPU count wrong per rank, rings missing GPUs | `--gpus-per-task` / `--gpu-bind` cgroup scoping vs. what the app expects |
| Works with mpirun, hangs with srun | PMI flavor mismatch — `--mpi=pmix` vs pmi2 vs the MPI library's expectation |

---

## 3. torchrun — the elastic store family (fully automatic)

**How processes start.** One `torchrun` per node (`--nnodes 2 --nproc-per-node 8
--rdzv-endpoint nodeA:29400`); the node agents rendezvous with each other first, agree
on the world, then fork the local workers with the full identity kit in env:

**Identity.**
- `RANK`, `WORLD_SIZE`, `LOCAL_RANK`, `MASTER_ADDR`, `MASTER_PORT` — all set by the
  agent before the worker starts. User code does `torch.cuda.set_device(LOCAL_RANK)`
  (or DDP does it) and `init_process_group("nccl")`.

**The 128 bytes.** Fully **automatic**, two-stage:
1. The node agents' rendezvous (c10d backend) establishes a **TCPStore** — a tiny
   key-value server at the rendezvous endpoint.
2. When a ProcessGroup initializes, rank 0 calls `ncclGetUniqueId` and `set()`s the blob
   into the store; every other rank `get()`s it (ProcessGroupNCCL's broadcast-unique-id
   step). The application never sees the uniqueId at all. Every subgroup created later
   (`new_group()`) moves its own uniqueId through the SAME store — one TCPStore serves
   the whole job's lifetime.

Elasticity is the family's reason to exist: on worker failure, agents re-rendezvous and
restart the job from the last checkpoint with a new world — a thing PMI and mpirun
fundamentally don't do.

**Which network.**
- TCPStore traffic: TCP to `MASTER_ADDR:MASTER_PORT` — rides whatever network that
  hostname resolves to. On most clusters: the frontend.
- Bootstrap ring afterward: NCCL's ladder, independent of MASTER_ADDR.

**Failure signatures.**
| Symptom | Cause |
|---|---|
| Multi-node hang at `init_process_group`, single-node fine | `MASTER_ADDR` resolves to 127.0.0.1 / wrong interface on the workers (classic with container hostnames) |
| `torch.distributed` timeout after exactly N minutes | store `get()` timed out — one node's agent never joined the rendezvous (check it actually started, and the endpoint port) |
| Random ranks fail on restart | stale TCPStore from the previous incarnation still bound to the port |
| NCCL init OK, first collective hangs | identity fine, store fine — the problem is a plane down: NCCL's bootstrap or data fabric; go to the Phase-P table |

---

## The one-table summary

| | mpirun | srun | torchrun |
|---|---|---|---|
| Identity source | MPI library calls | `SLURM_*` env | `RANK`/`LOCAL_RANK` env from agent |
| Device binding | app code (`cudaSetDevice`) | cgroups can do it | `LOCAL_RANK` convention |
| uniqueId transport | `MPI_Bcast` **in app code** | `NCCL_COMM_ID` env (or PMIx→MPI, or nested torchrun) | TCPStore, invisible to app |
| Manual/automatic | manual (author) | manual (operator) | automatic |
| uniqueId leg rides | MPI's transport (often RDMA fabric) | the network in the configured address | network `MASTER_ADDR` resolves to |
| Elastic restart | no | no | yes — the family's raison d'être |

After P1, all three converge: `bootstrapInit` forms the same TCP ring by the same
interface ladder, AllGather1 discovers the same node structure, and the search proceeds
identically. **The launcher decides only how the first 128 bytes travel — but nearly
every "mysterious init hang" lives in exactly that leg.**
