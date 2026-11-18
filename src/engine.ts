import type { HitPlan } from './levels'
import { contextTimeFor } from './follow'
import { MIX } from './sets'

/**
 * The sound itself: one AudioContext, and recordings started at exact times
 * on its clock.
 *
 *   takes ─> volume ─────────────┬─> soft clip ─> speakers
 *        └─> room ──> volume ────┘
 *
 * Everything that starts later than now is remembered until it has played,
 * so a seek or a pause can call it off (cancelFrom) and panic can silence
 * all of it at once (hush).
 */

/** Volume 1 (100%) is this gain. */
const MASTER = 1
/** Clipping starts this far over full scale, and rounds off softly before it. */
const CLIP = 2

interface Voice {
  sources: AudioScheduledSourceNode[]
  /** Context time it starts. */
  at: number
  /** Context time it's over. */
  end: number
}

/** A decoded recording, trimmed and levelled (own.ts). */
export interface Take {
  buffer: AudioBuffer
  /** Seconds to skip at the start (silence), and how much to play. */
  offset: number
  duration: number
  /** Brings it to the level its kind wants. */
  gain: number
  /** How loud it is then (A-weighted energy, dB), for takes that are picked by strength. */
  db?: number
}

/** A short room: a few early reflections and a soft tail, stereo, so the dry takes sit somewhere. */
function roomImpulse(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate
  const n = Math.round(sr * 0.4)
  const buf = ac.createBuffer(2, n, sr)
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 4294967296
  }
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < n; i++) {
      const t = i / sr
      // A soft-edged tail, darker as it goes.
      const x = (rand() * 2 - 1) * Math.exp(-t / 0.075) * Math.min(1, t / 0.004)
      lp += (x - lp) * (0.55 - 0.35 * Math.min(1, t / 0.3))
      d[i] = lp
    }
    // Walls close by.
    for (const [ms, g] of [[6.5, 0.5], [11, -0.35], [17.5, 0.25], [23, -0.18]] as const) {
      const at = Math.round(((ms + ch * 1.3) / 1000) * sr)
      d[at] += g
    }
  }
  return buf
}

function clipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * CLIP)
  }
  return c
}

export class Engine {
  ac: AudioContext | null = null
  private volume!: GainNode
  private bus!: GainNode
  private loop: { src: AudioBufferSourceNode, gain: GainNode, filter: BiquadFilterNode, take: Take } | null = null
  private voices: Voice[] = []
  private vol = 0.7
  /** The last take of each kind, so the same one doesn't come twice running. */
  private lastTake: Record<string, number> = {}

  /** The context, made if need be; false while the browser won't let it play (no click yet). */
  wake(): boolean {
    if (!this.ac) {
      try {
        this.ac = new AudioContext({ latencyHint: 'interactive' })
        this.madeAt = performance.now()
      }
      catch {
        return false
      }
      this.build()
    }
    if (this.ac.state === 'suspended')
      void this.ac.resume().catch(() => {})
    if (this.ac.state === 'running')
      this.slept = false
    return this.ac.state === 'running'
  }

  private slept = false
  private madeAt = 0

  /** Just made: a new context says "suspended" for a moment even when it may play. */
  get starting(): boolean {
    return this.ac?.state === 'suspended' && performance.now() - this.madeAt < 1000
  }

  /** Stop the clock (nothing moving for a while): saves the CPU and the battery. */
  sleep(): void {
    if (this.ac?.state === 'running') {
      this.slept = true
      void this.ac.suspend().catch(() => {})
    }
  }

  /** Coming back from its own sleep (rather than held back by the browser). */
  get waking(): boolean {
    return this.slept && this.ac?.state === 'suspended'
  }

  get running(): boolean {
    return this.ac?.state === 'running'
  }

  close(): void {
    this.hush()
    void this.ac?.close().catch(() => {})
    this.ac = null
    this.loop = null
  }

  private build(): void {
    const ac = this.ac!
    const pre = ac.createGain()
    pre.gain.value = 1 / CLIP
    const clip = ac.createWaveShaper()
    clip.curve = clipCurve()
    clip.oversample = '2x'
    pre.connect(clip).connect(ac.destination)

    this.volume = ac.createGain()
    this.volume.connect(pre)
    const room = ac.createConvolver()
    room.normalize = true
    room.buffer = roomImpulse(ac)
    const roomSend = ac.createGain()
    roomSend.gain.value = MIX.room
    roomSend.connect(room).connect(this.volume)

    this.bus = ac.createGain()
    this.bus.connect(this.volume)
    this.bus.connect(roomSend)
    this.setVolume(this.vol)
  }

  /** 0–1. */
  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v))
    if (this.ac)
      this.volume.gain.setTargetAtTime(MASTER * this.vol ** 1.6, this.ac.currentTime, 0.03)
  }

  /** When to start, on the context's clock, to be heard at wall ms `wall` (performance.now). */
  when(wall: number): number {
    const ac = this.ac!
    let stamp: { contextTime: number, performanceTime: number } | null = null
    try {
      const s = ac.getOutputTimestamp?.()
      if (s && typeof s.contextTime === 'number' && typeof s.performanceTime === 'number')
        stamp = { contextTime: s.contextTime, performanceTime: s.performanceTime }
    }
    catch {}
    const t = contextTimeFor(wall, { perf: performance.now(), currentTime: ac.currentTime, outputLatency: ac.outputLatency || ac.baseLatency || 0 }, stamp)
    return Math.max(ac.currentTime + 0.003, t)
  }

  /** How far ahead (ms) a sound has to be set up to be heard on time: the speakers' delay, and a bit. */
  leadMs(): number {
    const ac = this.ac
    if (!ac)
      return 0
    return ((ac.outputLatency || ac.baseLatency || 0.02) * 1000) + 10
  }

  /** An index into `n` takes of `kind`, never the last one twice running. */
  private take(kind: string, n: number): number {
    if (n <= 1)
      return 0
    let i = Math.floor(Math.random() * n)
    if (i === this.lastTake[kind])
      i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n
    this.lastTake[kind] = i
    return i
  }

  /**
   * One of a kind's takes for a stroke of strength `k`. Takes levelled as a
   * group (sorted quietest first, see prepareGroup) come from the louder half
   * for a hard stroke; any others at random.
   */
  pick(list: Take[], k: number, kind: string): Take {
    if (list.length < 3 || list[0].db === undefined)
      return list[this.take(kind, list.length)]
    const half = Math.ceil(list.length / 2)
    const pool = k > 0.55 ? list.slice(list.length - half) : list.slice(0, half)
    return pool[this.take(`${kind}${k > 0.55}`, pool.length)]
  }

  private remember(v: Voice): void {
    const now = this.ac!.currentTime
    if (this.voices.length > 64)
      this.voices = this.voices.filter(x => x.end > now)
    this.voices.push(v)
  }

  /** A take through a gain (and a pan, and a low-pass) at context time `at`. */
  private shot(t: Take, at: number, gain: number, o: { rate?: number, pan?: number, lowpassHz?: number } = {}): Voice | null {
    if (!(gain > 0.0005) || !this.ac)
      return null
    const ac = this.ac
    const rate = o.rate ?? 1
    const src = ac.createBufferSource()
    src.buffer = t.buffer
    src.playbackRate.value = rate
    const g = ac.createGain()
    g.gain.value = gain
    let head: AudioNode = src
    if (o.lowpassHz && o.lowpassHz < ac.sampleRate * 0.45) {
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = o.lowpassHz
      f.Q.value = 0.6
      head.connect(f)
      head = f
    }
    head.connect(g)
    if (o.pan) {
      const p = ac.createStereoPanner()
      p.pan.value = o.pan
      g.connect(p).connect(this.bus)
    }
    else {
      g.connect(this.bus)
    }
    src.start(at, t.offset, t.duration)
    const v = { sources: [src], at, end: at + t.duration / rate }
    this.remember(v)
    return v
  }

  /** A slap at the bottom of a stroke, at context time `at`. False if it's too quiet to play (the slaps turned all the way down). */
  hit(at: number, plan: HitPlan, t: Take): boolean {
    const rate = 1 + (Math.random() * 2 - 1) * 0.04
    const pan = (Math.random() * 2 - 1) * 0.08
    return this.shot(t, at, t.gain * plan.slap, { rate, pan, lowpassHz: plan.lowpassHz }) !== null
  }

  /** A pop at the top of a stroke. */
  pop(at: number, t: Take, gain: number): void {
    const rate = 1 + (Math.random() * 2 - 1) * 0.06
    const pan = (Math.random() * 2 - 1) * 0.15
    this.shot(t, at, t.gain * gain, { rate, pan })
  }

  /** A wet loop while it moves: its level and speed from `at`. Null stops it. */
  wetLoop(at: number, t: Take | null, level: number, rate: number): void {
    const ac = this.ac
    if (!ac)
      return
    if (this.loop && this.loop.take !== t) {
      const old = this.loop
      old.gain.gain.setTargetAtTime(0, ac.currentTime, 0.05)
      try {
        old.src.stop(ac.currentTime + 0.4)
      }
      catch {}
      this.loop = null
    }
    if (!t)
      return
    if (!this.loop) {
      const src = ac.createBufferSource()
      src.buffer = t.buffer
      src.loop = true
      src.loopStart = t.offset
      src.loopEnd = t.offset + t.duration
      const gain = ac.createGain()
      gain.gain.value = 0
      const filter = ac.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 18000
      src.connect(filter).connect(gain).connect(this.bus)
      // Somewhere in the middle of it, so it isn't the same opening every time.
      src.start(ac.currentTime, t.offset + Math.random() * t.duration * 0.8)
      this.loop = { src, gain, filter, take: t }
    }
    const from = Math.max(at, ac.currentTime)
    this.loop.gain.gain.setTargetAtTime(t.gain * level, from, 0.06)
    this.loop.src.playbackRate.setTargetAtTime(rate, from, 0.1)
    // Slower is duller, as a slow stroke is softer.
    this.loop.filter.frequency.setTargetAtTime(2500 + 15000 * Math.min(1, level), from, 0.08)
  }

  /** A moan, from its start. */
  moan(at: number, t: Take, gain: number): Voice | null {
    return this.shot(t, at, t.gain * gain)
  }

  /** Whether a voice is still going at context time `t`. */
  playing(v: Voice | null, t: number): boolean {
    return !!v && v.end > t
  }

  /** Calls off everything set to start at or after context time `t` (a seek, a pause); what's already sounding rings out. */
  cancelFrom(t: number): void {
    const keep: Voice[] = []
    for (const v of this.voices) {
      if (v.at >= t) {
        for (const s of v.sources) {
          try {
            s.stop()
          }
          catch {}
        }
      }
      else {
        keep.push(v)
      }
    }
    this.voices = keep
    this.loop?.gain.gain.cancelScheduledValues(t)
  }

  /** Silence, now: panic, or switched off. */
  hush(): void {
    for (const v of this.voices) {
      for (const s of v.sources) {
        try {
          s.stop()
        }
        catch {}
      }
    }
    this.voices = []
    if (this.ac && this.loop) {
      const now = this.ac.currentTime
      this.loop.gain.gain.cancelScheduledValues(now)
      this.loop.gain.gain.setValueAtTime(0, now)
    }
  }

  /** Decode a file into a buffer (on an offline context, so it works before there is a live one). */
  static async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const ac = new OfflineAudioContext(1, 1, 48000)
    return ac.decodeAudioData(bytes.slice(0))
  }
}
