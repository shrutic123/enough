// A dry paper rustle, synthesized so the app ships no audio file. One short
// burst of filtered noise grains, only ever played when a cut is confirmed.
let context: AudioContext | null = null
let noise: AudioBuffer | null = null

type AudioContextCtor = typeof AudioContext

const SOUND_KEY = 'enough.sound'

/** The toggle is a preference, so a blocked storage read still plays sound. */
export function readSoundPreference(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

/** A blocked write is not worth an error; the toggle still works this session. */
export function writeSoundPreference(
  storage: Pick<Storage, 'setItem'> | null,
  on: boolean,
): void {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // Ignore; the in-memory state has already changed.
  }
}

/** Reading `window.localStorage` itself can throw in locked-down browsers. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!ctor) return null

  if (!context) context = new ctor()
  return context
}

/** Call from a user gesture so the browser lets the context start. */
export function primeCrumpleSound(): Promise<void> {
  const audio = audioContext()
  if (!audio) return Promise.resolve()

  const ready = audio.state === 'suspended' ? audio.resume() : Promise.resolve()

  return ready
    .catch(() => {
      // A browser that refuses to resume still leaves the toggle working; the
      // next Cut will try again.
    })
    .then(() => {
      if (!noise) {
        const frames = Math.floor(audio.sampleRate * 0.3)
        noise = audio.createBuffer(1, frames, audio.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < frames; i += 1) {
          data[i] = (Math.random() * 2 - 1) * 0.8
        }
      }
    })
}

/** `level` scales the whole gesture; the toggle preview uses less than a cut. */
export function playCrumpleSound(level = 1): void {
  const audio = audioContext()
  if (!audio || !noise) return

  if (audio.state === 'suspended') {
    // The cut's click already primed the context; if it is still waking up,
    // let it finish rather than dropping the sound.
    void audio.resume().then(() => {
      if (audio.state === 'running') playCrumpleSound(level)
    })
    return
  }

  if (audio.state !== 'running') return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

  const now = audio.currentTime
  const master = audio.createGain()
  // A crumple is quiet by nature: a dense, dry crackle, not a warning.
  master.gain.value = 0.22 * level
  master.connect(audio.destination)

  // A short room tail keeps the snaps from sounding synthetic, matching the
  // auditioned candidate the user chose.
  const bus = audio.createGain()
  bus.connect(master)
  for (const [delay, amount] of [[0.009, 0.5], [0.017, 0.32], [0.031, 0.18]]) {
    const node = audio.createDelay(0.1)
    node.delayTime.value = delay
    const gain = audio.createGain()
    gain.gain.value = amount * 0.25
    bus.connect(node)
    node.connect(gain)
    gain.connect(master)
  }

  /** One short filtered-noise grain. Tiny durations are what make it crinkle. */
  const grain = (at: number, dur: number, freq: number, q: number, peak: number) => {
    const source = audio.createBufferSource()
    source.buffer = noise
    source.loop = true
    source.playbackRate.value = 0.8 + Math.random() * 0.5

    const band = audio.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = freq
    band.Q.value = q

    const envelope = audio.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(peak, at + 0.0004)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + dur)

    source.connect(band)
    band.connect(envelope)
    envelope.connect(bus)

    source.start(at)
    source.stop(at + dur + 0.01)
  }

  // A real crumple is a dense series of tiny snaps, not a wash. Times bunch
  // toward the start, with quieter snaps as the sheet becomes a ball.
  const count = 150
  for (let i = 0; i < count; i += 1) {
    const t = Math.pow(Math.random(), 1.5) * 0.36
    const fade = 1 - 0.55 * (t / 0.36)
    grain(
      now + t,
      0.0015 + Math.pow(Math.random(), 3) * 0.006,
      1500 + Math.random() * 5500,
      2 + Math.random() * 6,
      (0.12 + Math.random() * 0.75) * fade,
    )
  }

  // A few slightly longer folds give the burst a beginning and an end to hear.
  for (let i = 0; i < 4; i += 1) {
    grain(
      now + 0.02 + Math.random() * 0.2,
      0.012 + Math.random() * 0.014,
      900 + Math.random() * 900,
      1.1,
      0.16,
    )
  }
}
