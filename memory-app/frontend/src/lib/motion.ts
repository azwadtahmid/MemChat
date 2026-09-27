// Motion tokens for UI state transitions (motion/react). Scenery and ambient
// animation live in CSS, not here.
//
// The app is wrapped in <MotionConfig reducedMotion="user">, so under
// prefers-reduced-motion Motion drops every transform and keeps opacity:
// entrances become plain fades, exactly as the design asks.

/** The staggered rise for cards and entries. */
export const RISE_EASE = [0.22, 1, 0.36, 1] as const
export const RISE = { duration: 0.72, ease: RISE_EASE }
export const STAGGER = 0.08
const MAX_STEPS = 10 // long lists stop staggering after ten, so nothing waits seconds

/** Per-section delay tokens, so groups offset from each other. */
export const SECTION_DELAY = {
  notes: 0.12,
  diary: 0.08,
  diaryMonth: 0.14, // added per month group
  trash: 0.08,
} as const

/** Exits are faster than entrances. */
export const EXIT = { duration: 0.24, ease: [0.4, 0, 1, 1] as const }

/** UI state transitions (picker, plus, panel): under 300ms, eased. */
export const UI = { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] as const }

export function riseDelay(index: number, section: number): number {
  return section + Math.min(index, MAX_STEPS) * STAGGER
}

/** Props for an item that rises in, and sinks out when removed. */
export function riseProps(index: number, section: number) {
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: { ...RISE, delay: riseDelay(index, section) } },
    exit: { opacity: 0, y: 8, scale: 0.97, transition: EXIT },
  }
}
