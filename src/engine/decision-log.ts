import type { DecisionEntry, DecisionPhase } from './types'

export class DecisionLog {
  private entries: DecisionEntry[] = []
  private stepCounter = 0

  emit(
    phase: DecisionPhase,
    action: string,
    reason: string,
    sourceRef: string,
    alternatives: string[] = [],
    data?: Record<string, unknown>,
  ): void {
    this.entries.push({
      step: this.stepCounter++,
      phase,
      action,
      reason,
      alternatives,
      sourceRef,
      data,
      timestamp: Date.now(),
    })
  }

  getEntries(): DecisionEntry[] {
    return [...this.entries]
  }

  getEntriesByPhase(phase: DecisionPhase): DecisionEntry[] {
    return this.entries.filter((e) => e.phase === phase)
  }

  clear(): void {
    this.entries = []
    this.stepCounter = 0
  }

  get length(): number {
    return this.entries.length
  }
}
