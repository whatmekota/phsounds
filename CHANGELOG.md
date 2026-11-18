# Changelog

## 0.2.0

For playhound 2.2.8 and newer (plugin API 7). Not published.

- **The stroke as it's sent** comes in by itself, every position, with when the device should be there, instead of being looked at every 15 ms. A turn is played the moment it's seen, or when the device is meant to turn if that's later: a quick, sharp stroke's slap lands on time, and none comes early. An inverted device no longer puts the slaps at the top: the positions are the stroke as meant.
- **Knows when there's sound already**: playhound now says whether sound comes out of the player (muted, the volume, a video with no sound track), in place of its own guess from the video. Until it can tell, a video counts as sound: a moment for most, a few seconds for a small, low-bitrate one. A video in a headset (HereSphere, DeoVR) is told apart now: it counts as sound, as it plays there, and the status says "Quiet: the headset has the sound". For one with no sound, switch **Only when nothing else makes sound** off.
- **The generator's shape**: a saw's quick drop slaps harder than a pulse's slow fall.
- **When the stroke runs ahead of the picture** (an axis linked to a script), a slap read off it waits for the picture, by your device latency.
- **Add slaps…**, **Add wet loops…** and **Add moans…** are playhound's own file buttons now.
- **Achievements**: five of its own, in Stats → Achievements. The first slap, 1,000 and 10,000 slaps, a sound of your own, and a secret one. Only strokes it follows count.

## 0.1.0

First version, for playhound 2.2.6 and newer (plugin API 6). Not published.

- **Sounds in time with the stroke**: a wet slap at the bottom of each stroke; a wet loop while it moves and a pop at the top now and then, where there are some. Louder and brighter the faster and deeper; silent when it's still. They follow the intensity knob, and back off during an edge.
- **Follows whatever moves the stroke**: a script with the video (set up ahead, to land with the picture rather than early with the device's latency), the stroke generator (from its phase, a moment ahead), or the stroke as it's sent.
- **Recorded sounds only**: one set, **Wet plaps**, eight takes of a wet slap, a harder stroke picking a louder one. Each folder in `sounds/` is a set (slaps, and optional wet loops, pops and moans), packed by the build. **Hear them** plays a few strokes.
- **Wet or slap** (with a wet loop), its own **volume**, and **Sooner or later** for the timing.
- **Your own sounds**: slaps, wet loops, and moans at the peaks, added from the settings, kept in playhound, levelled to the rest.
- **Only when nothing else makes sound** (on by default): quiet while what plays has a sound of its own.
- Panic silences it at once; a pause or a seek calls off what was coming. **Shift+U** (or the command palette) turns it on and off.
