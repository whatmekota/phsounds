import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StreamTurns } from '../src/follow.ts'
import { cleanActions, positionAt, turningPoints } from '../src/turns.ts'

const kinds = (s: { kind: string, at: number }[]) => s.map(t => `${t.kind[0]}${t.at}`).join(' ')

describe('turns in a script', () => {
  it('finds each top and bottom, with the speed and depth of the stroke into it', () => {
    const a = cleanActions([{ at: 0, pos: 0 }, { at: 250, pos: 100 }, { at: 500, pos: 0 }, { at: 750, pos: 100 }, { at: 1000, pos: 0 }])
    const t = turningPoints(a)
    assert.equal(kinds(t), 'b0 t250 b500 t750 b1000')
    assert.equal(t[2].speed, 400) // 100 units in 250 ms
    assert.equal(t[2].amp, 100)
  })

  it('lands where the stroke arrives, and ignores small wiggles', () => {
    const a = cleanActions([{ at: 0, pos: 90 }, { at: 300, pos: 10 }, { at: 600, pos: 10 }, { at: 900, pos: 90 }, { at: 950, pos: 87 }, { at: 1000, pos: 90 }, { at: 1300, pos: 10 }])
    assert.equal(kinds(turningPoints(a)), 't0 b300 t900 b1300')
  })

  it('says where the script is between its points', () => {
    const a = cleanActions([{ at: 0, pos: 0 }, { at: 100, pos: 100 }])
    assert.equal(positionAt(a, 50), 50)
    assert.equal(positionAt(a, -10), 0)
    assert.equal(positionAt(a, 500), 100)
  })
})

describe('turns in a stream of positions', () => {
  it('finds the same turns as the script it was sampled from, a little late', () => {
    // 120 strokes a minute, sampled every 16 ms as the device is sent it.
    const acts = cleanActions(Array.from({ length: 9 }, (_, i) => ({ at: i * 250, pos: i % 2 ? 100 : 0 })))
    const s = new StreamTurns(4)
    const got: { kind: string, at: number, heardAt: number }[] = []
    for (let t = 0; t <= 2000; t += 16) {
      const turn = s.push(positionAt(acts, t), t)
      if (turn)
        got.push({ kind: turn.kind, at: turn.at, heardAt: t })
    }
    // The first turn isn't a stroke yet; then every turn but the last, which hasn't turned back.
    assert.deepEqual(got.map(g => g.kind), ['top', 'bottom', 'top', 'bottom', 'top', 'bottom', 'top'])
    for (const g of got) {
      const real = Math.round(g.at / 250) * 250
      assert.ok(Math.abs(g.at - real) <= 16, `turn dated ${g.at}, really ${real}`)
      // Confirmed within a few samples of the real turn.
      assert.ok(g.heardAt - real <= 32, `confirmed ${g.heardAt - real} ms late`)
    }
    assert.ok(s.speed > 300 && s.speed < 500, `speed ${s.speed}`)
  })

  it('dates each position where it is meant, so a brisk turn is known about when it is due', () => {
    // A sine at 120 strokes a minute, sent every 16 ms for 40 ms ahead, as the generator does.
    const s = new StreamTurns(4)
    const ahead: number[] = []
    for (let t = 0; t <= 3000; t += 16) {
      const turn = s.push(50 - 50 * Math.cos((2 * Math.PI * t) / 500), t + 40)
      if (turn) {
        // Really at the extreme 40 ms after it was sent (tops at 250, 750…; bottoms at 500, 1000…).
        const real = Math.round((turn.at - 40) / 250) * 250 + 40
        assert.ok(Math.abs(turn.at - real) <= 8, `turn dated ${turn.at}, really ${real}`)
        ahead.push(turn.at - t)
      }
    }
    assert.ok(ahead.length >= 10)
    // Found within a frame of when the device is meant to be there, so it can play then.
    assert.ok(ahead.every(ms => ms > -16), `ahead by ${ahead.join(', ')} ms`)
  })

  it('stays quiet for a still or shaky stroke', () => {
    const s = new StreamTurns(4)
    let n = 0
    for (let t = 0; t < 2000; t += 16)
      n += s.push(50 + (t % 64 === 0 ? 1.5 : 0), t) ? 1 : 0
    assert.equal(n, 0)
  })
})
