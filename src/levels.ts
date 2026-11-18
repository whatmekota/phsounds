import type { Mix } from './sets'

/**
 * How loud and how bright, from how the stroke moves: plain numbers, for
 * index.ts to hand the engine.
 *
 * Speeds are funscript units a second as they play (0–100 is the whole
 * range, so a full stroke in half a second is 200), at the playback speed.
 */

export const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0)

export function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp01((x - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}

/** Stroke speeds from which a hit starts to count, and at which it is full. */
export const SLOW_SPEED = 40
export const FAST_SPEED = 450
/** Below this a hit isn't worth a sound: a twitch, a settle. */
export const MIN_HIT = 0.05

/**
 * How hard a stroke lands, 0–1: faster and deeper is harder. A slow deep
 * stroke is a soft thud (about 0.2), a quick short one barely more, a fast
 * full one close to 1.
 */
export function strokeStrength(speed: number, amp: number): number {
  if (!(speed > 0) || !(amp > 0))
    return 0
  const s = smoothstep(SLOW_SPEED, FAST_SPEED, speed)
  const d = smoothstep(4, 70, amp)
  return clamp01((0.15 + 0.85 * s) * (0.35 + 0.65 * d))
}

/** 0–1: how much is moving, for the wet loop, from the speed right now. */
export function wetLevel(speed: number): number {
  return smoothstep(15, 380, Math.abs(speed))
}

/**
 * The Wet or slap setting, 0 (only wet) to 1 (only slap), as gains: at 0.5
 * both are as the set has them; toward either end one fades out and the
 * other comes up a little. With nothing wet to play it's 1: the slaps alone.
 */
export function balanceGains(b: number): { slap: number, wet: number } {
  const x = clamp01(b)
  return {
    slap: x <= 0.5 ? 2 * x : 1 + (x - 0.5) * 0.6,
    wet: x >= 0.5 ? 2 * (1 - x) : 1 + (0.5 - x) * 0.6,
  }
}

/** The intensity knob (or an edge backing off): never quite silent, so a low knob is quiet rather than dead. */
export function knobWeight(level: number): number {
  return 0.25 + 0.75 * clamp01(level)
}

/**
 * What one slap at the bottom plays: its gain, and the low-pass on it. The
 * takes are already levelled (own.ts), so a gain of 1 is a firm slap.
 */
export interface HitPlan {
  /** The stroke's strength, 0–1: takes levelled as a group pick a harder one for a harder stroke. */
  k: number
  slap: number
  lowpassHz: number
}

/**
 * The slap for a stroke of strength `k` (0–1) and depth `amp` (0–100):
 * louder and brighter the harder, and fuller for a deep stroke.
 */
export function planHit(mix: Mix, k: number, amp: number, bal: { slap: number }): HitPlan | null {
  if (!(k >= MIN_HIT))
    return null
  const g = k ** 1.2 * mix.level
  const deep = 0.35 + 0.65 * smoothstep(20, 90, amp)
  return {
    k,
    slap: g * bal.slap * (1 + 0.5 * deep),
    lowpassHz: mix.softHz * (mix.hardHz / mix.softHz) ** k,
  }
}

/** The pop at the top, for an upstroke of strength `k`. */
export function planPop(mix: Mix, k: number, bal: { wet: number }): number {
  if (!(k >= MIN_HIT))
    return 0
  return k ** 1.3 * bal.wet * mix.level
}

/** The wet loop's gain at wet level `w`. */
export function loopGain(mix: Mix, w: number, bal: { wet: number }): number {
  return w ** 1.1 * bal.wet * mix.level
}
