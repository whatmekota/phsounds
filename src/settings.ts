import type { PlayerSnapshot, SettingField } from './types'
import { ACCEPT } from './own'

export type MoanEvery = 'rare' | 'some' | 'often'

export interface Config {
  enabled: boolean
  /** 0–1. */
  volume: number
  /** A shipped set's id (sets.ts); the first if it's gone. */
  set: string
  /** 0 only wet … 0.5 as the set has it … 1 only slaps. */
  balance: number
  /** A pop at the top of strokes. */
  tops: boolean
  /** Quiet while the video (or a song) playing here has its own sound. */
  onlySilent: boolean
  /** Ms later (or earlier, below 0) than the picture. */
  nudgeMs: number
  /** Least ms between two slaps: a stroke that ends sooner makes none. 0: every stroke. */
  minGapMs: number
  /** Play your own sounds where you've added some. */
  own: boolean
  moanEvery: MoanEvery
}

/** Least time between moans, ms, and the chance a qualifying stroke takes it. */
export const MOAN_GAP: Record<MoanEvery, { gapMs: number, chance: number }> = {
  rare: { gapMs: 25_000, chance: 0.25 },
  some: { gapMs: 12_000, chance: 0.35 },
  often: { gapMs: 6_000, chance: 0.5 },
}

/**
 * Least time between slaps, by default: below the quickest real strokes
 * (four a second is 250 ms bottom to bottom), above the turns of a script
 * that vibrates or bounces, where every little turn slapped and it rattled
 * like a machine gun.
 */
export const MIN_GAP_DEFAULT = 100

/**
 * Whether a slap at `wall` comes too soon after the last one, at `last`
 * (both wall ms). One earlier than the last (sounds lined up again after a
 * seek) is a fresh start, never too soon.
 */
export function tooSoon(wall: number, last: number, minGapMs: number): boolean {
  const since = wall - last
  return minGapMs > 0 && since >= 0 && since < minGapMs
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

/** The settings as the plugin uses them, whatever was stored, with these sets shipped. */
export function readConfig(v: Record<string, unknown>, sets: readonly string[]): Config {
  return {
    enabled: v.enabled !== false,
    volume: num(v.volume, 70, 0, 100) / 100,
    set: oneOf(v.set, sets, sets[0] ?? ''),
    balance: num(v.balance, 50, 0, 100) / 100,
    tops: v.tops !== false,
    onlySilent: v.onlySilent !== false,
    nudgeMs: Math.round(num(v.nudge, 0, -300, 300)),
    minGapMs: Math.round(num(v.minGap, MIN_GAP_DEFAULT, 0, 1000)),
    own: v.own !== false,
    moanEvery: oneOf(v.moanEvery, ['rare', 'some', 'often'] as const, 'some'),
  }
}

/**
 * What keeps it quiet while "Only when nothing else makes sound" is on:
 * sound coming out of the player here ('sound'; not known yet counts, so
 * nothing plays over a video's own sound while that's found out), or a
 * video playing in a headset, with its sound there ('headset'). Null: it
 * may play.
 */
export function heldBy(s: Pick<PlayerSnapshot, 'playing' | 'external' | 'audible'>): 'sound' | 'headset' | null {
  if (!s.playing)
    return null
  if (s.external)
    return 'headset'
  return s.audible === false ? null : 'sound'
}

/** What the settings form needs to know that isn't a setting: the sets, your sounds, and the shortcut that was free. */
export interface FormState {
  key: string | null
  own: Record<'slap' | 'wet' | 'moan', string[]>
  sets: { id: string, name: string }[]
  /** There's a wet loop to play (the set's or yours): the Wet or slap mix means something. */
  wet: boolean
  /** The set has pops for the top. */
  pops: boolean
}

/** The names of a slot's sounds, as a hint. */
export function listHint(names: string[], none: string): string {
  if (!names.length)
    return none
  const shown = names.slice(0, 4).join(', ')
  return `${names.length === 1 ? '1 sound' : `${names.length} sounds`}: ${shown}${names.length > 4 ? `, and ${names.length - 4} more` : ''}.`
}

type Done = Promise<string | void> | string | void
/** What the buttons do: a plain button gets the values, an Add button the files picked. */
export interface Runs {
  hear: (v: Record<string, unknown>) => Done
  addSlap: (files: File[]) => Done
  addWet: (files: File[]) => Done
  addMoan: (files: File[]) => Done
  clearSlap: () => Done
  clearWet: () => Done
  clearMoan: () => Done
}

/**
 * The settings form. The buttons' `run` are filled in by index.ts (they
 * need the plugin's state); here they're placeholders, so the form can be
 * built and tested on its own.
 */
export function fields(state: FormState, run: Partial<Runs>): SettingField[] {
  const btn = (key: Exclude<keyof Runs, 'addSlap' | 'addWet' | 'addMoan'>) => run[key] ?? (() => {})
  const add = (key: 'addSlap' | 'addWet' | 'addMoan') => run[key] ?? (() => {})
  const any = state.own.slap.length + state.own.wet.length + state.own.moan.length > 0
  return [
    {
      key: 'enabled',
      type: 'switch',
      label: 'Stroke sounds',
      hint: state.key ? `Also ${state.key}, or "Stroke sounds on or off" in the command palette (Ctrl K).` : 'Also "Stroke sounds on or off" in the command palette (Ctrl K).',
      default: true,
    },
    { key: 'volume', type: 'slider', label: 'Volume', hint: 'Their own volume, apart from the video\'s.', min: 0, max: 100, step: 5, unit: '%', default: 70 },
    {
      key: 'set',
      type: 'select',
      label: 'Sounds',
      options: state.sets.map(s => ({ value: s.id, label: s.name })),
      default: state.sets[0]?.id ?? '',
      when: () => state.sets.length > 1,
    },
    { key: 'hear', type: 'button', label: 'A few strokes, slow to fast, with these sounds', text: 'Hear them', run: btn('hear') },
    { key: 'balance', type: 'slider', label: 'Wet or slap', hint: '0%: only the wet loop. 100%: only the slaps. 50%: both.', min: 0, max: 100, step: 5, unit: '%', default: 50, when: () => state.wet },
    { key: 'tops', type: 'switch', label: 'A wet pop at the top', hint: 'Now and then, as the stroke turns at the top. The slap is at the bottom.', default: true, when: () => state.pops },
    {
      key: 'onlySilent',
      type: 'switch',
      label: 'Only when nothing else makes sound',
      hint: 'Quiet while a video or a song plays here with its sound on, and while a video plays in a headset (HereSphere, DeoVR), which has its sound there. A muted video, a clip with no sound, the slideshow, the media wall and motion with nothing playing get the sounds. Off: they play over anything.',
      default: true,
    },

    { type: 'heading', label: 'Timing' },
    {
      key: 'nudge',
      type: 'slider',
      label: 'Sooner or later',
      hint: 'If the slaps land before the picture (below 0: sooner) or after it. They follow the video itself, not the device, and allow for your speakers\' own delay as far as the browser knows it; Bluetooth headphones may need some sooner.',
      min: -300,
      max: 300,
      step: 10,
      unit: ' ms',
      default: 0,
    },
    {
      key: 'minGap',
      type: 'slider',
      label: 'Least time between slaps',
      hint: 'A stroke that ends sooner than this after the last slap makes none: for scripts that vibrate or bounce, where every little turn would slap. 0: every stroke slaps.',
      min: 0,
      max: 500,
      step: 10,
      unit: ' ms',
      default: MIN_GAP_DEFAULT,
    },

    { type: 'heading', label: 'Your own sounds', hint: 'Audio files of your own: WAV, MP3, OGG, FLAC, M4A. Kept in playhound, levelled like the built-in ones.' },
    { key: 'addSlap', type: 'file', label: listHint(state.own.slap, 'Slaps, for the end of each stroke: none yet.'), text: 'Add slaps…', accept: ACCEPT, multiple: true, run: add('addSlap') },
    { key: 'clearSlap', type: 'button', label: 'Remove your slaps', text: 'Remove', tone: 'danger', run: btn('clearSlap'), when: () => state.own.slap.length > 0 },
    { key: 'addWet', type: 'file', label: listHint(state.own.wet, 'A wet loop, for while it moves: none yet.'), text: 'Add wet loops…', accept: ACCEPT, multiple: true, run: add('addWet') },
    { key: 'clearWet', type: 'button', label: 'Remove your wet loops', text: 'Remove', tone: 'danger', run: btn('clearWet'), when: () => state.own.wet.length > 0 },
    { key: 'addMoan', type: 'file', label: listHint(state.own.moan, 'Moans, now and then at the peaks: none yet.'), text: 'Add moans…', accept: ACCEPT, multiple: true, run: add('addMoan') },
    { key: 'clearMoan', type: 'button', label: 'Remove your moans', text: 'Remove', tone: 'danger', run: btn('clearMoan'), when: () => state.own.moan.length > 0 },
    {
      key: 'moanEvery',
      type: 'select',
      label: 'Moans',
      options: [
        { value: 'rare', label: 'Rarely: at the hardest moments' },
        { value: 'some', label: 'Sometimes' },
        { value: 'often', label: 'Often' },
      ],
      default: 'some',
      when: () => state.own.moan.length > 0,
    },
    { key: 'own', type: 'switch', label: 'Use your sounds', hint: 'Your slaps, wet loops and moans play in place of the set\'s. Off: only the set\'s.', default: true, when: () => any },
  ]
}
