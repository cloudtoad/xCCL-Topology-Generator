# The Locality Tower — Collected Guidance on Topology-Aware Placement

*Who guarantees that NCCL's rank order tracks the physical fabric — the collected public
documentation, layer by layer. Companion to [LAUNCHERS.md](LAUNCHERS.md) and the
bootstrap-ring discussion: NCCL builds its rings on rank arithmetic and trusts the layers
above to have made rank order topology-shaped. These are the layers, and their documents.*

The one-sentence framing: **no single system owns locality.** The fabric enforces it in
copper and prefixes, the scheduler encodes it in rank order, the framework carves rank
order into parallelism dimensions, and NCCL consumes the result axiomatically. Each layer
is documented by its own vendor; the composition is documented nowhere — this file is an
attempt at the index.

---

## Layer F — The fabric: locality in copper and prefixes

- **NVIDIA DGX SuperPOD Reference Architectures** (public PDFs, per GPU generation) —
  SU definitions (e.g., 32 nodes/SU), rail-optimized leaf/spine/superspine design,
  cabling plans, and the hierarchical IP addressing schemes. The addressing plan is
  consumed by the fabric (per-rail containment, route aggregation) and by operators —
  not by NCCL (see Layer N).
- What the RA guarantees downstream: *same NIC index ⇒ same rail, one switch hop* — the
  invariant NCCL's channel↔NIC pairing and PXN assume without verifying.

## Layer S — The scheduler: rank order becomes topology-shaped

This is where "ring neighbors are SU neighbors" is actually enforced.

**Slurm (the HPC path):**
- [Slurm Topology Guide](https://slurm.schedmd.com/topology.html) and
  [topology.conf](https://slurm.schedmd.com/topology.conf.html) — the `topology/tree`
  plugin (switch-hierarchy-aware allocation) and the newer **`topology/block`** plugin.
- Block/segment scheduling — blocks map to NVLink domains / SUs; `--segment` keeps
  allocations inside blocks; `--exclusive=topo` for strict placement. NVIDIA's SLUG24
  talk: [Gaining more control over node scheduling with the Topology/Block
  Plugin](https://slurm.schedmd.com/SLUG24/NVIDIA-Craig_Tierney.pdf) (Craig Tierney,
  NVIDIA — the design rationale, from the vendor that needed it).
- Operator-grade walkthroughs: [CoreWeave: Topology and block scheduling in
  Slurm](https://docs.coreweave.com/products/sunk/optimize_workloads/topology-scheduling);
  [NVIDIA Mission Control admin guide — Slurm Workload
  Management](https://docs.nvidia.com/mission-control/docs/systems-administration-guide/2.3.0/slurm-workload-management.html)
  (BCM generates `topology.conf`; GB200 NVL72 block definitions).

**Topology discovery (feeding the schedulers):**
- **[NVIDIA Topograph](https://github.com/NVIDIA/topograph)** — the productized missing
  piece: discovers the physical network topology (cloud provider APIs, on-prem fabric
  managers) and emits scheduler-consumable output — Slurm `topology.conf`
  ([docs/slurm.md](https://github.com/NVIDIA/topograph/blob/main/docs/slurm.md)) or four
  canonical Kubernetes node labels:
  `network.topology.nvidia.com/{accelerator,leaf,spine,core}` (NVLink clique → leaf →
  spine → core). This is "read the fabric, tell the scheduler," shipped as a service.
- NVIDIA blog: [Running AI Workloads on Rack-Scale Supercomputers: From Hardware to
  Topology-Aware Scheduling](https://developer.nvidia.com/blog/running-ai-workloads-on-rack-scale-supercomputers-from-hardware-to-topology-aware-scheduling/).

**Kubernetes (the cloud-native path):**
- **Kueue Topology-Aware Scheduling (TAS)** —
  [concepts](https://kueue.sigs.k8s.io/docs/concepts/topology_aware_scheduling/),
  [how-to](https://kueue.sigs.k8s.io/docs/tasks/run/topology_aware_scheduling/), and the
  design doc [KEP-2724](https://github.com/kubernetes-sigs/kueue/blob/main/keps/2724-topology-aware-scheduling/README.md):
  hierarchical topology levels from node labels, gang scheduling with topology
  alignment, `preferred`/`required` block/rack placement. Feature gate on by default
  since v0.14.
- [GKE: Schedule workloads with TAS](https://docs.cloud.google.com/ai-hypercomputer/docs/workloads/schedule-gke-workloads-tas)
  — Google's `cloud.google.com/gce-topology-{block,subblock,host}` labels.
- [Nebius: Topology-aware scheduling for GPU workloads](https://docs.nebius.com/kubernetes/gpu/topology-aware-scheduling)
  — a neocloud's operator guide (representative of the class).

**Cloud topology APIs (the raw material):**
- **AWS**: [EC2 Instance Topology](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-topology.html)
  / [DescribeInstanceTopology](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstanceTopology.html)
  — a three-layer network-node hierarchy per instance ("same Layer 3 node = best
  latency"); explicitly designed to be ingested by schedulers.
  [SageMaker HyperPod TAS](https://docs.aws.amazon.com/sagemaker/latest/dg/sagemaker-hyperpod-eks-operate-console-ui-governance-tasks-scheduling.html)
  consumes it managed-service-style.
- GCP compact placement + the gce-topology labels above; OCI publishes analogous
  host-topology levels for its RDMA cluster networks.

## Layer K — The Kubernetes floor: operators, NFD, and rank-by-naming

Two mechanisms Grok-class summaries get half-right, pinned precisely:

**Node-local provisioning and alignment.** The [NVIDIA GPU
Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
(Helm-deployed) installs the driver, container toolkit, device plugin, DCGM, and deploys
**Node Feature Discovery** — which labels each node with its local hardware facts (GPU
model/count, PCIe topology, NUMA layout), discovered via NVML/sysfs. The [Network
Operator](https://docs.nvidia.com/networking/display/kubernetes2570/deployment-guide-kubernetes.html)
does the same for RDMA NICs (SR-IOV, device plugins, GPUDirect plumbing). The **kubelet
Topology Manager** (`single-numa-node` policy) then aligns CPU/GPU/NIC *allocations*
NUMA-wise at pod-admission time — the Kubernetes analog of NCCL's intra-node awareness,
enforced at allocation time where NCCL enforces at run time (both want the PIX GPU↔NIC
pairing for GPUDirect). Cluster-wide fabric view: **not discovered by these operators** —
it arrives as node labels from the provider or Topograph (Layer S). Local = measured;
global = labeled.

**Naming as the locality contract.** The deeper pattern: in Kubernetes, *rank identity
lives in object names* — a pod's ordinal (`worker-3`, `batch.kubernetes.io/job-completion-index`,
`training.kubeflow.org/replica-index`) IS the rank the training job will use. And
[Kueue TAS consumes exactly that](https://kueue.sigs.k8s.io/docs/concepts/topology_aware_scheduling/):
"Rank is a stable numeric identity for a Pod within a workload… Pods with consecutive
indexes should be placed as close as possible in the topology tree." The
`podIndexLabel` in a `topologyRequest` tells TAS which label carries rank; the admission
plan assigns consecutive ranks to adjacent topology domains and injects NodeSelectors to
pin them ([KEP-2724](https://github.com/kubernetes-sigs/kueue/blob/main/keps/2724-topology-aware-scheduling/README.md),
[rank-ordering support](https://github.com/kubernetes-sigs/kueue/issues/3533)).

Pause on what that means for the thesis: the HPC stack enforces "rank order = topology
order" by *hostname collation folklore*; the cloud-native stack has turned the same
convention into **checked machinery** — rank read from the object name, adjacency
enforced by the scheduler, placement pinned before the first process starts. The most
protocol-shaped locality mechanism in the entire tower lives in a Kubernetes admission
controller, not in the collective library.

## Layer W — The framework: rank order carved into parallelism

The user-hypothesis layer — yes, the orchestrating frameworks have explicit machinery,
and its nature is revealing: **they partition rank order, they do not read the fabric.**
The universal contract is *innermost dimension = fastest-varying ranks = most-local
hardware* — correct exactly when the scheduler below did its job.

- **Megatron-Core `RankGenerator`**
  ([parallel_state.py](https://github.com/NVIDIA/Megatron-LM/blob/main/megatron/core/parallel_state.py),
  [API docs](https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.parallel_state.html)) —
  the `order` string (default `tp-cp-ep-dp-pp`) defines dimension nesting;
  `global_rank = tp_rank + dp_rank·tp_size + pp_rank·tp_size·dp_size`. TP innermost ⇒
  contiguous ranks ⇒ NVLink domain, *by convention*. The
  [Parallelism Strategies Guide](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/parallelism-guide.html)
  states the placement rationale.
- **DeepSpeed `ProcessTopology` / `PipeModelDataParallelTopology`**
  ([API docs](https://deepspeed.readthedocs.io/en/stable/pipeline.html),
  [source](https://deepspeed.readthedocs.io/en/stable/_modules/deepspeed/runtime/pipe/topology.html)) —
  an n-D Cartesian grid over ranks with named axes, row-major: axis order = locality
  order. Same contract, different spelling.
- **PyTorch `DeviceMesh`** (torch.distributed.device_mesh) — the modern generalization:
  an n-D mesh over `range(world_size)` with named dims; TorchTitan et al. build
  dp/tp/pp submeshes from it. Again: a *reshape* of rank order, not a topology probe.
- The SC21 Megatron paper ("Efficient Large-Scale Language Model Training on GPU
  Clusters Using Megatron-LM") documents the why: communication volume per dimension
  dictates which dimension gets the most-local slice of the tower.

## Layer N — NCCL/RCCL's own thin slice (source-cited, `ref/src`)

What the collective library itself contributes — all verified in our checkouts:

| Mechanism | What it does | Where |
|---|---|---|
| Intra-node search | full measured topology model (this project's subject) | graph/* |
| NIC-index rail convention + channel↔NIC pairing | keeps a channel on one rail end-to-end — assumes RA cabling | search.cc:735 |
| PXN | routes a cross-rail egress through the same-node GPU owning the right rail's NIC | paths.cc:225, 515-523 |
| MNNVL clique detection | real fabric-locality discovery, NVLink domains only (clusterUuid/cliqueId via NVML) | init.cc:744-753 |
| IB multi-subnet / FLID | LID path within an IB subnet, FLID routing across | net_ib/connect.cc:90-97, 421-424 |
| `NCCL_IB_SUBNET_AWARE_ROUTING` (default 0) | overrides NIC choice by GID-prefix match (/24 default) — reads the rail subnet plan, for reachability repair | net_ib/connect.cc:55-62, 511-625 |
| Tuner/net plugin APIs | the vendor escape hatch where cloud fabric knowledge gets injected (aws-ofi-nccl etc.) | ext-tuner/, ext-net/ |

None of these order rings by locality. Reachability tier only; the inter-node distance
model above the NIC is flat.

## Layer E — Evidence: what happens at the seams (the war-story literature)

The best public documentation of the *composed* system and its failure modes — written
by operators, not vendors:

- **MegaScale** (ByteDance, NSDI '24) — 10k+ GPU training: rank ordering, stragglers,
  diagnostics at scale.
- **Alibaba HPN** (SIGCOMM '24) — why they built a rail-heavy fabric; the network side
  of the same tower.
- **The Llama 3 Herd of Models** (Meta, 2024) — infrastructure section: interconnect
  failures, job restarts, silent throughput loss in the wild.
- **OPT-175B logbook** (Meta, public GitHub) — the raw diary of convention breakage.
- **Rail-only networks** (Wang et al.) and **TopoOpt** (NSDI '23) — research end:
  co-designing fabric and parallelism instead of stacking conventions.
- And the standing observation: **NCCL's GitHub issues are the de facto protocol
  documentation** — our own fidelity anchors (e.g., NVIDIA/nccl#1197) are real
  `NCCL_DEBUG` dumps recorded there, because there is nowhere else.

---

## The composed contract, in one table

| Guarantee | Owner | Enforcement | Documented? |
|---|---|---|---|
| same NIC index ⇒ same rail, 1 hop | RA / cabling | copper | RA PDFs |
| addresses encode rail/SU | RA IP plan | routing config | RA PDFs |
| allocation fits SU/block boundaries | scheduler | topology/tree/block, TAS | Slurm/Kueue docs |
| rank order tracks node adjacency | scheduler + naming | HPC: sort order, block plugin; K8s: Kueue TAS rank-ordering (enforced) | partially (per-tool) |
| contiguous ranks share NVLink | framework convention | RankGenerator/DeviceMesh math | framework docs (as convention, not contract) |
| ring/tree/QP construction from rank order | NCCL | rank arithmetic + local search | source only (and this project) |
| **the whole column above holds simultaneously** | **nobody** | **assumed** | **nowhere** |

The last row is the thesis. Topograph and Kueue TAS are the industry building the
missing verification layer from the scheduler side; nothing yet verifies it from the
protocol side — no layer measures, at job start, whether the rank order it received
actually matches the fabric it's about to flood. The diagnostic NCCL could print in one
line ("rank order crosses SU boundaries N times; minimum M") remains unwritten.
