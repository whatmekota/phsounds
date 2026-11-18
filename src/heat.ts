/**
 * When to moan: at the peaks. Heat is how hard it has been going lately,
 * each stroke's strength (0–1) folded in, cooling off over seconds when it
 * slows or stops. A moan comes on a hard stroke while the heat is high,
 * and not too soon after the last one: rarely, sometimes or often.
 */
export class Heat {
  value = 0
  private at = 0
  private lastMoan = Number.NEGATIVE_INFINITY

  /** How long the heat takes to follow (ms): about the last few seconds count. */
  constructor(private readonly tauMs = 5000) {}

  /** Cooling since the last call, to wall ms `now`. */
  private cool(now: number): void {
    const dt = now - this.at
    if (dt > 0)
      this.value *= Math.exp(-dt / (this.tauMs * 2))
    this.at = now
  }

  /** A stroke of strength `k` at wall ms `now`. */
  stroke(k: number, now: number, gapMs: number): void {
    this.cool(now)
    // Each stroke pulls it toward its own strength, faster when strokes come fast.
    const pull = 1 - Math.exp(-Math.max(80, gapMs) / this.tauMs)
    this.value += (Math.min(1, Math.max(0, k)) - this.value) * pull
  }

  /**
   * Whether this stroke (strength `k`, at `now`) gets a moan: hot enough,
   * hard enough, the gap since the last one past, and the dice say so.
   */
  moan(k: number, now: number, gapMs: number, chance: number, roll: number): boolean {
    this.cool(now)
    if (this.value < 0.5 || k < 0.55 || now - this.lastMoan < gapMs || roll >= chance)
      return false
    this.lastMoan = now
    return true
  }

  reset(): void {
    this.value = 0
  }
}
