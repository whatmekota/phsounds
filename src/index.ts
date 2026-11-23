import type { Take } from './engine'
import type { Clock, StreamTurn } from './follow'
import type { Role } from './sets'
import type { Config } from './settings'
import type { Action, Turn } from './turns'
import type { PlayerSnapshot, PluginContext, PluginStatus, ScriptSnapshot } from './types'
import { earn, Tally } from './achievements'
import { demoScript } from './demo'
import { Engine } from './engine'
import { bottomSpeed, PhaseFollower, ScriptFollower, scriptAt, StreamTurns, streamWall, wallAt } from './follow'
import { Heat } from './heat'
import { balanceGains, knobWeight, loopGain, planHit, planPop, strokeStrength, wetLevel } from './levels'
import { OwnSounds, prepare, prepareGroup, TARGET } from './own'
import { MIX, ROLES } from './sets'
import { fields, heldBy, MOAN_GAP, readConfig, tooSoon } from './settings'
import { SHIPPED } from './shipped'
import { cleanActions, speedAt, turningPoints } from './turns'

/**
 * phsounds: sex sounds in time with the stroke. A slap at the bottom of
 * each stroke, a wet loop while it moves, a pop at the top now and then;
 * louder and harder the faster and deeper it goes, nothing when it's still.
 *
 * It follows whatever moves the stroke (see follow.ts): a script playing
 * with the video (scheduled ahead, to land with the picture), the stroke
 * generator (its phase, a moment ahead), or else the stroke axis as it's
 * sent. The sounds are recordings: a set that comes with it (sets.ts), or
 * your own files (own.ts).
 *
 * A timer looks every 15 ms at what moves, and schedules on the audio
 * clock whatever is due before the next look, plus the speakers' delay.
 * The stroke as it's sent comes in by itself (motion.onAxis), and a turn
 * found in it is set up at once.
 */

/** How often it looks, ms. */
const TICK_MS = 15
/** Nothing has moved for this long (ms): the audio clock is stopped until something does. */
const SLEEP_AFTER_MS = 60_000
/** A pause in the movement longer than this (ms) and the wet loop starts again from another one. */
const NEW_LOOP_AFTER_MS = 1500
/** No position sent for this long (ms): the stroke is still. Positions come every frame while it moves. */
const STILL_AFTER_MS = 200

const TOGGLE_KEYS = ['Shift+U', 'Alt+U', 'Alt+Shift+U']
const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 5.5c.8.7 1.2 1.6 1.2 2.5s-.4 1.8-1.2 2.5M12.8 3.8C14 4.9 14.6 6.4 14.6 8s-.6 3.1-1.8 4.2"/></svg>'

type Mode = 'off' | 'panic' | 'quiet' | 'headset' | 'blocked' | 'script' | 'motion' | 'stroke' | 'idle'

const STATUS: Record<Mode, PluginStatus | null> = {
  off: null,
  panic: { text: 'Silent: panic', tone: 'neutral' },
  quiet: { text: 'Quiet: there\'s sound already', tone: 'neutral', detail: 'What plays has its own sound. Switch "Only when nothing else makes sound" off to hear the stroke sounds over it.' },
  headset: { text: 'Quiet: the headset has the sound', tone: 'neutral', detail: 'The video plays in a headset, with its own sound there. Switch "Only when nothing else makes sound" off to hear the stroke sounds too.' },
  blocked: { text: 'Click anywhere to let it sound', tone: 'warn', detail: 'The browser holds sound back until you have clicked on the page once.' },
  script: { text: 'Following the script', tone: 'ok', detail: 'In time with the picture.' },
  motion: { text: 'Following the motion', tone: 'ok', detail: 'The stroke generator.' },
  stroke: { text: 'Following the stroke', tone: 'ok', detail: 'As it is sent to the device.' },
  idle: { text: 'Waiting for a stroke', tone: 'neutral' },
}

const SET_IDS = SHIPPED.map(s => s.id)

export default function activate(ctx: PluginContext) {
  let cfg: Config = readConfig(ctx.settings.all(), SET_IDS)
  const engine = new Engine()
  const own = new OwnSounds(ctx, Engine.decode)
  const heat = new Heat()
  const tally = new Tally(ctx)
  void tally.start()

  // ─── The script ──────────────────────────────────────────────────────────
  let actions: Action[] = []
  let turns: Turn[] = []
  let offsetMs = 0
  const script = new ScriptFollower([])
  function takeScripts(s: ScriptSnapshot) {
    const axis = s.axes.find(a => a.axis === 'L0')
    actions = axis ? cleanActions(axis.actions) : []
    offsetMs = axis?.offsetMs ?? 0
    turns = turningPoints(actions)
    script.setTurns(turns)
  }
  takeScripts(ctx.scripts.current())
  ctx.scripts.onChange(takeScripts)

  // ─── The player ──────────────────────────────────────────────────────────
  let player: PlayerSnapshot = ctx.player.state()
  ctx.player.onChange((s) => {
    player = s
  })

  /** The knob as it comes through, an edge included; 1 if it can't be read. */
  function knob(): number {
    try {
      return knobWeight(ctx.session.edgeState().effective)
    }
    catch {
      return 1
    }
  }

  // ─── The sounds: the set's, or yours ────────────────────────────────────
  /** Each loaded set's takes, levelled. */
  const loaded = new Map<string, Record<Role, Take[]>>()
  const loading = new Map<string, Promise<void>>()

  /** A set's recordings, read from the zip and levelled, once. */
  function load(id: string): Promise<void> {
    const set = SHIPPED.find(s => s.id === id)
    if (!set)
      return Promise.resolve()
    let p = loading.get(id)
    if (!p) {
      const read = async (path: string): Promise<AudioBuffer | null> => {
        try {
          const url = ctx.asset(path)
          return url ? await Engine.decode(await (await fetch(url)).arrayBuffer()) : null
        }
        catch (err) {
          ctx.log(`couldn't read ${path}:`, err)
          return null
        }
      }
      const all = async (paths: string[]) => (await Promise.all(paths.map(read))).filter((b): b is AudioBuffer => !!b)
      p = (async () => {
        const [slap, wet, pop, moan] = await Promise.all(ROLES.map(r => all(set.files[r])))
        loaded.set(id, {
          slap: prepareGroup(slap, TARGET.slap),
          wet: wet.map(b => prepare('wet', b)),
          pop: prepareGroup(pop, TARGET.pop),
          moan: moan.map(b => prepare('moan', b)),
        })
        form()
      })()
      loading.set(id, p)
    }
    return p
  }

  /** What plays for a kind: yours where you've added some (and they're on), else the set's. */
  function takes(role: Role): Take[] {
    if (cfg.own && role !== 'pop') {
      const mine = own.buffers(role)
      if (mine.length)
        return mine
    }
    return loaded.get(cfg.set)?.[role] ?? []
  }

  /** The Wet or slap mix; with no wet loop to play, the slaps alone. */
  const balance = () => balanceGains(takes('wet').length ? cfg.balance : 1)

  let loopNow: Take | null = null
  let moanVoice: ReturnType<Engine['moan']> = null

  // ─── Playing one turn ────────────────────────────────────────────────────
  let lastBottomWall = Number.NEGATIVE_INFINITY
  /** When the last slap was heard (wall ms), for Least time between slaps. */
  let lastSlapWall = Number.NEGATIVE_INFINITY

  /**
   * A turn at context time `at` (heard at wall ms `wall`), of strength k
   * (0–1, the knob already in) and depth amp (0–100). `real`: a stroke being
   * followed, which counts toward the achievements (Hear them doesn't).
   */
  function play(kind: Turn['kind'], k: number, amp: number, at: number, wall: number, real = true) {
    const bal = balance()
    if (kind === 'bottom') {
      // A bounce or a vibration's little turns: not a stroke of its own.
      if (tooSoon(wall, lastSlapWall, cfg.minGapMs))
        return
      const plan = planHit(MIX, k, amp, bal)
      if (!plan)
        return
      lastSlapWall = wall
      const slaps = takes('slap')
      if (slaps.length && engine.hit(at, plan, engine.pick(slaps, k, 'slap')) && real)
        tally.slap()
      const gap = wall - lastBottomWall
      lastBottomWall = wall
      heat.stroke(k, wall, gap)
      const moans = takes('moan')
      if (moans.length && !engine.playing(moanVoice, at)) {
        const rule = MOAN_GAP[cfg.moanEvery]
        if (heat.moan(k, wall, rule.gapMs, rule.chance, Math.random())) {
          moanVoice = engine.moan(at + 0.04, engine.pick(moans, k, 'moan'), 0.75 + 0.25 * heat.value)
          if (moanVoice && real)
            earn(ctx, 'moan')
        }
      }
      return
    }
    const pops = takes('pop')
    if (cfg.tops && pops.length && Math.random() < MIX.popChance)
      engine.pop(at, engine.pick(pops, k, 'pop'), planPop(MIX, k, bal))
  }

  // ─── The wet loop ────────────────────────────────────────────────────────
  let movedAt = Number.NEGATIVE_INFINITY

  /** The wet loop from `from` (wall ms), its level from `wetAt` (wall ms → 0–1). */
  function wet(now: number, from: number, wetAt: (w: number) => number, k: number) {
    const loops = takes('wet')
    const wNow = wetAt(Math.max(now, from))
    if (wNow > 0.02) {
      if (now - movedAt > NEW_LOOP_AFTER_MS)
        loopNow = null
      movedAt = now
    }
    if (!loops.length) {
      if (loopNow) {
        engine.wetLoop(engine.when(from), null, 0, 1)
        loopNow = null
      }
      return
    }
    if (!loopNow || !loops.includes(loopNow))
      loopNow = loops[Math.floor(Math.random() * loops.length)]
    engine.wetLoop(engine.when(from), loopNow, loopGain(MIX, wNow, balance()) * k, 0.85 + 0.3 * wNow)
  }

  // ─── Following ───────────────────────────────────────────────────────────
  const phase = new PhaseFollower()
  let mode: Mode = 'idle'
  let shown: Mode | null = null
  let following = false
  let lastMotion = performance.now()

  function setMode(m: Mode) {
    mode = m
    if (m === shown)
      return
    shown = m
    try {
      ctx.ui.status(STATUS[m])
    }
    catch {}
  }

  /** Stops following: everything set to come is called off, the loop falls quiet. */
  function letGo() {
    if (!following)
      return
    following = false
    script.reset()
    phase.reset()
    if (engine.ac) {
      engine.cancelFrom(engine.ac.currentTime)
      engine.wetLoop(engine.ac.currentTime, null, 0, 1)
    }
    loopNow = null
  }

  // ─── The stroke as it's sent ─────────────────────────────────────────────
  const stream = new StreamTurns(4)
  /** When the last position came, wall ms. */
  let axisAt = Number.NEGATIVE_INFINITY
  /** The device latency while a script plays (what's sent runs that much ahead of the picture), else 0; as of the last look. */
  let lateMs = 0

  /**
   * Each position sent to the stroke, 0–1 with 0 at the bottom whatever the
   * device's range and invert, and how many ms ahead it's meant. Dated
   * there, so a turn plays when the device is meant to turn, or as soon as
   * it's seen, if that's later.
   */
  function onAxis(axis: string, pos: number, inMs: number) {
    if (axis !== 'L0')
      return
    const now = performance.now()
    axisAt = now
    const turn = stream.push(pos * 100, now + (inMs > 0 ? inMs : 0))
    if (turn)
      turned(turn, now)
  }

  /** A turn off the stream: played when following the stroke as sent; the generator's tops too (its bottoms come from its phase). */
  function turned(turn: StreamTurn, now: number) {
    if (!following || !engine.running || !(mode === 'stroke' || (mode === 'motion' && turn.kind === 'top')))
      return
    const wall = streamWall(turn.at, now, cfg.nudgeMs, lateMs)
    play(turn.kind, strokeStrength(turn.speed, turn.amp) * knob(), turn.amp, engine.when(wall), wall)
  }

  function tick() {
    const now = performance.now()
    if (!cfg.enabled) {
      letGo()
      setMode('off')
      if (engine.running && now - lastMotion > 3000)
        engine.sleep()
      return
    }
    if (ctx.safety.panicked()) {
      if (mode !== 'panic')
        engine.hush()
      following = true
      letGo()
      stream.reset()
      setMode('panic')
      return
    }

    const ro = ctx.motion.readout()
    lateMs = ro.scriptDriving && ro.latencyMs > 0 ? ro.latencyMs : 0
    const scripted = player.playing && turns.length >= 2
    const generator = !scripted && ro.phase !== null && ro.spm > 0
    // The stroke as sent (the fallback, and the generator's tops): still once nothing comes.
    const streamSpeed = now - axisAt < STILL_AFTER_MS ? stream.speed : 0
    const moving = scripted || generator || streamSpeed > 2
    if (moving)
      lastMotion = now

    // Whether it has sound already: playhound says. Read each look, as it's known only a moment after a video starts.
    const held = cfg.onlySilent && player.playing ? heldBy(ctx.player.state()) : null
    if (held) {
      letGo()
      setMode(held === 'headset' ? 'headset' : 'quiet')
      return
    }
    if (!moving) {
      letGo()
      if (engine.running && now - lastMotion > SLEEP_AFTER_MS)
        engine.sleep()
      setMode(engine.ac && !engine.running && !engine.waking && now - lastMotion < SLEEP_AFTER_MS ? 'blocked' : 'idle')
      return
    }
    if (!engine.wake()) {
      // Waking from its own sleep takes a moment; otherwise the browser is holding sound back.
      setMode(engine.waking || engine.starting ? mode : 'blocked')
      return
    }
    following = true
    const lead = engine.leadMs()
    // Far enough ahead that the next look comes before it's too late, the speakers' delay on top.
    const horizon = lead + TICK_MS * 3
    const k = knob()

    if (scripted) {
      setMode('script')
      phase.reset()
      const rate = player.rate > 0 ? player.rate : 1
      // The nudge moves where the picture is taken to be: later sounds, a picture further back.
      const c: Clock = { wall: now, script: ctx.player.clock() * 1000 + offsetMs - cfg.nudgeMs * rate, rate }
      const { due, jumped } = script.step(c, horizon)
      if (jumped && engine.ac)
        engine.cancelFrom(engine.ac.currentTime)
      for (const t of due) {
        const wall = wallAt(c, t.at)
        play(t.kind, strokeStrength(t.speed * rate, t.amp) * k, t.amp, engine.when(wall), wall)
      }
      wet(now, now + lead, w => wetLevel(speedAt(actions, scriptAt(c, w)) * rate), k)
      return
    }

    script.reset()
    if (generator) {
      setMode('motion')
      // The bottom, a moment ahead, from the phase; tops as the stroke turns.
      const { bottom } = phase.step(ro.phase, now, Math.max(TICK_MS * 2, horizon - cfg.nudgeMs))
      if (bottom !== null) {
        const amp = Math.min(100, Math.max(0, ro.depth * 100))
        const speed = bottomSpeed(amp, phase.spm(), ro.shape)
        const wall = bottom + cfg.nudgeMs
        play('bottom', strokeStrength(speed, amp) * k, amp, engine.when(wall), wall)
      }
      // Its tops come off the stream as they're found (turned).
    }
    else {
      // Its turns are played as they're found (turned).
      setMode('stroke')
      phase.reset()
    }
    const w = wetLevel(streamSpeed)
    wet(now, now + lateMs, () => w, k)
  }

  // ─── Hearing a set ───────────────────────────────────────────────────────
  /** A few strokes with the current sounds, from the settings, whatever plays. */
  async function hear(): Promise<string> {
    if (ctx.safety.panicked())
      throw new Error('Panic is on: lift it first (Esc).')
    engine.wake()
    await engine.ac?.resume().catch(() => {})
    if (!engine.running)
      throw new Error('The browser won\'t play sound yet. Click on the page and try again.')
    await load(cfg.set)
    if (!takes('slap').length && !takes('wet').length)
      throw new Error('No sounds to play: add slaps of your own below.')
    // Whatever was being followed has been let go of already; nothing comes along to call this off.
    letGo()
    const acts = cleanActions(demoScript())
    const list = turningPoints(acts)
    const start = performance.now() + 150
    const k = knob()
    for (const t of list) {
      const wall = start + t.at
      play(t.kind, strokeStrength(t.speed, t.amp) * k, t.amp, engine.when(wall), wall, false)
    }
    // Where the strokes end (the script holds still after).
    const end = list[list.length - 1].at
    // The wet loop, in steps, as if it were following.
    for (let ms = 0; ms < end; ms += 25)
      wet(start + ms, start + ms, w => wetLevel(speedAt(acts, w - start)), k)
    if (loopNow)
      engine.wetLoop(engine.when(start + end), loopNow, 0, 1)
    lastMotion = performance.now() + end
    const name = SHIPPED.find(s => s.id === cfg.set)?.name
    return `${cfg.own && own.buffers('slap').length ? 'Your slaps' : name ?? 'The sounds'}, for ${(end / 1000).toFixed(0)} seconds.`
  }

  // ─── Settings and the toggle ─────────────────────────────────────────────
  const key = TOGGLE_KEYS.find(k => ctx.commands.keyFree(k)) ?? null
  /** An Add button: the files picked in its dialog, into a slot. */
  function addTo(slot: 'slap' | 'wet' | 'moan') {
    return async (files: File[]) => {
      const had = own.of(slot).length
      const said = await own.add(slot, files)
      if (own.of(slot).length > had)
        earn(ctx, 'own-sound')
      return said
    }
  }
  function clear(slot: 'slap' | 'wet' | 'moan', what: string) {
    return async () => {
      const n = await own.clear(slot)
      return n ? `Removed ${n} ${what}.` : undefined
    }
  }
  const runs = {
    hear,
    addSlap: addTo('slap'),
    addWet: addTo('wet'),
    addMoan: addTo('moan'),
    clearSlap: clear('slap', 'slaps'),
    clearWet: clear('wet', 'wet loops'),
    clearMoan: clear('moan', 'moans'),
  }
  function form() {
    const names = (slot: 'slap' | 'wet' | 'moan') => own.of(slot).map(e => e.name)
    ctx.ui.settings(fields({
      key,
      own: { slap: names('slap'), wet: names('wet'), moan: names('moan') },
      sets: SHIPPED.map(s => ({ id: s.id, name: s.name })),
      wet: takes('wet').length > 0,
      pops: takes('pop').length > 0,
    }, runs))
  }
  form()
  own.onChange(form)
  void own.load().then(() => {
    // Added before there were achievements: earned already.
    if (own.entries.length)
      earn(ctx, 'own-sound')
  }).catch(err => ctx.log('your sounds could not be read:', err))

  ctx.settings.onChange((v) => {
    const was = cfg
    cfg = readConfig(v, SET_IDS)
    if (cfg.set !== was.set)
      void load(cfg.set)
    if (cfg.set !== was.set || cfg.own !== was.own)
      form()
    if (cfg.volume !== was.volume)
      engine.setVolume(cfg.volume)
  })
  engine.setVolume(cfg.volume)
  // Read the set's sounds while nothing is going on, so the first stroke doesn't wait for them.
  const early = setTimeout(() => void load(cfg.set), 400)

  ctx.commands.register({
    id: 'toggle',
    title: 'Stroke sounds on or off',
    hint: 'Wet slaps in time with the stroke',
    icon: ICON,
    kbd: TOGGLE_KEYS,
    run() {
      const on = !cfg.enabled
      ctx.settings.set('enabled', on)
      cfg = { ...cfg, enabled: on }
      if (on)
        engine.wake()
      ctx.ui.toast(on ? 'Stroke sounds on' : 'Stroke sounds off')
    },
  })

  ctx.safety.onPanic(() => engine.hush())

  const stopAxis = ctx.motion.onAxis(onAxis)
  const timer = setInterval(() => {
    try {
      tick()
    }
    catch (err) {
      ctx.log('tick failed:', err)
    }
  }, TICK_MS)

  return () => {
    clearInterval(timer)
    clearTimeout(early)
    stopAxis()
    tally.report()
    engine.close()
    try {
      ctx.ui.status(null)
    }
    catch {}
  }
}
