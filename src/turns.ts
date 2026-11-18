/**
 * Strokes out of a funscript: the points where the stroke turns round.
 * The same reading of a script as phfx's and phbeatbar's, so the plugins
 * agree on where a stroke ends.
 *
 * A bottom turn is where a downstroke ends, a top turn where an upstroke
 * ends. Wiggles smaller than `minMove` (funscript units, 0–100) don't count
 * as a turn, so a shaky line between two real reversals stays one stroke.
 */

export interface Action { at: number, pos: number }

export interface Turn {
  /** Script time, ms. */
  at: number
  /** 0–100. */
  pos: number
  kind: 'top' | 'bottom'
  /** How far the stroke into this turn travelled, 0–100. */
  amp: number
  /** How fast it went, funscript units a second (the heatmap's scale). */
  speed: number
}

/** Sorted by time, finite, pos clamped to 0–100; of two points at the same ms the later one wins. */
export function cleanActions(actions: readonly { at: number, pos: number }[]): Action[] {
  const ok = actions
    .filter(a => a && Number.isFinite(a.at) && Number.isFinite(a.pos))
    .map(a => ({ at: a.at, pos: Math.min(100, Math.max(0, a.pos)) }))
    .sort((a, b) => a.at - b.at)
  const out: Action[] = []
  for (const a of ok) {
    if (out.length && out[out.length - 1].at === a.at)
      out[out.length - 1] = a
    else
      out.push(a)
  }
  return out
}

/** The smallest move that counts as a turn, funscript units: below it a line is just shaky. */
export const MIN_MOVE = 5

/**
 * The turn detection's threshold for "Skip strokes shorter than" (0–100 of
 * the range): a stroke shorter than that is no stroke at all, so a flick or
 * bounce is absorbed into the stroke around it and tops and bottoms keep
 * alternating (filtering hits afterwards would leave two bottoms in a row).
 */
export function minMoveFor(skipShorterThan: number): number {
  return Math.max(MIN_MOVE, Number.isFinite(skipShorterThan) ? skipShorterThan : 0)
}

/**
 * The turning points of a cleaned script, in time order, alternating top and
 * bottom. A turn is placed where the stroke arrives at its extreme (the first
 * point of a flat stretch), which is when the hit should land.
 */
export function turningPoints(actions: readonly Action[], minMove = MIN_MOVE): Turn[] {
  const turns: Turn[] = []
  if (actions.length < 2)
    return turns
  let dir = 0
  // Before the direction is known: the lowest and highest point so far.
  let lo = actions[0]
  let hi = actions[0]
  let cand = actions[0]
  const push = (p: Action, kind: Turn['kind']) => {
    const prev = turns[turns.length - 1]
    const amp = prev ? Math.abs(p.pos - prev.pos) : 0
    const dt = prev ? p.at - prev.at : 0
    turns.push({ at: p.at, pos: p.pos, kind, amp, speed: dt > 0 ? (amp / dt) * 1000 : 0 })
  }
  for (let i = 1; i < actions.length; i++) {
    const p = actions[i]
    if (dir === 0) {
      if (p.pos < lo.pos)
        lo = p
      if (p.pos > hi.pos)
        hi = p
      if (hi.pos - lo.pos < minMove)
        continue
      // Whichever extreme came first is where the stroke started.
      if (lo.at <= hi.at) {
        push(lo, 'bottom')
        dir = 1
        cand = hi
      }
      else {
        push(hi, 'top')
        dir = -1
        cand = lo
      }
      continue
    }
    if (dir > 0) {
      if (p.pos > cand.pos) {
        cand = p
      }
      else if (cand.pos - p.pos >= minMove) {
        push(cand, 'top')
        dir = -1
        cand = p
      }
    }
    else {
      if (p.pos < cand.pos) {
        cand = p
      }
      else if (p.pos - cand.pos >= minMove) {
        push(cand, 'bottom')
        dir = 1
        cand = p
      }
    }
  }
  if (dir !== 0)
    push(cand, dir > 0 ? 'top' : 'bottom')
  return turns
}

/** Index of the first item at or after `t` (items.length if none); items sorted by `at`. */
export function firstAtOrAfter(items: readonly { at: number }[], t: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].at < t)
      lo = mid + 1
    else
      hi = mid
  }
  return lo
}

/**
 * How fast the script moves at `t`, funscript units a second: the slope of
 * the segment `t` falls in. 0 before the first point, after the last, and
 * on a flat stretch.
 */
export function speedAt(actions: readonly Action[], t: number): number {
  const i = firstAtOrAfter(actions, t)
  if (i === 0 || i >= actions.length)
    return 0
  const a = actions[i - 1]
  const b = actions[i]
  const dt = b.at - a.at
  return dt > 0 ? (Math.abs(b.pos - a.pos) / dt) * 1000 : 0
}

/** Where the script is at `t`, 0–100, between its points. */
export function positionAt(actions: readonly Action[], t: number): number {
  if (!actions.length)
    return 50
  const i = firstAtOrAfter(actions, t)
  if (i === 0)
    return actions[0].pos
  if (i >= actions.length)
    return actions[actions.length - 1].pos
  const a = actions[i - 1]
  const b = actions[i]
  return b.at > a.at ? a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at) : b.pos
}
