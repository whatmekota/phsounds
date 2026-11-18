import type { PluginContext } from '../src/types.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACHIEVEMENTS, REPORT_EVERY, Tally } from '../src/achievements.ts'

describe('achievements', () => {
  it('have ids playhound takes, and counted ones a target', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const a of ACHIEVEMENTS)
      assert.match(a.id, /^[a-z0-9-]+$/)
    assert.ok(ACHIEVEMENTS.find(a => a.id === 'plaps-1000')?.target === 1000)
  })

  it('count the slaps heard on top of the ones before, and report now and then', async () => {
    const stored: Record<string, unknown> = { slapsHeard: 990 }
    const progress: number[] = []
    const unlocked: string[] = []
    const ctx = {
      storage: {
        get: async (k: string) => stored[k],
        set: async (k: string, v: unknown) => void (stored[k] = v),
      },
      achievements: {
        define: () => {},
        unlock: (id: string) => void unlocked.push(id),
        progress: (id: string, n: number) => void (id === 'plaps-1000' && progress.push(n)),
      },
    } as unknown as PluginContext
    const tally = new Tally(ctx)
    // Slaps heard before the count so far is read aren't lost.
    tally.slap()
    await tally.start()
    assert.equal(tally.count, 991)
    assert.deepEqual(unlocked, ['first-plap'])
    for (let i = 0; i < REPORT_EVERY; i++)
      tally.slap()
    assert.deepEqual(progress, [991, 1016])
    assert.equal(stored.slapsHeard, 1016)
    assert.deepEqual(unlocked, ['first-plap'])
  })
})
