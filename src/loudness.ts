/**
 * How loud a sound is heard: its energy through an A-weighting filter (the
 * ear's: lows count for little, 1–5 kHz for most). A short sound (under
 * ~200 ms) sounds as loud as its energy, so a hit is measured by its
 * energy, and a loop by its energy a second.
 *
 * Used to level things against each other: the built-in sets' takes to the
 * loudness each set asks for, and your own sounds to the built-in ones, so a
 * file recorded quiet or hot still sits right in the mix.
 *
 * The filter is the analogue A-weighting curve (poles at 20.6, 107.7, 737.9
 * and 12194 Hz) as first-order sections through the bilinear transform,
 * pre-warped. Plenty close for levelling.
 */

/** A first-order section: y = b0·x + b1·x₋₁ − a1·y₋₁. */
interface First { b0: number, b1: number, a1: number }

function highpass1(hz: number, sr: number): First {
  const k = Math.tan((Math.PI * Math.min(hz, sr * 0.45)) / sr)
  return { b0: 1 / (1 + k), b1: -1 / (1 + k), a1: (k - 1) / (k + 1) }
}

function lowpass1(hz: number, sr: number): First {
  const k = Math.tan((Math.PI * Math.min(hz, sr * 0.45)) / sr)
  return { b0: k / (1 + k), b1: k / (1 + k), a1: (k - 1) / (k + 1) }
}

function sections(sr: number): First[] {
  return [
    highpass1(20.6, sr),
    highpass1(20.6, sr),
    highpass1(107.7, sr),
    highpass1(737.9, sr),
    lowpass1(12194, sr),
    lowpass1(12194, sr),
  ]
}

/** Sum of squares of `x` through the A-weighting (not yet normalised). */
function weighted(x: ArrayLike<number>, sr: number): number {
  const s = sections(sr)
  const xs = new Float64Array(s.length)
  const ys = new Float64Array(s.length)
  let e = 0
  for (let i = 0; i < x.length; i++) {
    let v = x[i]
    for (let j = 0; j < s.length; j++) {
      const y = s[j].b0 * v + s[j].b1 * xs[j] - s[j].a1 * ys[j]
      xs[j] = v
      ys[j] = y
      v = y
    }
    e += v * v
  }
  return e
}

const norms = new Map<number, number>()
/** The filter's power gain at 1 kHz, so 1 kHz passes at 0 dB. */
function norm(sr: number): number {
  let n = norms.get(sr)
  if (n === undefined) {
    const len = Math.round(sr * 0.5)
    const sine = new Float64Array(len)
    for (let i = 0; i < len; i++)
      sine[i] = Math.sin((2 * Math.PI * 1000 * i) / sr)
    // The second half, past the filter's settling.
    const all = weighted(sine, sr)
    const half = weighted(sine.subarray(0, len >> 1), sr)
    n = (all - half) / (len - (len >> 1)) / 0.5
    norms.set(sr, n)
  }
  return n
}

const dB = (power: number) => 10 * Math.log10(power + 1e-15)

/**
 * A-weighted energy of a sound, dB: 0 dB is a full-scale 1 kHz sine lasting
 * a second, so a hit lands around −20 to −35.
 */
export function aEnergyDb(x: ArrayLike<number>, sr: number): number {
  return dB(weighted(x, sr) / norm(sr) / sr / 0.5)
}

/** A-weighted level of a sound that goes on (a loop), dB re a full-scale 1 kHz sine. */
export function aLevelDb(x: ArrayLike<number>, sr: number): number {
  return aEnergyDb(x, sr) - 10 * Math.log10(Math.max(1, x.length) / sr)
}

/** The gain that brings sounds measuring `dbs` (on average, by power) to `target` dB. */
export function gainTo(dbs: number[], target: number): number {
  if (!dbs.length)
    return 1
  const mean = dB(dbs.reduce((s, d) => s + 10 ** (d / 10), 0) / dbs.length)
  return 10 ** ((target - mean) / 20)
}
