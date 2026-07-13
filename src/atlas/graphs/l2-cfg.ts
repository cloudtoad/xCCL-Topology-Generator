// L2 CFG — station 60 as a quotient control-flow graph. Node ids are atlas
// registry ids (sanitized by mid()); the Atlas view resolves clicks through
// ATLAS_BY_MID. Content mirrors DECISION-FLOW §60, which mirrors search.cc.
import { mid } from '../ids'

const n = mid

export const L2_CFG_TITLE = 'L2 · Control flow — the two-pass ladder machine'

export const L2_CFG = `flowchart TB
  ${n('S60.entry')}(["COMPUTE entry<br/>strictest params · budget = 2^19<br/>search.cc:1074+"])
  ${n('S60.attempt')}(["SEARCH: run one attempt<br/>(debit credit pool)<br/>goto target"])
  FOUND{"solution ≥<br/>minChannels?"}
  ${n('S60.keep')}(["keep-if-better<br/>nCh × bw vs incumbent<br/>search.cc:445-461"])
  ${n('S60.optimal')}{"nCh × bw ≥ totalBw?<br/>optimality"}
  ${n('S60.budget')}{"credits &lt; 0<br/>∧ have solution?"}
  ${n('S60.rungSame')}(["rung 1<br/>sameChannels → 0<br/>:1206"])
  ${n('S60.rungPattern')}(["rung 2<br/>BALANCED_TREE → TREE<br/>:1217"])
  ${n('S60.rungIntra')}(["rung 3<br/>typeIntra++<br/>:1224"])
  ${n('S60.rungInter')}(["rung 4<br/>typeInter++<br/>:1231"])
  ${n('S60.rungXnic')}(["rung 5<br/>crossNic → 1<br/>:1239"])
  ${n('S60.rungSpeed')}(["rung 6<br/>speed ↓ one rung<br/>:1246"])
  EXH{"ladder<br/>exhausted?"}
  ${n('S60.accepted')}(["DONE: solution accepted<br/>params locked<br/>:1254"])
  ${n('S60.dup')}(["DupChannels<br/>mirror rings @ half bw<br/>:1257"])
  ${n('S60.pass2')}(["PASS 2: climb speed ladder UP<br/>channels locked · 3-way branch<br/>RING both · NVLS bwInter · tree bwIntra<br/>:1255-1283"])
  ${n('S60.fallback')}(["LAST RESORT<br/>identity order · bw 0.1 · SYS<br/>:1290"])
  ${n('S60.exit')}(["print GRAPH line<br/>:1319"])

  ${n('S60.entry')} --> ${n('S60.attempt')}
  ${n('S60.attempt')} --> FOUND
  FOUND -- yes --> ${n('S60.keep')}
  FOUND -- no --> ${n('S60.rungSame')}
  ${n('S60.keep')} --> ${n('S60.optimal')}
  ${n('S60.optimal')} -- yes --> ${n('S60.accepted')}
  ${n('S60.optimal')} -- no --> ${n('S60.budget')}
  ${n('S60.budget')} -- yes --> ${n('S60.accepted')}
  ${n('S60.budget')} -- "no — relax further" --> ${n('S60.rungSame')}
  ${n('S60.rungSame')} -- "not yet fired" --> ${n('S60.attempt')}
  ${n('S60.rungSame')} -- "already 0" --> ${n('S60.rungPattern')}
  ${n('S60.rungPattern')} -- fired --> ${n('S60.attempt')}
  ${n('S60.rungPattern')} -- n/a --> ${n('S60.rungIntra')}
  ${n('S60.rungIntra')} -- fired --> ${n('S60.attempt')}
  ${n('S60.rungIntra')} -- "at max" --> ${n('S60.rungInter')}
  ${n('S60.rungInter')} -- fired --> ${n('S60.attempt')}
  ${n('S60.rungInter')} -- "at max" --> ${n('S60.rungXnic')}
  ${n('S60.rungXnic')} -- fired --> ${n('S60.attempt')}
  ${n('S60.rungXnic')} -- "n/a" --> ${n('S60.rungSpeed')}
  ${n('S60.rungSpeed')} -- "dropped — restart cascade" --> ${n('S60.attempt')}
  ${n('S60.rungSpeed')} --> EXH
  EXH -- "yes, with solution" --> ${n('S60.accepted')}
  EXH -- "yes, empty-handed" --> ${n('S60.fallback')}
  ${n('S60.accepted')} --> ${n('S60.dup')}
  ${n('S60.dup')} --> ${n('S60.pass2')}
  ${n('S60.pass2')} -- "improved: keep climbing" --> ${n('S60.pass2')}
  ${n('S60.pass2')} --> ${n('S60.exit')}
  ${n('S60.fallback')} --> ${n('S60.exit')}

  classDef process fill:#12121a,stroke:#00ffff,stroke-width:1.2px,color:#e5e5e5
  classDef decision fill:#1a1a25,stroke:#ffff00,stroke-width:1.2px,color:#e5e5e5
  classDef rung fill:#1a1030,stroke:#aa66ff,stroke-width:1.2px,color:#e5e5e5
  classDef terminal fill:#101d10,stroke:#00ff41,stroke-width:1.4px,color:#e5e5e5
  classDef danger fill:#221010,stroke:#ff0040,stroke-width:1.2px,color:#e5e5e5
  class ${n('S60.entry')},${n('S60.attempt')},${n('S60.keep')},${n('S60.dup')},${n('S60.pass2')} process
  class FOUND,${n('S60.optimal')},${n('S60.budget')},EXH decision
  class ${n('S60.rungSame')},${n('S60.rungPattern')},${n('S60.rungIntra')},${n('S60.rungInter')},${n('S60.rungXnic')},${n('S60.rungSpeed')} rung
  class ${n('S60.accepted')},${n('S60.exit')} terminal
  class ${n('S60.fallback')} danger
`
