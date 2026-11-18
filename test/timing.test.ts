import type { Turn } from '../src/turns.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bottomSpeed, contextTimeFor, LATE_MS, PhaseFollower, ScriptFollower, scriptAt, streamWall, wallAt } from '../src/follow.ts'

const turn = (at: number, kind: Turn['kind'] = 'bottom'): Turn => ({ at, pos: 0, kind, amp: 100, speed: 400 })

describe('the script against the picture', () => {
  it('maps script time to when it is on screen, at any speed', () => {
    const c = { wall: 1000, script: 5000, rate: 2 }
    assert.equal(wallAt(c, 5400), 1200)
    assert.equal(scriptAt(c, 1200), 5400)
  })

  it('hands out each turn once, as it comes within the horizon', () => {
    const f = new ScriptFollower([turn(1000), turn(1250, 'top'), turn(1500), turn(1750, 'top')])
    assert.deepEqual(f.step({ wall: 0, script: 900, rate: 1 }, 120).due.map(t => t.at), [1000])
    assert.deepEqual(f.step({ wall: 15, script: 915, rate: 1 }, 120).due.map(t => t.at), [])
    assert.deepEqual(f.step({ wall: 240, script: 1140, rate: 1 }, 120).due.map(t => t.at), [1250])
    // At double speed the horizon covers twice the script.
    assert.deepEqual(f.step({ wall: 300, script: 1260, rate: 2 }, 120).due.map(t => t.at), [1500])
  })

  it('lets go of what a seek skips, and says it jumped', () => {
    const f = new ScriptFollower([turn(1000), turn(1500), turn(9000), turn(9100)])
    f.step({ wall: 0, script: 950, rate: 1 }, 100)
    const r = f.step({ wall: 16, script: 9040, rate: 1 }, 100)
    assert.equal(r.jumped, true)
    // 9000 is just behind the playhead (within LATE_MS): still played, late by a hair; 1500 is skipped.
    assert.ok(9040 - 9000 <= LATE_MS)
    assert.deepEqual(r.due.map(t => t.at), [9000, 9100])
  })

  it('starts from the playhead after a pause, without the turns behind it', () => {
    const f = new ScriptFollower([turn(1000), turn(2000)])
    f.step({ wall: 0, script: 500, rate: 1 }, 100)
    f.reset()
    assert.deepEqual(f.step({ wall: 5000, script: 1500, rate: 1 }, 100).due, [])
    assert.deepEqual(f.step({ wall: 5450, script: 1950, rate: 1 }, 100).due.map(t => t.at), [2000])
  })
})

describe('the generator', () => {
  it('says when the next bottom comes, once a stroke', () => {
    const f = new PhaseFollower()
    // One stroke a second.
    let bottoms: number[] = []
    for (let wall = 0; wall <= 3000; wall += 16) {
      const r = f.step((wall / 1000) % 1, wall, 80)
      if (r.bottom !== null)
        bottoms.push(Math.round(r.bottom))
    }
    bottoms = bottoms.map(b => Math.round(b / 10) * 10)
    assert.deepEqual(bottoms, [1000, 2000, 3000])
    assert.ok(Math.abs(f.spm() - 60) < 1)
  })
})

describe('the stroke as sent', () => {
  it('plays a turn at its moment, moved by the nudge and, while a script plays, the device latency', () => {
    assert.equal(streamWall(1010, 1000, 0, 0), 1010)
    assert.equal(streamWall(1010, 1000, 20, 0), 1030)
    // What's sent runs the latency ahead of the picture.
    assert.equal(streamWall(1010, 1000, 0, 120), 1130)
    // Known late, or nudged sooner than now: at once.
    assert.equal(streamWall(980, 1000, 0, 0), 1000)
    assert.equal(streamWall(1010, 1000, -50, 0), 1000)
  })

  it('takes the generator\'s speed into the bottom from its shape', () => {
    // A full stroke a second: down in half a second, 200 units a second.
    assert.equal(bottomSpeed(100, 60, 'sine'), 200)
    assert.equal(bottomSpeed(100, 60, undefined), 200)
    // A saw drops in the last quarter: twice as fast into the bottom.
    assert.equal(bottomSpeed(100, 60, 'saw'), 400)
    assert.ok(bottomSpeed(100, 60, 'pulse') < 200)
  })
})

describe('the audio clock', () => {
  it('takes the speakers\' delay off, from the output stamp or by hand', () => {
    const now = { perf: 10_000, currentTime: 5, outputLatency: 0.04 }
    // By hand: 100 ms from now, less 40 ms of speaker delay.
    assert.ok(Math.abs(contextTimeFor(10_100, now, null) - 5.06) < 1e-9)
    // The stamp says context time 4.97 is coming out at perf 10 000.
    assert.ok(Math.abs(contextTimeFor(10_100, now, { contextTime: 4.97, performanceTime: 10_000 }) - 5.07) < 1e-9)
    // A stamp that makes no sense is ignored.
    assert.ok(Math.abs(contextTimeFor(10_100, now, { contextTime: 1, performanceTime: 10_000 }) - 5.06) < 1e-9)
  })
})
