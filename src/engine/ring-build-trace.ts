// =============================================================================
// Ring build trace — the construction phase of the rings, event by event
//
// The DecisionLog records WHAT the search decided; this trace records HOW:
// every candidate scoring (the L3 tiebreaker cascade), every hop taken with
// the bandwidth it consumed, every dead-end backtrack, every ring closure,
// every relaxation of the L2.2 cascade, and the final DupChannels doubling.
//
// Capture strategy: the relaxation/speed journey is recorded live (cheap,
// bounded by the cascade). Hop-level detail is captured by ONE deterministic
// re-run of the channel search at the final accepted parameters — same
// inputs, same ordering rules, therefore the identical rings, now narrated.
// A detail budget caps pathological backtracking storms.
// =============================================================================

export interface CandidateScore {
  id: string
  intraBw: number
  intraNhops: number
  /** Rank in the sorted candidate list (0 = best by the L3 cascade). */
  rank: number
}

export type RingBuildEvent =
  | { kind: 'phase'; label: string; detail: string; sourceRef: string }
  | { kind: 'speed'; speed: number; detail: string }
  | { kind: 'relax'; action: string; reason: string; sourceRef: string }
  | { kind: 'attempt'; n: number; speed: number; sameChannels: number; pattern: number; typeIntra: number; typeInter: number; crossNic: number; found: number; kept: boolean }
  | { kind: 'accepted'; speed: number; sameChannels: number; typeIntra: number; typeInter: number; crossNic: number; nChannels: number }
  | { kind: 'improve'; fromSpeed: number; toSpeed: number; kept: boolean }
  | { kind: 'channel-start'; channel: number; startGpu: string; speed: number; reused: boolean; net?: string }
  | { kind: 'consider'; channel: number; from: string; candidates: CandidateScore[]; chosen: string }
  | { kind: 'hop'; channel: number; from: string; to: string; before: number; after: number }
  | { kind: 'backtrack'; channel: number; at: string; backTo: string }
  | { kind: 'close'; channel: number; from: string; to: string }
  | { kind: 'channel-done'; channel: number; order: string[]; netIn?: string; netOut?: string }
  | { kind: 'dup'; fromChannels: number; toChannels: number; bwBefore: number; bwAfter: number; sourceRef: string }
  | { kind: 'done'; nChannels: number; speed: number }

export interface RingBuildTrace {
  events: RingBuildEvent[]
  truncated: boolean // detail budget exhausted (relax/close/done still recorded)
}

const DETAIL_BUDGET = 6000

export class RingBuildTracer {
  events: RingBuildEvent[] = []
  truncated = false
  private detailLeft = DETAIL_BUDGET

  /** Always-recorded structural events (cheap, bounded). */
  push(e: RingBuildEvent): void {
    this.events.push(e)
  }

  /** Budgeted hop-level detail (consider/hop/backtrack). */
  pushDetail(e: RingBuildEvent): void {
    if (this.detailLeft <= 0) {
      this.truncated = true
      return
    }
    this.detailLeft--
    this.events.push(e)
  }

  toTrace(): RingBuildTrace {
    return { events: this.events, truncated: this.truncated }
  }
}

// =============================================================================
// buildStateAt — fold events[0..idx) into a renderable scene state
// =============================================================================

export interface RingBuildState {
  /** Completed and in-progress ring orders per channel. */
  rings: Map<number, string[]>
  /** Channels whose rings have closed. */
  closed: Set<number>
  currentChannel: number | null
  /** Head of the in-progress ring (the GPU the search sits on). */
  currentGpu: string | null
  /** Last consider event ≤ idx (candidate halos). */
  lastConsider: Extract<RingBuildEvent, { kind: 'consider' }> | null
  /** Remaining bandwidth per directed pair "from>to" touched so far. */
  budgets: Map<string, number>
  /** The event at idx-1 (drives the narration line). */
  lastEvent: RingBuildEvent | null
  speed: number
  /** Inter-node: the NET each channel entered from / exits to (RecNet). */
  netIn: Map<number, string>
  netOut: Map<number, string>
  /** Latest search attempt (constraint set + outcome) — drives the eval HUD. */
  lastAttempt: Extract<RingBuildEvent, { kind: 'attempt' }> | null
  /** Incumbent best-so-far (kept attempts only). */
  best: { nChannels: number; speed: number } | null
  /** Accepted-solution event, once the ladder concludes. */
  accepted: Extract<RingBuildEvent, { kind: 'accepted' }> | null
  phaseLabel: string
}

export function buildStateAt(trace: RingBuildTrace, idx: number): RingBuildState {
  const state: RingBuildState = {
    rings: new Map(),
    closed: new Set(),
    currentChannel: null,
    currentGpu: null,
    lastConsider: null,
    budgets: new Map(),
    lastEvent: null,
    speed: 0,
    netIn: new Map(),
    netOut: new Map(),
    lastAttempt: null,
    best: null,
    accepted: null,
    phaseLabel: '',
  }
  const n = Math.max(0, Math.min(idx, trace.events.length))
  for (let i = 0; i < n; i++) {
    const e = trace.events[i]
    switch (e.kind) {
      case 'speed':
        state.speed = e.speed
        break
      case 'phase':
        state.phaseLabel = e.label
        break
      case 'attempt':
        state.lastAttempt = e
        if (e.kept) state.best = { nChannels: e.found, speed: e.speed }
        break
      case 'accepted':
        state.accepted = e
        break
      case 'channel-start':
        state.rings.set(e.channel, [e.startGpu])
        state.currentChannel = e.channel
        state.currentGpu = e.startGpu
        state.lastConsider = null
        state.speed = e.speed
        if (e.net) state.netIn.set(e.channel, e.net)
        break
      case 'consider':
        state.lastConsider = e
        break
      case 'hop': {
        const ring = state.rings.get(e.channel) ?? []
        ring.push(e.to)
        state.rings.set(e.channel, ring)
        state.currentGpu = e.to
        state.budgets.set(`${e.from}>${e.to}`, e.after)
        state.lastConsider = null
        break
      }
      case 'backtrack': {
        const ring = state.rings.get(e.channel) ?? []
        if (ring.length > 1) ring.pop()
        state.currentGpu = e.backTo
        state.budgets.delete(`${e.backTo}>${e.at}`) // consumption was restored
        state.lastConsider = null
        break
      }
      case 'close':
        state.budgets.set(`${e.from}>${e.to}`, (state.budgets.get(`${e.from}>${e.to}`) ?? 0))
        state.closed.add(e.channel)
        state.lastConsider = null
        break
      case 'channel-done':
        state.rings.set(e.channel, [...e.order])
        state.closed.add(e.channel)
        state.currentGpu = null
        if (e.netIn) state.netIn.set(e.channel, e.netIn)
        if (e.netOut) state.netOut.set(e.channel, e.netOut)
        break
      default:
        break
    }
    state.lastEvent = e
  }
  return state
}
