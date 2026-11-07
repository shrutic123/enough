import test from 'node:test'
import assert from 'node:assert/strict'
import {
  browserStorage,
  readSoundPreference,
  writeSoundPreference,
} from '../src/lib/sound.ts'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    value(key) {
      return values.get(key) ?? null
    },
  }
}

test('sound is on when nothing has been stored', () => {
  assert.equal(readSoundPreference(memoryStorage()), true)
})

test('a stored off preference survives a reload', () => {
  assert.equal(readSoundPreference(memoryStorage({ 'enough.sound': 'off' })), false)
})

test('turning sound off writes the preference', () => {
  const storage = memoryStorage()
  writeSoundPreference(storage, false)
  assert.equal(storage.value('enough.sound'), 'off')
  assert.equal(readSoundPreference(storage), false)
})

test('turning sound on writes the preference', () => {
  const storage = memoryStorage({ 'enough.sound': 'off' })
  writeSoundPreference(storage, true)
  assert.equal(storage.value('enough.sound'), 'on')
  assert.equal(readSoundPreference(storage), true)
})

test('a blocked storage read falls back to sound on', () => {
  const storage = {
    getItem() {
      throw new Error('storage blocked')
    },
  }
  assert.equal(readSoundPreference(storage), true)
})

test('a blocked storage write does not throw', () => {
  const storage = {
    setItem() {
      throw new Error('storage blocked')
    },
  }
  assert.doesNotThrow(() => writeSoundPreference(storage, false))
})

test('no storage at all still reads as sound on', () => {
  assert.equal(readSoundPreference(null), true)
  assert.doesNotThrow(() => writeSoundPreference(null, false))
})

test('browser storage is absent outside a browser', () => {
  assert.equal(browserStorage(), null)
})
