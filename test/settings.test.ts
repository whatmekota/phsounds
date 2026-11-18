import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { balanceGains, planHit, strokeStrength } from '../src/levels.ts'
import { cleanIndex, trim } from '../src/own.ts'
import { MIX } from '../src/sets.ts'
import { fields, heldBy, listHint, readConfig } from '../src/settings.ts'

const SETS = ['wet-plaps', 'other']
const state = { key: 'Shift+U', own: { slap: ['a.wav', 'b.wav'], wet: [], moan: [] }, sets: [{ id: 'wet-plaps', name: 'Wet plaps' }], wet: false, pops: false }

describe('settings', () => {
  it('reads defaults from nothing, and clamps what makes no sense', () => {
    const d = readConfig({}, SETS)
    assert.equal(d.enabled, true)
    assert.equal(d.volume, 0.7)
    assert.equal(d.set, 'wet-plaps')
    assert.equal(d.balance, 0.5)
    assert.equal(d.onlySilent, true)
    // A set from before (the made ones are gone) falls back to the first.
    const odd = readConfig({ enabled: false, volume: 400, set: 'recorded', balance: -3, nudge: 9000, moanEvery: 'always', tops: 0 }, SETS)
    assert.equal(odd.enabled, false)
    assert.equal(odd.volume, 1)
    assert.equal(odd.set, 'wet-plaps')
    assert.equal(odd.balance, 0)
    assert.equal(odd.nudgeMs, 300)
    assert.equal(odd.moanEvery, 'some')
    assert.equal(odd.tops, true)
    assert.equal(readConfig({ set: 'other' }, SETS).set, 'other')
  })

  it('builds a form with unique keys, shows what you added, and hides what has nothing to do', () => {
    const f = fields(state, {})
    const keys = f.map(x => x.key).filter(Boolean)
    assert.equal(new Set(keys).size, keys.length)
    const addSlap = f.find(x => x.key === 'addSlap')
    assert.match(String(addSlap?.label), /2 sounds: a\.wav, b\.wav/)
    // An Add button opens the file dialog itself, for several sounds at once.
    assert.ok(addSlap?.type === 'file' && addSlap.multiple && addSlap.accept?.startsWith('audio/*'))
    assert.equal(f.find(x => x.key === 'clearWet')?.when?.({}), false)
    assert.equal(f.find(x => x.key === 'clearSlap')?.when?.({}), true)
    assert.match(listHint(['1', '2', '3', '4', '5', '6'], ''), /and 2 more/)
    // One set, no wet loop, no pops: no set picker, no Wet or slap, no pop switch.
    for (const key of ['set', 'balance', 'tops'])
      assert.equal(f.find(x => x.key === key)?.when?.({}), false, key)
    const more = fields({ ...state, sets: [...state.sets, { id: 'other', name: 'Other' }], wet: true, pops: true }, {})
    for (const key of ['set', 'balance', 'tops'])
      assert.equal(more.find(x => x.key === key)?.when?.({}), true, key)
  })

  it('keeps quiet while what plays has sound, or might, or plays in a headset', () => {
    const s = { playing: true, external: false, audible: true as boolean | null }
    assert.equal(heldBy(s), 'sound')
    // Not known yet (a video just started) counts as sound.
    assert.equal(heldBy({ ...s, audible: null }), 'sound')
    assert.equal(heldBy({ ...s, audible: false }), null)
    assert.equal(heldBy({ ...s, external: true, audible: false }), 'headset')
    assert.equal(heldBy({ playing: false, external: true, audible: null }), null)
  })

  it('keeps only sound entries that make sense', () => {
    const list = cleanIndex([{ id: 'a', slot: 'slap', name: 'x.wav', size: 10 }, { id: 'a', slot: 'wet', name: 'dupe' }, { id: 'b', slot: 'drum' }, null, 'x', { id: 'c', slot: 'moan', size: -1 }])
    assert.deepEqual(list.map(e => `${e.id}:${e.slot}:${e.size}`), ['a:slap:10', 'c:moan:0'])
    assert.deepEqual(cleanIndex('nope'), [])
  })

  it('hits harder the faster and deeper, and the balance fades one side out', () => {
    assert.ok(strokeStrength(400, 100) > strokeStrength(200, 100))
    assert.ok(strokeStrength(400, 100) > strokeStrength(400, 30))
    assert.equal(strokeStrength(0, 100), 0)
    assert.deepEqual(balanceGains(0.5), { slap: 1, wet: 1 })
    assert.equal(balanceGains(0).slap, 0)
    assert.equal(balanceGains(1).wet, 0)
    // A full, fast, deep stroke with the slaps alone: as loud as before the made sounds went (slap and half a thud, at 1.3).
    assert.ok(Math.abs(planHit(MIX, 1, 100, balanceGains(1))!.slap - 1.3 * 1.5) < 1e-9)
    assert.equal(planHit(MIX, 0.01, 100, balanceGains(1)), null)
  })
})

describe('your sounds', () => {
  it('skip the silence before a slap, so it lands on time', () => {
    const SR = 48000
    const x = new Float32Array(SR)
    for (let i = 0; i < 2000; i++)
      x[12_000 + i] = Math.sin(i / 3) * Math.exp(-i / 400)
    const { offset, duration } = trim(x, SR)
    assert.ok(Math.abs(offset - 12_000 / SR) < 0.003, `offset ${offset}`)
    assert.ok(duration < 0.1, `duration ${duration}`)
  })
})
