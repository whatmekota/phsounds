import type { Turn } from './turns'
import { firstAtOrAfter } from './turns'

/**
 * Following the motion, three ways, best first:
 *
 * 1. **A script playing with the video.** Its turns are known ahead, so each
 *    sound is scheduled to be heard exactly when its turn is on screen. This
 *    is the script's own time at the picture (player.clock + the axis's
 *    offset), not what the device is sent: the device is sent each position
 *    early by the user's latency setting, so that it arrives with the
 *    picture; a sound that followed what's sent would come that much early.
 * 2. **The stroke generator** (motion made with no script: a pattern, the
 *    music, the phone remote, a plugin holding it). motion.readout gives its
 *    phase, so the next bottom is known a moment ahead and lands on time;
 *    that phase is what the screen draws and what the music source beats to.
 * 3. **Anything else that moves the stroke axis**, heard with motion.onAxis
 *    as each position is sent, with how far ahead it is meant (the device is
 *    told where to be in so many ms). A turn is dated where the device is
 *    meant to turn, and played then if it's seen in time: a quick, sharp
 *    stroke's is. It's only known once it has turned, though, so a slow,
 *    round stroke's comes a little late (tens of ms).
 *    The positions are the stroke as meant, 0 at the bottom, whatever the
 *    device's range and invert.
 *
 * Times: `wall` is performance.now() ms; script time is ms in the script.
 */

/** Where the script is on screen right now, and how fast it runs. */
export interface Clock {
  /** performance.now() ms. */
  wall: number
  /** Script ms on screen at `wall` (the clock plus the axis offset). */
  script: number
  /** Playback speed. */
  rate: number
}

/** When script time `at` is on screen, wall ms. */
export function wallAt(c: Clock, at: number): number {
  return c.wall + (at - c.script) / (c.rate > 0 ? c.rate : 1)
}

/** The script time on screen at wall ms `w`. */
export function scriptAt(c: Clock, w: number): number {
  return c.script + (w - c.wall) * (c.rate > 0 ? c.rate : 1)
}

/** A jump of more than this (wall ms, beyond what the clock should have moved) is a seek. */
export const JUMP_MS = 250
/** A turn whose moment passed more than this long ago is let go rather than played late. */
export const LATE_MS = 60

/**
 * Follows a script's turns against the playback clock: each tick, the
 * turns coming on screen within the next `horizon` ms, each once. A seek
 * (or going back) lets go of everything skipped, and says so, so whatever
 * was scheduled for the old place can be called off.
 */
export class ScriptFollower {
  /** Script time of the last turn handed out. */
  private done = Number.NEGATIVE_INFINITY
  private prev: Clock | null = null

  constructor(private turns: readonly Turn[]) {}

  /** New turns (the script changed): starts again from where it is. */
  setTurns(turns: readonly Turn[]): void {
    this.turns = turns
    this.prev = null
  }

  /** Paused, stopped, or nothing to follow: the next step starts fresh. */
  reset(): void {
    this.prev = null
  }

  step(c: Clock, horizon: number): { due: Turn[], jumped: boolean } {
    let jumped = false
    if (this.prev) {
      const expected = this.prev.script + (c.wall - this.prev.wall) * c.rate
      if (Math.abs(c.script - expected) > JUMP_MS * Math.max(1, c.rate)) {
        jumped = true
        this.prev = null
      }
    }
    if (!this.prev) {
      // From here on: nothing behind the playhead.
      this.done = c.script - LATE_MS * c.rate
    }
    this.prev = c
    const due: Turn[] = []
    const until = scriptAt(c, c.wall + horizon)
    const from = Math.max(this.done, c.script - LATE_MS * c.rate)
    for (let i = firstAtOrAfter(this.turns, from); i < this.turns.length; i++) {
      const t = this.turns[i]
      if (t.at <= this.done)
        continue
      if (t.at > until)
        break
      due.push(t)
    }
    if (due.length)
      this.done = due[due.length - 1].at
    return { due, jumped }
  }
}

/**
 * Follows the stroke generator's phase (0–1, 0 at the bottom): how fast it
 * goes round, and, once per stroke, when it will next be at the bottom, as
 * soon as that's within `horizon` ms. Steering and the music source bend
 * the phase now and then; the rate is smoothed over a few frames.
 */
export class PhaseFollower {
  private prevPhase: number | null = null
  private prevWall = 0
  /** Turns a ms. */
  rate = 0
  /** Strokes gone round since it started; the bottom ending stroke n is scheduled once. */
  private cycle = 0
  private scheduled = -1

  reset(): void {
    this.prevPhase = null
    this.rate = 0
  }

  /** Strokes a minute, as it goes. */
  spm(): number {
    return this.rate * 60_000
  }

  step(phase: number | null, wall: number, horizon: number): { bottom: number | null } {
    if (phase === null || !Number.isFinite(phase)) {
      this.reset()
      return { bottom: null }
    }
    if (this.prevPhase === null) {
      this.prevPhase = phase
      this.prevWall = wall
      // Just past a bottom: that one has gone by unheard; the next is due.
      this.scheduled = this.cycle
      this.cycle++
      return { bottom: null }
    }
    let d = phase - this.prevPhase
    if (d < -0.5) {
      d += 1
      this.cycle++
    }
    else if (d > 0.5) {
      // Steered back across the bottom: the stroke it ended isn't over after all, but it was heard.
      d -= 1
      this.cycle--
    }
    const dt = wall - this.prevWall
    this.prevPhase = phase
    this.prevWall = wall
    if (dt > 0 && d >= 0) {
      const inst = d / dt
      this.rate = this.rate > 0 ? this.rate * 0.7 + inst * 0.3 : inst
    }
    if (!(this.rate > 1e-6) || this.scheduled === this.cycle)
      return { bottom: null }
    const until = (1 - phase) / this.rate
    if (until > horizon)
      return { bottom: null }
    this.scheduled = this.cycle
    return { bottom: wall + until }
  }
}

/** The generator's stroke shapes (motion.readout().shape). */
export type Shape = 'sine' | 'ease' | 'pulse' | 'saw' | 'sharp'

/**
 * How fast the generator's stroke goes into the bottom, units a second,
 * from its depth (0–100), strokes a minute and shape. Every shape is at the
 * bottom at phase 0; what differs is how much of the stroke the way down
 * takes: half for most, the last quarter for a saw (a quick drop), two
 * thirds for a pulse (a slow fall).
 */
export function bottomSpeed(amp: number, spm: number, shape: Shape | undefined): number {
  const down = shape === 'saw' ? 0.25 : shape === 'pulse' ? 2 / 3 : 0.5
  return (amp * spm) / (60 * down)
}

/**
 * When a turn read off the stream is heard, wall ms: at its moment (dated
 * where the device is meant to be), moved by the nudge and, while a script
 * plays, by the device latency (what's sent runs that much ahead of the
 * picture). Never before `now`: one known late plays at once.
 */
export function streamWall(at: number, now: number, nudgeMs: number, lateMs: number): number {
  return Math.max(now, at + nudgeMs + lateMs)
}

/** A turn read off a stream of positions. */
export interface StreamTurn extends Turn {}

/**
 * Turns out of positions as they come (motion.onAxis): the same reading as
 * turningPoints over a script, but online. Each position is dated when it's
 * meant to be there. A turn is confirmed once the stroke has come back
 * `minMove` (0–100) from its extreme, and is dated at the extreme. `speed`
 * is how fast it moves right now, units a second, smoothed.
 */
export class StreamTurns {
  private dir = 0
  private cand: { at: number, pos: number } | null = null
  private last: { at: number, pos: number } | null = null
  private lo: { at: number, pos: number } | null = null
  private hi: { at: number, pos: number } | null = null
  private prev: { at: number, pos: number } | null = null
  /** Units a second, smoothed. */
  speed = 0
  /** 0–100, as last read. */
  pos = 0

  constructor(private minMove = 4, private smoothMs = 60) {}

  reset(): void {
    this.dir = 0
    this.cand = this.last = this.lo = this.hi = this.prev = null
    this.speed = 0
  }

  /** A position (0–100), meant to be there at wall ms `at`. A turn, if this one confirms one. */
  push(pos: number, at: number): StreamTurn | null {
    if (!Number.isFinite(pos) || !Number.isFinite(at))
      return null
    this.pos = pos
    const p = { at, pos }
    if (this.prev) {
      const dt = at - this.prev.at
      // A gap (a stall, a hidden window) is no speed at all.
      if (dt > 0 && dt < 500) {
        const inst = (Math.abs(pos - this.prev.pos) / dt) * 1000
        this.speed += (inst - this.speed) * (1 - Math.exp(-dt / this.smoothMs))
      }
      else if (dt >= 500) {
        this.speed = 0
      }
    }
    this.prev = p
    const turn = (q: { at: number, pos: number }, kind: Turn['kind']): StreamTurn => {
      const prev = this.last
      const amp = prev ? Math.abs(q.pos - prev.pos) : 0
      const dt = prev ? q.at - prev.at : 0
      this.last = q
      return { at: q.at, pos: q.pos, kind, amp, speed: dt > 0 ? (amp / dt) * 1000 : 0 }
    }
    if (this.dir === 0) {
      if (!this.lo || pos < this.lo.pos)
        this.lo = p
      if (!this.hi || pos > this.hi.pos)
        this.hi = p
      if (this.hi.pos - this.lo.pos < this.minMove)
        return null
      if (this.lo.at <= this.hi.at) {
        this.dir = 1
        this.cand = this.hi
        this.last = this.lo
      }
      else {
        this.dir = -1
        this.cand = this.lo
        this.last = this.hi
      }
      return null
    }
    const c = this.cand!
    if (this.dir > 0) {
      if (pos > c.pos) {
        this.cand = p
      }
      else if (c.pos - pos >= this.minMove) {
        this.dir = -1
        this.cand = p
        return turn(c, 'top')
      }
    }
    else {
      if (pos < c.pos) {
        this.cand = p
      }
      else if (pos - c.pos >= this.minMove) {
        this.dir = 1
        this.cand = p
        return turn(c, 'bottom')
      }
    }
    return null
  }
}

/**
 * When a sound must start on the audio context's clock to be heard at wall
 * ms `wall`. The context's own output timestamp says which of its moments
 * is coming out of the speakers when, so the speakers' delay is already in
 * it; without one, the reported output latency is taken off by hand.
 */
export function contextTimeFor(
  wall: number,
  now: { perf: number, currentTime: number, outputLatency: number },
  stamp: { contextTime: number, performanceTime: number } | null,
): number {
  const byHand = now.currentTime + (wall - now.perf) / 1000 - now.outputLatency
  if (stamp && stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime)) {
    const byStamp = stamp.contextTime + (wall - stamp.performanceTime) / 1000
    // A stamp from before a suspend, or plain wrong, is far off: don't trust it then.
    if (Math.abs(byStamp - byHand) < 0.3)
      return byStamp
  }
  return byHand
}
