# TCPStore / c10d — The Third Store

*Completes the trilogy begun in [PMIX.md](PMIX.md) and [LAUNCHERS.md](LAUNCHERS.md):
the machine room's KVS (PMI/PMIx), NCCL's own bootstrap ring, and now the Python
ecosystem's answer — the c10d TCPStore, the rendezvous system under every
`init_process_group("nccl")` on the planet. Source references are to the PyTorch tree
(`torch/csrc/distributed/c10d/`, `torch/distributed/elastic/rendezvous/`), which is not
vendored in `ref/`; mechanics below are stated at the level that survives version drift.*

Why a third store exists at all is the thesis in miniature: PyTorch needed exactly what
PMI provides — put/fence/get for processes that can't yet talk — but PMI lived in the
HPC stack (linked into MPI, served by schedulers), and PyTorch's world was
`pip install` on cloud VMs. So the same shape was built again, in the new ecosystem's
native materials: a bare TCP key-value server, zero dependencies, zero standards
process. One shape, third implementation, still no shared wire.

---

## What it is

A **single-server, in-memory, blocking key-value store over TCP**. One process binds
the port and owns all state; every other participant is a client. The full data model:

```
set(key, bytes)         → store; wakes any waiters on key
get(key)                → BLOCKS until key exists (server parks the connection), then returns
add(key, n)             → atomic increment; returns new value  ← counters/barriers are built on this
compare_set(key, old, new) → CAS                               ← the elastic state machine is built on this
wait(keys, timeout) / check(keys) / delete_key / num_keys
```

No replication, no persistence, no election, no sharding. The server is a SPOF by
design — acceptable because its whole job is a few thousand tiny values during init,
and if it dies your job was dying anyway. (Where that trade was unacceptable, the etcd
rendezvous backend exists — actual Raft-backed consensus with leases — but c10d is the
default precisely because it needs nothing installed.)

**Blocking `get` is the load-bearing semantic.** PMI has an explicit fence; TCPStore
has none — synchronization is implicit in "readers block until the writer arrives."
Rank 0 `set()`s the NCCL uniqueId; N−1 ranks are already parked inside `get()`; the set
releases them all. The fence dissolved into the read.

## Who hosts it — the two-store reality under torchrun

- **Legacy / manual `env://` init**: the **rank-0 worker itself** hosts the store at
  `MASTER_ADDR:MASTER_PORT` (`is_master=true` = "I bind, I serve"), everyone else
  connects as a client. The store lives *inside a training process*.
- **torchrun (elastic)**: the **agents** rendezvous first through a store at
  `--rdzv-endpoint` — whichever agent successfully binds the port becomes the server;
  losers of the bind race connect as clients. After rendezvous, that same agent-side
  store is **shared down to the workers** (`TORCHELASTIC_USE_AGENT_STORE`) so the job
  doesn't spawn a second one; `MASTER_ADDR/PORT` handed to workers point at it.
- **Kubernetes operators**: same as torchrun, with the endpoint being a Service name —
  meaning the rendezvous now also depends on cluster DNS, a dependency neither PMI nor
  NCCL bootstrap ever had.

One server, many tenants: every process group — the world group, every
`new_group()` subgroup, every pipeline/tensor-parallel slice — multiplexes through the
same store via **PrefixStore** namespacing (keys prefixed per group), and every one of
their NCCL uniqueIds transits it (`ProcessGroupNCCL::broadcastUniqueNCCLID`: rank 0
`set()`s the 128-byte blob under the group's prefix; peers `get()`).

## The wire

A private binary protocol: single-byte opcodes (SET, GET, ADD, WAIT, CHECK,
COMPARE_SET, …), length-prefixed byte strings. **Unversioned and unspecified** — there
is no protocol negotiation at connect, and cross-version client/server compatibility is
neither promised nor checked. It works for the same reason NCCL's `memcpy`'d structs
work: the sameness assumption — every participant runs the same image, so the wire
format is an internal ABI, not a contract. (PMI-1, from 1998, negotiated
`pmi_version=1` on its first line. The 2020s store does not.)

## Security: the starkest data point in the trilogy

The TCPStore has **no authentication of any kind**. Not a session cookie, not a magic
number, not a MUNGE credential. Anyone who can reach the port can `get` any key
(including every process group's NCCL uniqueId — i.e., the address needed to join the
bootstrap), `set` any key, or `add` garbage to a barrier counter. The graduated scale
across the trilogy:

- PMIx: MUNGE/uid handshake on a node-local Unix socket — real, if machine-room-scoped, auth;
- NCCL bootstrap: a random 64-bit magic — a session cookie, crosstalk protection but not security;
- TCPStore: nothing. Bind on `0.0.0.0`, first-come-first-served.

Each successive store was born in a *more* hostile environment (scheduler-owned nodes →
shared clusters → cloud VMs and Kubernetes) and shipped with *less* session security —
the exact inverse of how the protocol community's designs evolved over the same
decades. The mitigation, as ever, is infrastructural: VPCs, network policies, "don't
expose the port," trust by perimeter rather than by protocol.

## The elastic rendezvous state machine (what torchrun adds on top)

The store is just memory; torchrun's `DynamicRendezvousHandler` runs a small
distributed state machine *inside* it, entirely via `compare_set` on a state blob:

1. **Join**: each arriving agent CASes itself into the participant list. Gate on
   `min_nodes`/`max_nodes` with a join deadline (default ~600 s) and a `last_call`
   grace window (~30 s) — arrive, then wait briefly for stragglers.
2. **Freeze & assign**: the round closes; participants are sorted deterministically and
   ranks assigned; world size fixed; workers launched with `RANK`/`WORLD_SIZE`/
   `LOCAL_RANK` in env.
3. **Monitor**: agents heartbeat keep-alive keys with TTL-ish timestamps; a missed
   heartbeat marks a participant dead.
4. **Re-rendezvous**: on failure or scale-up request, the **round counter** increments,
   state re-forms under new keys (stale keys from dead rounds are why "restart reuses
   the port" bugs present as ghost participants), workers are restarted from
   checkpoint with a possibly different world.

This is the one genuinely novel capability of the third store — PMI worlds are
immutable and mpirun worlds die whole. It's also a familiar shape at the wrong layer:
membership, liveness, generations — a gossip/consensus protocol's job description —
implemented as CAS retries against an unauthenticated, unreplicated KV server.

## Which network

| Leg | Rides |
|---|---|
| Agent rendezvous + worker store traffic | TCP to whatever `--rdzv-endpoint` / `MASTER_ADDR` resolves to — frontend/pod network in practice; **plus cluster DNS** in the K8s case |
| The payload contents | NCCL uniqueIds — descriptions of bootstrap endpoints on whichever network NCCL's ladder later picks |
| What NCCL builds after reading them | the bootstrap ring (interface ladder), then the data plane (`NCCL_IB_HCA`) |

Same nesting-doll pattern as PMI: the store's traffic and the endpoints it carries live
on different networks, and neither is the fabric the job actually trains on.

## Scale story

The naïve single-threaded server met the accept-storm wall: at tens of thousands of
ranks, every client opens a connection (often several — one per process group prefix
epoch), and connection setup serializes on one accept loop. The fix (PyTorch ≥2.4
default) is a **libuv-based server backend** — evented I/O, orders-of-magnitude better
connect throughput. Note what the fix was *not*: not sharding, not a tree, not a
protocol change — a better event loop under the same single server. The HPC lineage hit
its scale wall and answered with direct modex and "instant on"; the Python lineage hit
its wall and answered with `epoll`. Both answers are true to their traditions.

## Failure signatures

| Symptom | Cause |
|---|---|
| Hang at `init_process_group`, all nodes | nobody could bind/reach the endpoint — port blocked, `MASTER_ADDR` resolving to 127.0.0.1 or the wrong interface in a container |
| `Connection reset` / `Broken pipe` from the store mid-init at scale | pre-libuv accept storm, or a middlebox reaping half-open connections |
| Timeout after exactly N seconds in `store.get` | writer never arrived: one rank crashed before its `set` — the blocking-get fence waiting for a corpse (same disease as the PMI fence, different symptom) |
| Ghost participants / instant re-rendezvous failures after restart | stale state keys from a previous round on a reused endpoint |
| Random subgroup init failures in huge jobs | store server saturation — every `new_group()` multiplies key traffic through the one server |
| Works on VMs, fails in K8s | the Service-DNS dependency: rendezvous now fails when DNS does |

---

## The trilogy, side by side

| | PMI / PMIx | NCCL bootstrap | c10d TCPStore |
|---|---|---|---|
| Born | 1990s, MPICH machine room | 2015+, NVIDIA | 2017+, PyTorch |
| Shape | put / **fence** / get | root check-in → **ring** allgather + address book | set / blocking-get / **CAS** |
| Server | per-node daemon inside the RM | transient root thread on rank 0, then no server at all (peer ring) | one process binds a port |
| Rendezvous to the store | inherited fd (PMI-1) → env + Unix socket (PMIx) | the 128-byte handle, carried by someone else | `host:port` in env / CLI |
| Wire | ASCII w/ version handshake → typed, versioned binary (bfrops) | `memcpy`'d C structs, unversioned | private binary opcodes, unversioned |
| Auth | none → MUNGE/uid handshake | random 64-bit magic (or compile-time constant) | **none** |
| Sync primitive | explicit fence (collective) | the ring itself | blocking get / CAS retry |
| Scale answer | direct modex, instant-on ambition | O(1) sockets per rank, O(N) address book | libuv event loop |
| Elasticity | no (worlds immutable) | no (comm dies whole; split/grow via parent) | **yes — the reason it exists** |
| Failure detection | none in core (fence waits forever) | none (socket death found at next use) | agent heartbeats, above the store |
| Standard? | yes (PMIx Standard) — but the inter-node fabric is out of scope | no — internal ABI | no — internal ABI |
| Inter-op with the other two | none | none | none |

Three stores, one job description, zero shared bytes. Each community rebuilt session
establishment in its own materials, each carried its home environment's trust
assumptions (and kept them long after leaving home), and each stopped standardizing at
its ecosystem's edge. A network engineer reads this table and recognizes the
counterfactual instantly: this is what the world would look like if every routing
vendor had invented its own incompatible neighbor-discovery, and the industry's answer
to interop had been "run only one vendor per cluster." Which is, of course, exactly the
answer the GPU-fabric world currently lives with.
