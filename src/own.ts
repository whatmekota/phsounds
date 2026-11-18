import type { Take } from './engine'
import type { Role } from './sets'
import type { PluginContext } from './types'
import { aEnergyDb, aLevelDb, gainTo } from './loudness'

/**
 * Your own sounds, in three slots: slaps for the end of each stroke, a wet
 * loop for while it moves, and moans for the peaks. Picked with the file
 * dialog from the settings (a file field), kept in playhound's plugin storage
 * (the file itself, so it survives the original moving), and levelled like
 * the sets' sounds so a quiet recording and a hot one sit alike.
 */

export const SLOTS = ['slap', 'wet', 'moan'] as const
export type Slot = typeof SLOTS[number]

/** What the index keeps about each sound; the bytes are under `sound:<id>`. */
export interface OwnEntry {
  id: string
  slot: Slot
  name: string
  size: number
}

/** Bigger than this is refused: a wet loop of a minute in a compressed format is well under it. */
export const MAX_BYTES = 12 * 1024 * 1024
/** A slot holds at most this many. */
export const MAX_PER_SLOT = 24
/** What the Add buttons' file dialog offers. */
export const ACCEPT = 'audio/*,.wav,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm'

/** How loud each kind is brought to, A-weighted (see loudness.ts): a slap and a pop by its energy, the others by level. */
export const TARGET: Record<Role, number> = { slap: -25, pop: -33, wet: -26, moan: -24 }

const INDEX = 'sounds'

/** The index as stored, whatever was stored: entries that make sense, in order. */
export function cleanIndex(v: unknown): OwnEntry[] {
  if (!Array.isArray(v))
    return []
  const seen = new Set<string>()
  const out: OwnEntry[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object')
      continue
    const { id, slot, name, size } = e as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id) || !SLOTS.includes(slot as Slot))
      continue
    seen.add(id)
    out.push({ id, slot: slot as Slot, name: typeof name === 'string' ? name.slice(0, 120) : 'sound', size: typeof size === 'number' && size >= 0 ? size : 0 })
  }
  return out
}

/**
 * Where the sound is: skips the silence before it (a slap that starts late
 * would land late) and after it. Returns seconds.
 */
export function trim(data: ArrayLike<number>, sr: number): { offset: number, duration: number } {
  let peak = 0
  for (let i = 0; i < data.length; i++)
    peak = Math.max(peak, Math.abs(data[i]))
  if (!(peak > 0))
    return { offset: 0, duration: data.length / sr }
  let start = 0
  while (start < data.length && Math.abs(data[start]) < peak * 0.03)
    start++
  let end = data.length - 1
  while (end > start && Math.abs(data[end]) < peak * 0.003)
    end--
  // A little before the onset, so its very start isn't cut.
  start = Math.max(0, start - Math.round(sr * 0.002))
  end = Math.min(data.length, end + Math.round(sr * 0.01))
  return { offset: start / sr, duration: Math.max(1, end - start) / sr }
}

/** Mono samples of a buffer's first channel between offset and offset + duration. */
function part(b: AudioBuffer, offset: number, duration: number): Float32Array {
  const d = b.getChannelData(0)
  const from = Math.round(offset * b.sampleRate)
  return d.subarray(from, Math.min(d.length, from + Math.round(duration * b.sampleRate)))
}

/** A decoded sound, trimmed and levelled for its kind. */
export function prepare(role: Role, buffer: AudioBuffer): Take {
  const sr = buffer.sampleRate
  const { offset, duration } = role === 'wet' ? { offset: 0, duration: buffer.duration } : trim(buffer.getChannelData(0), sr)
  const x = part(buffer, offset, duration)
  const db = role === 'slap' || role === 'pop' ? aEnergyDb(x, sr) : aLevelDb(x, sr)
  // Never more than +24 dB: a near-silent file stays near silent rather than all noise.
  const gain = Math.min(16, 10 ** ((TARGET[role] - db) / 20))
  return { buffer, offset, duration, gain }
}

/**
 * Takes that belong together (a set's slaps), trimmed and levelled as a
 * group to `target` (A-weighted energy): the loudest stays the loudest, so a
 * harder stroke can pick a harder take. Sorted from the quietest.
 */
export function prepareGroup(buffers: AudioBuffer[], target: number): Take[] {
  const list = buffers.map((buffer) => {
    const { offset, duration } = trim(buffer.getChannelData(0), buffer.sampleRate)
    return { buffer, offset, duration, db: aEnergyDb(part(buffer, offset, duration), buffer.sampleRate) }
  })
  const g = Math.min(16, gainTo(list.map(x => x.db), target))
  return list
    .sort((a, b) => a.db - b.db)
    .map(x => ({ buffer: x.buffer, offset: x.offset, duration: x.duration, gain: g, db: x.db + 20 * Math.log10(g) }))
}

export class OwnSounds {
  entries: OwnEntry[] = []
  /** Decoded and ready, by id. */
  private ready = new Map<string, Take>()
  private changed = new Set<() => void>()

  constructor(private readonly ctx: PluginContext, private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>) {}

  async load(): Promise<void> {
    this.entries = cleanIndex(await this.ctx.storage.get(INDEX))
    await Promise.all(this.entries.map(e => this.open(e)))
    this.emit()
  }

  private async open(e: OwnEntry): Promise<void> {
    try {
      const bytes = await this.ctx.storage.get<ArrayBuffer>(`sound:${e.id}`)
      if (!(bytes instanceof ArrayBuffer))
        return
      this.ready.set(e.id, prepare(e.slot, await this.decode(bytes)))
    }
    catch (err) {
      this.ctx.log(`couldn't read ${e.name}:`, err)
    }
  }

  onChange(fn: () => void): () => void {
    this.changed.add(fn)
    return () => void this.changed.delete(fn)
  }

  private emit(): void {
    for (const fn of this.changed)
      fn()
  }

  of(slot: Slot): OwnEntry[] {
    return this.entries.filter(e => e.slot === slot)
  }

  /** The ready sounds of a slot. */
  buffers(slot: Slot): Take[] {
    return this.of(slot).map(e => this.ready.get(e.id)).filter((b): b is Take => !!b)
  }

  /** Adds files to a slot; says what came of it, in a line. */
  async add(slot: Slot, files: File[]): Promise<string> {
    const added: string[] = []
    const refused: string[] = []
    for (const f of files) {
      if (this.of(slot).length >= MAX_PER_SLOT) {
        refused.push(`${f.name} (that's ${MAX_PER_SLOT} already)`)
        continue
      }
      if (f.size > MAX_BYTES) {
        refused.push(`${f.name} (over ${MAX_BYTES / 1024 / 1024} MB)`)
        continue
      }
      try {
        const bytes = await f.arrayBuffer()
        const buffer = await this.decode(bytes)
        if (!(buffer.duration > 0.01))
          throw new Error('empty')
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        await this.ctx.storage.set(`sound:${id}`, bytes)
        const e: OwnEntry = { id, slot, name: f.name, size: f.size }
        this.entries.push(e)
        this.ready.set(id, prepare(slot, buffer))
        added.push(f.name)
      }
      catch {
        refused.push(`${f.name} (not a sound this can play)`)
      }
    }
    await this.ctx.storage.set(INDEX, this.entries)
    this.emit()
    const parts: string[] = []
    if (added.length)
      parts.push(`Added ${added.length === 1 ? added[0] : `${added.length} sounds`}.`)
    if (refused.length)
      parts.push(`Left out ${refused.join(', ')}.`)
    return parts.join(' ') || 'Nothing added.'
  }

  /** Forgets every sound in a slot. */
  async clear(slot: Slot): Promise<number> {
    const gone = this.of(slot)
    this.entries = this.entries.filter(e => e.slot !== slot)
    for (const e of gone) {
      this.ready.delete(e.id)
      await this.ctx.storage.del(`sound:${e.id}`)
    }
    await this.ctx.storage.set(INDEX, this.entries)
    this.emit()
    return gone.length
  }
}
