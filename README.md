# phsounds

**18+ only.** Sex sounds for [playhound](https://github.com/whatmekota/playhound), in time with the stroke: a wet slap at the bottom of each stroke, and your own wet loops and moans if you add some. Louder and harder the faster and deeper it goes; nothing when it's still. Made for what has no sound of its own: a muted or silent video, the slideshow, the media wall, hypno, motion with no video, a VR video with the sound off. It works over anything too, with its own volume.

Needs playhound **2.2.8** or newer (plugin API 7), in the desktop app or a browser.

## Install

Not in the store. Build it (below), then in playhound: **Settings → Plugins**, and drop `phsounds.zip` on that page. Or, while working on it, **Load from folder…** this folder: `manifest.json` points at `dist/index.js`, and a rebuild reloads it.

It asks for two permissions:

- **See what is playing, where**: where the video is, to put each slap on its stroke as the picture shows it; whether sound comes out of the player already; the stroke as it's sent, when no script plays; the intensity knob and edges.
- **Read the loaded scripts**: the stroke script, to know each stroke before it comes.

## What it follows

Whatever moves the stroke:

- **A script playing with the video.** Every stroke is known ahead, so each sound is set up a moment early and lands when its stroke is on screen. Your device is sent its moves early, by your latency setting, so that it arrives with the picture; the sounds follow the picture itself, so they don't come early with it. They also allow for your speakers' own delay, as far as the browser knows it.
- **Motion without a script**: a pattern, the music, the phone remote, a plugin. The stroke generator says where it is in its stroke, so the slap at the bottom is set up just before it comes. Its shape counts: a saw's quick drop slaps harder than a pulse's slow fall. The pop at the top is heard as it turns.
- **Anything else that moves the stroke**, as it's sent. Each position comes with when the device should be there, and a slap is set for when the device turns. A quick, sharp stroke's lands on time; a slow, round one's comes a little late, as a turn is known only once it has turned. The slap is at the bottom of the stroke as it's meant, whatever your device's range and invert.

The status under its name in Settings → Plugins says which ("Following the script").

## The sounds

The sounds are recordings. It comes with one set, **Wet plaps**: wet slaps, eight takes of them. A harder stroke picks from the louder takes, and each is pitched and placed a little differently each time, so no two strokes sound quite the same. **Hear them** plays a few strokes, slow to fast.

How a stroke sounds:

- At the **bottom**, a slap. A faster, deeper stroke is louder and brighter; a slow one is softer and duller. A flick that hardly moves is silent.
- While it **moves**, a wet loop, if there is one (yours, or a set's): louder and a touch faster the faster it goes, quiet when it stops.
- At the **top**, now and then, a pop, if the set has some (**A wet pop at the top**).
- The **intensity knob** turns them down with everything else, and an edge backs them off too.

**Wet or slap** (when there's a wet loop): 0% plays only the loop, 100% only the slaps, 50% both.

## Your own sounds

Under **Your own sounds** in its settings, **Add slaps…**, **Add wet loops…** and **Add moans…** open the file dialog; pick one file or several (WAV, MP3, OGG, FLAC, M4A; up to 12 MB each, 24 a kind):

- **Slaps** play at the bottom of each stroke in place of the set's, one at random each time. The silence before each is skipped, so it lands on time.
- **Wet loops** play while it moves: louder and a touch faster the faster it goes, quiet when it stops. A different one of yours each time the movement starts again.
- **Moans** play now and then at the peaks: on a hard stroke after a stretch of hard ones, never two at once. **Moans** sets how often (rarely, sometimes, often).

They're kept in playhound (the files themselves), and levelled like the built-in ones, so a quiet recording and a loud one come out alike. **Remove** forgets a slot's sounds; **Use your sounds** off plays only the set's.

## Adding a set

Each folder in `sounds/` is a set, named after the folder. Files right in it are its slaps; it can also have a `wet/` folder of wet loops, a `pop/` folder of pops for the top, and a `moan/` folder of moans:

    sounds/
      wet plaps/
        *.wav        slaps
        wet/         wet loops (optional)
        pop/         pops (optional)
        moan/        moans (optional)

`npm run build` lists them in `src/shipped.ts` and packs them in the zip. With more than one set, **Sounds** in the settings picks one. Short WAVs are fine; a long loop is smaller as MP3 or OGG.

## When it plays

- **Only when nothing else makes sound** (on by default): quiet while a video or a song plays here with its sound on, and while a video plays in a headset (HereSphere, DeoVR), which has its sound there. A muted video, one with no sound track, the volume all the way down, the slideshow, the media wall and motion with nothing playing get the sounds. For a headset video with no sound, switch it off. The first moment of a video counts as sound, until playhound can tell.
- **Esc** (panic) silences it at once. It follows again when the panic is lifted.
- **Paused** or **seeking**: what was set up for the old place is called off. Nothing plays for the strokes skipped.
- **Shift+U** turns it on and off (or **Stroke sounds on or off** in the command palette, Ctrl K). If another plugin has Shift+U it takes Alt+U, or Alt+Shift+U; the setting's hint says which.
- After a minute with nothing moving it stops its audio clock, until something moves.

## Achievements

A few of its own, in **Stats → Achievements** under its name: the first slap heard, 1,000 and 10,000 of them, a sound of your own added, and one kept secret. Only strokes it follows count, not **Hear them**.

## Settings

In **Settings → Plugins → Stroke sounds**: on or off, the volume (its own, apart from the video's), the set (when there's more than one) and **Hear them**, **Wet or slap** and the pop at the top (when there's something for them to do), and **Only when nothing else makes sound**. Under **Timing**, **Sooner or later** (−300 to +300 ms), if the slaps land off the picture on your speakers; Bluetooth headphones may need some sooner. And **Your own sounds**.

## Privacy

It reads what plays, the loaded script and the stroke. It keeps its settings, your sounds and a count of the slaps it has played in playhound's plugin storage, and sends nothing anywhere.

## Build

    npm install
    npm run build      # dist/index.js and phsounds.zip
    npm test
    npm run typecheck

`src/types.ts` is a copy of playhound's plugin contract (`src/plugins/types.ts`); keep it in step.

## License

MIT. The sounds in `sounds/` were made for it by its author.
