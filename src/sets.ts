/**
 * The sound sets that come with the plugin: recordings, one folder each in
 * sounds/ (build.mjs lists them in shipped.ts and packs them in the zip).
 *
 *   sounds/<set>/*        slaps, for the bottom of each stroke
 *   sounds/<set>/wet/*    wet loops, for while it moves (optional)
 *   sounds/<set>/pop/*    pops, for the top now and then (optional)
 *   sounds/<set>/moan/*   moans, for the peaks (optional)
 *
 * The folder's name is the set's name. Your own sounds (own.ts) play in place
 * of a set's, kind by kind.
 */

export const ROLES = ['slap', 'wet', 'pop', 'moan'] as const
export type Role = typeof ROLES[number]

export interface ShippedSet {
  /** The folder's name made safe for a path ("wet-plaps"), kept in the settings. */
  id: string
  /** The folder's name, first letter up ("Wet plaps"). */
  name: string
  /** Paths in the zip, for ctx.asset, by role. */
  files: Record<Role, string[]>
}

/** How the sets are played: the same for each, as they're levelled alike. */
export const MIX = {
  /** The whole set's gain. */
  level: 1,
  /** The share of tops that get a pop: a suction lets go now and then, not every stroke. */
  popChance: 0.4,
  /** How much goes to the room (a short reverb), so the dry takes sit somewhere. */
  room: 0.1,
  /** A slap is low-passed at this for the softest stroke and at hardHz for the hardest. */
  softHz: 3000,
  hardHz: 18000,
}
export type Mix = typeof MIX
