import { useEffect, useRef, useState } from 'react'

/**
 * Tiny auto-advancing step driver for the walkthrough figures.
 * Starts playing on mount, pauses at the final step.
 */
export function useStepper(totalSteps: number, msPerStep: number) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= totalSteps) {
          setPlaying(false)
          return totalSteps
        }
        return s + 1
      })
    }, msPerStep)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [playing, totalSteps, msPerStep])

  const reset = () => {
    setStep(0)
    setPlaying(true)
  }

  return { step, playing, reset, setStep, setPlaying }
}

/** Shared replay button so every figure gets the same affordance. */
export function stepperLabel(step: number, total: number): string {
  return `${Math.min(step, total)}/${total}`
}
