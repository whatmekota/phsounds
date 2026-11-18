/**
 * A few strokes to hear a set by: slow and full, quicker, fast, then quick
 * short ones. "Hear them" in the settings plays it.
 */
export function demoScript(long = false): { at: number, pos: number }[] {
  const acts: { at: number, pos: number }[] = []
  let t = 0
  const run = (n: number, half: number, lo: number, hi: number) => {
    for (let i = 0; i < n; i++) {
      acts.push({ at: t, pos: hi })
      t += half
      acts.push({ at: t, pos: lo })
      t += half
    }
  }
  if (long) {
    t = 300
    run(3, 500, 0, 100) // 60 strokes a minute, full
    run(5, 300, 5, 95) // 100 a minute
    run(10, 160, 0, 100) // 190 a minute, full
    run(10, 90, 30, 60) // quick short flicks
  }
  else {
    run(2, 550, 0, 100)
    run(3, 320, 5, 95)
    run(7, 170, 0, 100)
    run(4, 110, 25, 65)
  }
  acts.push({ at: t, pos: 60 })
  acts.push({ at: t + 1500, pos: 60 })
  return acts
}
