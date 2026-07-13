// L2 DFD — station 60 decomposed, Gane-Sarson style: processes touch stores,
// flows are labeled with the data that moves. Level-2 of the L0-SSA chart.
import { mid } from '../ids'

const n = mid

export const L2_DFD_TITLE = 'L2 · Data flow — processes, stores, and what moves between them'

export const L2_DFD = `flowchart TB
  ${n('S60.d.paths')}["paths matrix<br/>(from station 20)"]
  ${n('S60.d.graphs')}["graphs array<br/>(to AllGather3 / preset)"]

  ${n('S60.d.tmpParams')}[("tmpParams<br/>speed · sameChannels · pattern<br/>typeIntra/Inter · crossNic")]
  ${n('S60.d.best')}[("bestResult<br/>the incumbent solution")]
  ${n('S60.d.budget')}[("credit pool<br/>2^19 shared")]
  ${n('S60.d.speedArray')}[("speed ladder<br/>per-arch table")]

  ${n('S60.d.initParams')}(["6.1 INIT PARAMS<br/>strictest set<br/>search.cc:1074+"])
  ${n('S60.d.searchAttempt')}(["6.2 SEARCH ATTEMPT<br/>recursion + backtracking<br/>:622+ · :726+"])
  ${n('S60.d.keepBest')}(["6.3 KEEP BEST<br/>compareGraphs<br/>:445-461"])
  ${n('S60.d.relaxSelect')}(["6.4 RELAX SELECT<br/>next rung, fixed order<br/>:1206-1246"])
  ${n('S60.d.dup')}(["6.5 DUP CHANNELS<br/>:961-974"])
  ${n('S60.d.climb')}(["6.6 PASS-2 CLIMB<br/>:1255-1283"])
  ${n('S60.d.fallback')}(["6.7 FALLBACK<br/>:1290"])

  ${n('S60.d.initParams')} -- "strictest constraint set" --> ${n('S60.d.tmpParams')}
  ${n('S60.d.speedArray')} -- "ladder start ≤ maxBw" --> ${n('S60.d.initParams')}
  ${n('S60.d.tmpParams')} --> ${n('S60.d.searchAttempt')}
  ${n('S60.d.paths')} -- "feasibility + bw budgets" --> ${n('S60.d.searchAttempt')}
  ${n('S60.d.budget')} <-- "debit per attempt" --> ${n('S60.d.searchAttempt')}
  ${n('S60.d.searchAttempt')} -- "candidate channels" --> ${n('S60.d.keepBest')}
  ${n('S60.d.keepBest')} -- "winner (nCh × bw)" --> ${n('S60.d.best')}
  ${n('S60.d.keepBest')} -- "not good enough" --> ${n('S60.d.relaxSelect')}
  ${n('S60.d.relaxSelect')} -- "one rung looser" --> ${n('S60.d.tmpParams')}
  ${n('S60.d.relaxSelect')} -- "speed ↓" --> ${n('S60.d.speedArray')}
  ${n('S60.d.best')} --> ${n('S60.d.dup')}
  ${n('S60.d.dup')} -- "mirrored rings @ half bw" --> ${n('S60.d.best')}
  ${n('S60.d.best')} --> ${n('S60.d.climb')}
  ${n('S60.d.speedArray')} -- "rungs above the solution" --> ${n('S60.d.climb')}
  ${n('S60.d.climb')} -- "improved solution (channels locked)" --> ${n('S60.d.best')}
  ${n('S60.d.fallback')} -- "identity order · bw 0.1" --> ${n('S60.d.best')}
  ${n('S60.d.best')} -- "ncclTopoGraph tuple" --> ${n('S60.d.graphs')}

  classDef process fill:#12121a,stroke:#00ffff,stroke-width:1.2px,color:#e5e5e5
  classDef store fill:#221f00,stroke:#ffff00,stroke-width:1px,color:#e5e5e5
  classDef entity fill:#1a1a25,stroke:#8888aa,stroke-width:1.4px,color:#e5e5e5
  class ${n('S60.d.initParams')},${n('S60.d.searchAttempt')},${n('S60.d.keepBest')},${n('S60.d.relaxSelect')},${n('S60.d.dup')},${n('S60.d.climb')},${n('S60.d.fallback')} process
  class ${n('S60.d.tmpParams')},${n('S60.d.best')},${n('S60.d.budget')},${n('S60.d.speedArray')} store
  class ${n('S60.d.paths')},${n('S60.d.graphs')} entity
`
