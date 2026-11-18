import type { PluginAchievement, PluginContext } from './types'

/**
 * A few achievements of its own, in Stats → Achievements, from real use:
 * slaps heard while it follows a stroke (Hear them doesn't count), a sound
 * of your own added, one of your moans at a peak. playhound keeps only the
 * count last reported, so the slaps heard are kept here too.
 */
export const ACHIEVEMENTS: PluginAchievement[] = [
  { id: 'first-plap', title: 'First plap', description: 'Hear a slap in time with the stroke', icon: '👏' },
  { id: 'plaps-1000', title: 'Wet work', description: 'Hear 1,000 slaps', icon: '💦', target: 1000, tier: 2 },
  { id: 'plaps-10000', title: 'Soaked', description: 'Hear 10,000 slaps', icon: '🌊', target: 10_000, tier: 3 },
  { id: 'own-sound', title: 'Bring your own', description: 'Add a sound of your own', icon: '🎙️' },
  { id: 'moan', title: 'At the peak', description: 'Hear a moan after a stretch of hard strokes', icon: '🥵', hidden: true, tier: 2 },
]

/** The counts are reported (and kept) after this many more slaps, not on every one. */
export const REPORT_EVERY = 25
const KEY = 'slapsHeard'

/** Earns one; an achievement that can't be had is no reason to stop the sound. */
export function earn(ctx: PluginContext, id: string): void {
  try {
    ctx.achievements.unlock(id)
  }
  catch {}
}

/** Slaps heard, across sessions. */
export class Tally {
  count = 0
  private loaded = false
  private kept = 0
  private first = true

  constructor(private readonly ctx: PluginContext) {}

  /** Declares the achievements and reads the count so far. */
  async start(): Promise<void> {
    try {
      this.ctx.achievements.define(ACHIEVEMENTS)
    }
    catch {}
    try {
      const n = await this.ctx.storage.get(KEY)
      if (typeof n === 'number' && Number.isFinite(n) && n > 0)
        this.count += Math.floor(n)
    }
    catch {}
    this.loaded = true
    this.report()
  }

  /** One slap heard. */
  slap(): void {
    this.count++
    if (this.first) {
      this.first = false
      earn(this.ctx, 'first-plap')
    }
    if (this.count - this.kept >= REPORT_EVERY)
      this.report()
  }

  /** Tells playhound the count, and keeps it. Not before the count so far is read, or it would be lost. */
  report(): void {
    if (!this.loaded || this.count === this.kept)
      return
    this.kept = this.count
    try {
      this.ctx.achievements.progress('plaps-1000', this.count)
      this.ctx.achievements.progress('plaps-10000', this.count)
    }
    catch {}
    void this.ctx.storage.set(KEY, this.count).catch(() => {})
  }
}
