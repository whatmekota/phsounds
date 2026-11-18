// Builds dist/index.js (one self-contained ES module) and phsounds.zip
// (manifest.json, index.js and the icon at the root, the sound sets under
// sounds/, deflated).
//   node build.mjs [--minify] [--public]
// --public writes release/phsounds-<version>.zip, release/manifest.json and
// release/icon.svg instead: the files a GitHub release needs.
// Each folder in sounds/ is a set (see src/sets.ts): files right in it are
// slaps; its wet/, pop/ and moan/ folders hold the other kinds. They're
// listed in src/shipped.ts, written here, and packed as
// sounds/<set>/<kind>-<n>.<ext>.
// manifest.json here points `main` at dist/index.js, so playhound's dev mode
// (Load from folder) runs the build straight from this folder; the zip's
// manifest points it at index.js, where the module sits in the zip.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const esbuild = await import('esbuild')

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
const zipped = `${JSON.stringify({ ...manifest, main: 'index.js' }, null, 2)}\n`

// ─── The sound sets ─────────────────────────────────────────────────────────
const AUDIO = new Set(['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.webm'])
const ROLES = ['slap', 'wet', 'pop', 'moan']
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set'
const soundsDir = join(here, 'sounds')
const sets = []
/** [path in the zip, file on disk]. */
const packed = []
for (const folder of (existsSync(soundsDir) ? readdirSync(soundsDir) : []).sort(byName)) {
  const dir = join(soundsDir, folder)
  if (!statSync(dir).isDirectory())
    continue
  let id = slug(folder)
  while (sets.some(s => s.id === id))
    id += '-2'
  const files = {}
  for (const role of ROLES) {
    const from = role === 'slap' ? dir : join(dir, role)
    const list = existsSync(from) && statSync(from).isDirectory()
      ? readdirSync(from).filter(f => AUDIO.has(extname(f).toLowerCase()) && statSync(join(from, f)).isFile()).sort(byName)
      : []
    files[role] = list.map((f, i) => {
      const path = `sounds/${id}/${role}-${i + 1}${extname(f).toLowerCase()}`
      packed.push([path, join(from, f)])
      return path
    })
  }
  if (!ROLES.some(r => files[r].length))
    continue
  sets.push({ id, name: folder.charAt(0).toUpperCase() + folder.slice(1), files })
}
writeFileSync(join(here, 'src/shipped.ts'), `// Written by build.mjs from the folders in sounds/: don't edit, rebuild.
import type { ShippedSet } from './sets'

export const SHIPPED: ShippedSet[] = ${JSON.stringify(sets, null, 2)}
`)

await esbuild.build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: join(here, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  minify: process.argv.includes('--minify'),
  banner: { js: `// phsounds ${manifest.version}` },
  logLevel: 'warning',
})

// ─── zip (deflate, no zip64) ─────────────────────────────────────────────────
function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const time = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

mkdirSync(join(here, 'dist'), { recursive: true })
const out = zip([
  ['manifest.json', Buffer.from(zipped, 'utf8')],
  ['index.js', readFileSync(join(here, 'dist/index.js'))],
  // The icon, for the installed list when it's installed from the zip.
  ['icon.svg', readFileSync(join(here, 'icon.svg'))],
  // The sets' sounds, reached with ctx.asset.
  ...packed.map(([path, file]) => [path, readFileSync(file)]),
])
let file = 'phsounds.zip'
if (process.argv.includes('--public')) {
  mkdirSync(join(here, 'release'), { recursive: true })
  file = join('release', `phsounds-${manifest.version}.zip`)
  // The store in playhound reads these to show the plugin before downloading it.
  writeFileSync(join(here, 'release', 'manifest.json'), zipped)
  writeFileSync(join(here, 'release', 'icon.svg'), readFileSync(join(here, 'icon.svg')))
}
writeFileSync(join(here, file), out)
const what = s => ROLES.filter(r => s.files[r].length).map(r => `${s.files[r].length} ${r}`).join(', ')
console.log(`${file}: ${out.length} bytes (v${manifest.version}); sets: ${sets.map(s => `${s.name} (${what(s)})`).join('; ') || 'none'}`)
