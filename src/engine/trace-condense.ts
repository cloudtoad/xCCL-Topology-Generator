import type { RingBuildEvent } from './ring-build-trace'

/**
 * Condensed playback plan for a ring-build trace.
 *
 * The trace is the faithful record — it is never edited. Condensation is a
 * TRANSPORT concern: a list of stops the player visits, chosen so each
 * distinct piece of choreography is shown once or twice and its repeats are
 * jumped over with an explicit "skipped N" label (no silent elision).
 *
 * What repeats in a real trace:
 *  - the relaxation ladder re-runs in full at every lower table speed after
 *    a solution is kept (search.cc:1246 — the descent continues because more
 *    channels × lower speed might still beat the incumbent);
 *  - channels 1..k-1 replay channel 0's greedy walk from a rotated NIC.
 */
export interface CondensedStop {
  /** store position: events[idx-1] is on screen; 0 = the "Ready" frame */
  idx: number
  /** pedagogy caption appended to the narration at this stop */
  note?: string
  /** events jumped over since the previous stop (computed, always honest) */
  skipped?: number
}

interface Block {
  start: number // index of the 'speed' event (or region start)
  end: number // exclusive
  speed: number
  hasKept: boolean
}

interface ChannelGroup {
  start: number // index of 'channel-start'
  end: number // index of 'channel-done' (inclusive)
  ordinal: number
  hasBacktrack: boolean
}

export function condenseTrace(events: RingBuildEvent[]): CondensedStop[] {
  const keep = new Map<number, string | undefined>() // event index -> note

  const acceptedAt = events.findIndex((e) => e.kind === 'accepted')

  // ---- Ladder region: split into speed blocks -------------------------------
  const ladderEnd = acceptedAt >= 0 ? acceptedAt : events.length
  const blocks: Block[] = []
  for (let i = 0; i < ladderEnd; i++) {
    const e = events[i]
    if (e.kind === 'speed') {
      if (blocks.length > 0) blocks[blocks.length - 1].end = i
      blocks.push({ start: i, end: ladderEnd, speed: e.speed, hasKept: false })
    } else if (e.kind === 'attempt' && e.kept && blocks.length > 0) {
      blocks[blocks.length - 1].hasKept = true
    } else if (blocks.length === 0) {
      keep.set(i, undefined) // pre-ladder events (phase) always shown
    }
  }

  // If the search never kept anything (fallback trace), don't guess — show all.
  const anyKept = blocks.some((b) => b.hasKept)
  if (!anyKept) {
    for (const b of blocks) for (let i = b.start; i < b.end; i++) keep.set(i, undefined)
  } else {
    let seenKept = false
    let representativeShown = false
    for (const b of blocks) {
      if (b.hasKept || !seenKept) {
        // the descent to the first kept solution IS the lesson — show in full
        for (let i = b.start; i < b.end; i++) keep.set(i, undefined)
        if (b.hasKept) seenKept = true
      } else if (!representativeShown) {
        // one lower-speed block in brief: speed, first "found but discarded", last attempt
        representativeShown = true
        keep.set(b.start, 'one lower-speed block shown in brief — the same relaxation ladder re-runs at every remaining table speed')
        const firstFound = findIndexIn(events, b.start, b.end, (e) => e.kind === 'attempt' && e.found > 0)
        if (firstFound >= 0) {
          const a = events[firstFound] as Extract<RingBuildEvent, { kind: 'attempt' }>
          keep.set(firstFound, `solutions exist down here too — ${a.found} ch × ${a.speed} GB/s loses to the incumbent on nCh × bw`)
        }
        const lastAttempt = findLastIndexIn(events, b.start, b.end, (e) => e.kind === 'attempt')
        if (lastAttempt >= 0) keep.set(lastAttempt, `ladder exhausted at ${b.speed} GB/s — nothing kept`)
      } else {
        // remaining all-discarded blocks: one stop each, at the block's last attempt
        const lastAttempt = findLastIndexIn(events, b.start, b.end, (e) => e.kind === 'attempt')
        const at = lastAttempt >= 0 ? lastAttempt : b.end - 1
        keep.set(at, `whole ladder re-ran at ${b.speed} GB/s — nothing beat the incumbent`)
      }
    }
  }

  // ---- Construction region: group by channel --------------------------------
  const groups: ChannelGroup[] = []
  let cur: ChannelGroup | null = null
  for (let i = acceptedAt >= 0 ? acceptedAt : 0; i < events.length; i++) {
    const e = events[i]
    if (e.kind === 'channel-start') {
      cur = { start: i, end: i, ordinal: groups.length, hasBacktrack: false }
      groups.push(cur)
    } else if (cur && i > cur.start) {
      if (e.kind === 'backtrack') cur.hasBacktrack = true
      if (e.kind === 'channel-done') {
        cur.end = i
        cur = null
      }
    }
    // events outside any channel group (accepted, phase, dup, improve, done): keep
    if (!cur || e.kind === 'channel-start') {
      if (e.kind !== 'channel-start') keep.set(i, undefined)
    }
  }

  for (const g of groups) {
    if (g.ordinal === 0 || g.hasBacktrack) {
      // first walk in full; and never hide a backtrack — dead ends are lessons
      for (let i = g.start; i <= g.end; i++) keep.set(i, undefined)
    } else if (g.ordinal === 1) {
      // second walk in brief: start, first consider+hop, close, done
      keep.set(g.start, 'second walk shown in brief — same greedy rules from a rotated rail')
      const c = findIndexIn(events, g.start, g.end + 1, (e) => e.kind === 'consider')
      if (c >= 0) keep.set(c, undefined)
      const h = findIndexIn(events, g.start, g.end + 1, (e) => e.kind === 'hop')
      if (h >= 0) keep.set(h, undefined)
      const cl = findIndexIn(events, g.start, g.end + 1, (e) => e.kind === 'close')
      if (cl >= 0) keep.set(cl, undefined)
      keep.set(g.end, 'note the different order — sameChannels was sacrificed, each ring reorders freely')
    } else {
      // remaining walks: land on the finished ring only
      const done = events[g.end] as Extract<RingBuildEvent, { kind: 'channel-done' }>
      const entry = done.netIn ? done.netIn.replace('net-', 'NET ') : `channel ${done.channel}`
      keep.set(g.end, `channel ${done.channel} replayed the same walk from ${entry}`)
    }
  }

  // ---- Emit stops (idx = events applied = event index + 1), honest skips ----
  const stops: CondensedStop[] = [{ idx: 0 }]
  const indices = [...keep.keys()].sort((a, b) => a - b)
  for (const i of indices) {
    const prev = stops[stops.length - 1].idx
    const skipped = i + 1 - prev - 1
    stops.push({ idx: i + 1, note: keep.get(i), ...(skipped > 0 ? { skipped } : {}) })
  }
  return stops
}

function findIndexIn(events: RingBuildEvent[], start: number, end: number, pred: (e: RingBuildEvent) => boolean): number {
  for (let i = start; i < end; i++) if (pred(events[i])) return i
  return -1
}

function findLastIndexIn(events: RingBuildEvent[], start: number, end: number, pred: (e: RingBuildEvent) => boolean): number {
  for (let i = end - 1; i >= start; i--) if (pred(events[i])) return i
  return -1
}
