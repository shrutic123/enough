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
export function primeCrumpleSound(): void {
  const audio = audioContext()
  if (!audio) return

  if (audio.state === 'suspended') void audio.resume()

  if (!noise) {
    const frames = Math.floor(audio.sampleRate * 0.2)
    noise = audio.createBuffer(1, frames, audio.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.7
    }
  }
}

export function playCrumpleSound(): void {
  const audio = audioContext()
  if (!audio || !noise || audio.state !== 'running') return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

  const now = audio.currentTime
  const master = audio.createGain()
  master.gain.value = 0.045
  master.connect(audio.destination)

  // Four grains at slightly different bands read as one sheet being crushed.
  const grains = [
    { at: 0, dur: 0.055, freq: 2100 },
    { at: 0.045, dur: 0.06, freq: 2600 },
    { at: 0.095, dur: 0.07, freq: 1800 },
    { at: 0.145, dur: 0.05, freq: 3100 },
  ]

  for (const grain of grains) {
    const source = audio.createBufferSource()
    source.buffer = noise
    source.loop = true
    source.playbackRate.value = 0.9 + Math.random() * 0.25

    const band = audio.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = grain.freq + Math.random() * 300
    band.Q.value = 0.8

    const high = audio.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 700

    const gain = audio.createGain()
    const start = now + grain.at
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.9, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + grain.dur)

    source.connect(band)
    band.connect(high)
    high.connect(gain)
    gain.connect(master)

    source.start(start)
    source.stop(start + grain.dur + 0.03)
  }
}
