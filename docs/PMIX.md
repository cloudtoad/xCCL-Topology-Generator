# PMI / PMIx — The Machine Room's Rendezvous Protocol

*Companion to [LAUNCHERS.md](LAUNCHERS.md). That document kept saying "the launcher
provides a key-value store the MPI library wires up through." This one opens that box —
because PMI is where the HPC community came closest to doing what the network-protocol
community would have done, and where it stopped is the most instructive part.*

First, a grep-verified fact that frames everything: **NCCL and RCCL contain zero PMI or
PMIx client code** (`grep -ri pmi ref/src/nccl/src ref/src/rccl/src` → nothing). When a
uniqueId travels "via PMIx," it means: the app called `MPI_Bcast`, MPI's collective ran
over transport endpoints that *MPI* had earlier exchanged through PMIx. NCCL sits two
delegation layers above the mechanism this document describes.

---

## The chicken-and-egg that created PMI

An MPI library at `MPI_Init` needs two things before it can pass a single message:
its identity (rank/size), and every peer's **transport endpoint** — the "business card":
an IB QP number and LID/GID, a UCX worker address, a TCP host:port. But exchanging
business cards requires message passing, which requires business cards.

The machine-room resolution: *the process manager that forked you already has a control
channel to every process it forked.* So expose a tiny API over that channel and let the
library bootstrap through it. That API is PMI — **the Process Management Interface** —
and its data model has been the same for 25 years:

```
put(key, value)      → stage my business card, locally
commit / fence()     → barrier; all staged data becomes globally visible
get(rank, key)       → read anyone's card
```

An allgather, executed by the launcher's daemon tree, on behalf of a communication
library that can't yet communicate. Every rendezvous store since — PMIx, PyTorch's
TCPStore, every cloud platform's flavor — is this same shape reinvented.

---

## PMI-1 — the ASCII generation (MPICH lineage, late 1990s)

**Rendezvous.** The ultimate single-tenant move: the launcher hands the client its
control channel *by inheritance* — `PMI_FD` in the environment is a file descriptor the
process was forked holding, pre-connected to the process manager (`PMI_PORT` host:port
is the fallback). `PMI_RANK`, `PMI_SIZE` complete the kit. **There is no authentication
anywhere: possessing the inherited fd IS the credential.** In a world where the
scheduler forked you, that's airtight; in any other world it isn't a security model
at all.

**The wire.** Newline-terminated ASCII key=value commands:

```
cmd=init pmi_version=1 pmi_subversion=1
cmd=put kvsname=kvs_0 key=P0-businesscard value=description#rank0$port=51423$...
cmd=barrier_in
cmd=get kvsname=kvs_0 key=P1-businesscard
```

Human-readable, greppable, and — note with some irony — **version-negotiated at init**:
`pmi_version=1` is in the very first command. The 1990s ASCII protocol has the version
handshake that NCCL's binary bootstrap still lacks.

**The limits.** Fixed maximums discovered at runtime (`cmd=get_maxes`: key ~64 B, value
~1 KB). The classic failure: a fat transport stack (many NICs, long UCX worker address)
overflows the business card → truncation or init failure. Wire-format limits leaking
into application behavior — a very protocol-shaped bug from a very unprotocol-shaped
design process.

**Who serves it.** MPICH's `hydra_pmi_proxy` per node; Slurm's slurmstepd implements the
server side (`--mpi=pmi2`'s predecessor, `libpmi.so`); Flux and the Cray launchers speak
dialects. "Dialects" is load-bearing: PMI-1 was never a standard, it was MPICH's
internal interface that everyone else cloned approximately.

---

## PMI-2 — the scalability patch (~2010)

Same model, three fixes worth knowing:

- **Node-local awareness**: `PMI2_Info_GetNodeAttr` lets ranks on the same node find
  each other *without* a global exchange — the beginning of the local/remote scope
  distinction PMIx later formalized.
- **Job attributes**: world facts (node lists, universe size) queryable instead of
  exchanged.
- A revised keyval wire with proper framing, still launcher-served (Slurm:
  `srun --mpi=pmi2`, still in slurmstepd).

The scaling pressure is easy to state: the put/fence/get pattern moves O(N) cards
through the daemon tree and delivers O(N) cards to each of N ranks — O(N²) total data
movement for a full wire-up. At exascale process counts that's untenable, which brought:

---

## PMIx — the HPC community does protocol work (2014→)

PMIx ("PMI eXascale") is the interesting one, because it's where the machine-room
tradition genuinely converged toward network-protocol discipline — an actual standards
body (the PMIx Standard, versions 1–5), a reference implementation (OpenPMIx), a
reference runtime (PRRTE — which is what Open MPI 5 launches with, having retired ORTE).

**Architecture.** Three pieces:
- a **client library** (`libpmix`) linked into each rank;
- a **per-node PMIx server** embedded in the local launcher daemon (slurmstepd via
  Slurm's `--mpi=pmix` plugin; `prted` for PRRTE);
- the **inter-node fabric between servers — which PMIx does not specify.** Hold that
  thought for the coda.

**Rendezvous.** Environment again, but now to a **Unix domain socket**:
`PMIX_SERVER_URI*` (the socket's rendezvous string), `PMIX_NAMESPACE` (the job's
identity), `PMIX_RANK`. The client connects across the UDS — node-local, never touching
any network — and performs an actual **handshake**: version exchange, and a security
credential (the `psec` framework: MUNGE credential or native uid/gid check on the
socket). Compared to PMI-1's inherited fd, this is protocol adulthood: versioned,
authenticated session establishment.

**The wire.** Binary, framed, **typed**: values are `pmix_value_t` with tagged data
types, serialized by a buffer-ops layer (`bfrops`) that handles representation. A
specified, versioned, typed wire — the things PMI-1's ASCII and NCCL's `memcpy`-a-struct
both lack.

**The data model, matured.**
- `put` takes a **scope**: `PMIX_LOCAL` (same-node ranks only), `PMIX_REMOTE`
  (off-node only), `PMIX_GLOBAL` — the PMI-2 node-awareness idea, formalized.
- `fence` takes a **collect flag**: collect=true is the classic eager allgather of all
  staged blobs through the daemon tree; collect=false makes the fence a pure barrier and
  defers data movement to…
- **direct modex** (`dmodex`): on a `get` miss, the local server fetches the key from
  the *owning rank's node server* on demand, over the RM's fabric. Lazy, pull-based
  wire-up: pay for the peers you actually talk to. (The exact trade NCCL makes
  differently — its bootstrap ring eagerly allgathers the whole address book, then
  direct-dials from cache.)
- The **"instant on" ambition**: endpoints computable from rank without any exchange at
  all — the moment you can derive a peer's address from its identity, the KVS becomes
  unnecessary. The networking analog is exact: SLAAC, addresses derived from identity
  instead of assigned by conversation.

**Beyond the KVS.** The standard grew a very large surface: spawn, connect/disconnect,
publish/lookup, event notification, debugger/tool attachment, allocation requests. Much
of it is optional ("the implementation MAY…"), which in practice means the portable
subset is the KVS core — and the version matrix is real operational surface: Slurm's
plugin is built against a specific PMIx ABI (`--mpi=pmix_v3/v4/v5`), Open MPI requires
compatible libpmix, and mismatches present as rendezvous failures, not clean errors.

---

## Which network does each leg ride?

The three-plane split, now with PMI in the picture:

| Leg | Transport | Network |
|---|---|---|
| Client ↔ local PMIx server | Unix domain socket (PMI-1: inherited fd) | **none** — never leaves the node |
| Server ↔ server (fence data, dmodex) | the RM's own daemon fabric: Slurm's slurmstepd tree, PRRTE's OOB TCP mesh | management network |
| The *payload contents* | IB QPNs/GIDs, UCX/OFI worker addresses | describe endpoints on the **RDMA fabric** — the cards are ABOUT the fast network, but never travel on it |
| What MPI then builds from the cards | UCX/OFI/verbs connections | RDMA fabric |
| What NCCL then builds, two layers up | its own bootstrap ring + IB QPs | NCCL's interface ladder + `NCCL_IB_HCA` |

A rank's IB endpoint is born on the fabric, described in a business card, staged over a
Unix socket, allgathered over the management Ethernet by a job scheduler, and consumed
back on the fabric. Five legs, three planes, two delegations — for every layer of the
stack, again.

---

## Failure signatures

| Symptom | Cause |
|---|---|
| `srun: MPI type 'pmix' not found` / silent PMI fallback then hang at `MPI_Init` | Slurm built without the pmix plugin, or plugin ABI (`pmix_v3/v4/v5`) mismatches the app's libpmix |
| Works with `--mpi=pmix`, hangs with `--mpi=pmi2` (or vice versa) | the MPI library speaks one flavor; the launcher served the other — flavor is negotiated with nobody |
| `MPI_Init` fails only on fat-NIC nodes (PMI-1 era) | business card overflowed the ~1 KB value limit |
| Hang in `MPI_Init` at scale, small jobs fine | fence data volume through the daemon tree — the O(N²) eager exchange hitting its wall |
| Rendezvous failure **inside containers** | the PMIx UDS / session directory isn't mounted into the container namespace — the client can't reach a server that's 3 µs away (this is the problem pyxis/enroot exist to solve on Slurm) |
| MUNGE errors at step launch | the control plane's shared-key auth: clock skew or key mismatch between nodes |
| One rank crashed pre-fence; everyone else hangs forever | fence is a barrier: no timeout by default, no failure propagation in older flavors — the whole job waits for a corpse |

That last one deserves its BGP contrast: a dead BGP peer is *detected* — hold timer,
session reset, routes withdrawn. A dead PMI rank is simply *absent from a barrier*, and
absence looks identical to slowness. Failure detection was the RM's job, notification
the standard's optional extension — nobody's mandatory core.

---

## Coda: standardizing the API, not the wire

Here is the shape of the whole story. The HPC community, pressed by scale, eventually
did real protocol engineering: PMIx has a standards body, versioned typed wire encoding,
a security handshake, scoped data, lazy fetch. And yet — look where the standard's edge
is. It specifies the **client API** exhaustively and the **client↔local-server wire**
adequately, and it leaves the **server↔server fabric** — the actual distributed-systems
part, the part that moves bytes between machines — formally out of scope, delegated to
"the host environment": Slurm's tree, PRRTE's mesh, each RM's private business.

It is a protocol standard with a hole where the network protocol would go. The IETF
tradition standardizes the bits between machines and leaves your API to you; the HPC
tradition standardizes the function signatures and leaves the bits between machines to
the vendor. Same engineers-under-pressure instincts, opposite conservation law — because
the machine room always had a trusted, homogeneous, vendor-supplied middle, and the
internet never did.

Seen from that angle, the whole stack this project documents is one pattern at three
altitudes: **PMIx** (endpoints exchanged through an unspecified middle), **NCCL
bootstrap** (a bespoke unversioned struct-copy protocol behind a launcher-delivered
address), and **the TCPStore** (the same KVS, reinvented in Python's ecosystem because
the other two belonged to someone else's stack). Three rendezvous systems, one shape,
zero shared wire formats — the signature of protocols developed outside the protocol
community, each solving session establishment as a private implementation detail rather
than a public contract.
