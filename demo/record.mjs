#!/usr/bin/env node
// Records a ~60 second demo of Enough running against a deployed URL.
//
//   DEMO_MODE=fixture npm run demo:record
//   DEMO_MODE=live    npm run demo:record      # needs demo/.auth/state.json
//
// Fixture mode intercepts /api/* in the browser: the page is the real
// production build, but no Buffer data is read or deleted. Live mode uses a
// saved production session and performs real Keep, Cut and createPost calls.
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEMO_DRAFT,
  buildChannels,
  buildQueue,
  buildSession,
  trimFixture,
} from './fixtures.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.resolve(ROOT, process.env.DEMO_OUT || 'demo/artifacts')
const STATE_PATH = path.resolve(
  ROOT,
  process.env.DEMO_STORAGE_STATE || 'demo/.auth/state.json',
)
const BASE_URL = (process.env.DEMO_URL || 'https://enough-nu-flame.vercel.app').replace(
  /\/+$/,
  '',
)
const TARGET_SECONDS = clamp(Number(process.env.DEMO_SECONDS || 60), 30, 180)
const MAX_CARDS = clamp(Number(process.env.DEMO_CARDS || 6), 1, 20)
const HOLD_UNTIL = TARGET_SECONDS - 1
const QUEUE_END = Math.min(35, HOLD_UNTIL * 0.6)
const DECISIONS = (process.env.DEMO_DECISIONS || 'cut,keep,cut,keep,cut,keep')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value === 'cut' || value === 'keep')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function log(message) {
  console.log(`[${elapsed().toFixed(1)}s] ${message}`)
}

let startedAt = Date.now()
const elapsed = () => (Date.now() - startedAt) / 1000

function readSeconds(text) {
  const words = text.split(/\s+/).filter(Boolean).length
  return clamp(1.0 + words * 0.075, 2.0, 6.5)
}

async function resolveMode() {
  const requested = (process.env.DEMO_MODE || 'auto').toLowerCase()
  if (requested === 'fixture' || requested === 'live') return requested
  if (requested !== 'auto') {
    throw new Error(`DEMO_MODE must be auto, fixture or live (got "${requested}")`)
  }
  try {
    await fs.access(STATE_PATH)
    return 'live'
  } catch {
    return 'fixture'
  }
}

// A white ring with a graphite centre. Playwright's mouse events are real, so
// the dot follows every move; without it the recording looks like magic.
const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById('__enough_demo_cursor')) return

    const dot = document.createElement('div')
    dot.id = '__enough_demo_cursor'
    dot.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:18px',
      'height:18px',
      'margin:-9px 0 0 -9px',
      'border-radius:50%',
      'background:rgba(27,35,40,.92)',
      'border:2px solid rgba(255,255,255,.96)',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)',
      'pointer-events:none',
      'z-index:2147483647',
      'transform:translate3d(960px,540px,0)',
      'transition:transform 70ms linear, scale 80ms ease',
    ].join(';')
    document.documentElement.appendChild(dot)

    let x = 960
    let y = 540

    window.addEventListener(
      'mousemove',
      (event) => {
        x = event.clientX
        y = event.clientY
        dot.style.transform = `translate3d(${x}px, ${y}px, 0)`
      },
      { capture: true, passive: true },
    )

    window.addEventListener(
      'mousedown',
      () => {
        dot.style.scale = '.72'
        const ring = document.createElement('div')
        ring.style.cssText = [
          'position:fixed',
          `left:${x}px`,
          `top:${y}px`,
          'width:18px',
          'height:18px',
          'margin:-9px 0 0 -9px',
          'border-radius:50%',
          'border:2px solid rgba(47,75,255,.85)',
          'pointer-events:none',
          'z-index:2147483646',
        ].join(';')
        document.documentElement.appendChild(ring)
        ring
          .animate(
            [
              { transform: 'scale(.6)', opacity: 0.9 },
              { transform: 'scale(2.6)', opacity: 0 },
            ],
            { duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)' },
          )
          .addEventListener('finish', () => ring.remove())
      },
      { capture: true },
    )

    window.addEventListener(
      'mouseup',
      () => {
        dot.style.scale = '1'
      },
      { capture: true },
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
}

async function installFixtureRoutes(context) {
  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname

    try {
      if (pathname === '/api/buffer/session') {
        return await route.fulfill({ json: buildSession() })
      }
      if (pathname === '/api/buffer/channels') {
        await sleep(250)
        return await route.fulfill({ json: buildChannels() })
      }
      if (pathname === '/api/buffer/queue') {
        await sleep(450)
        return await route.fulfill({ json: buildQueue() })
      }
      if (pathname === '/api/buffer/cut') {
        await sleep(320)
        return await route.fulfill({ json: { ok: true } })
      }
      if (pathname === '/api/ai/essence') {
        const body = request.postDataJSON()
        await sleep(1150)
        return await route.fulfill({
          json: { trimmed: trimFixture(String(body?.text || '')) },
        })
      }
      if (pathname === '/api/buffer/create') {
        const body = request.postDataJSON()
        await sleep(900)
        return await route.fulfill({
          json: {
            post: {
              id: 'demo-created',
              text: body?.text,
              status: body?.kind === 'draft' ? 'draft' : 'scheduled',
              dueAt: null,
              channelId: body?.channelId,
              schedulingType: 'automatic',
            },
          },
        })
      }
      return await route.fulfill({
        status: 404,
        json: { error: `Fixture mode has no response for ${pathname}` },
      })
    } catch (error) {
      return route.abort().catch(() => {})
    }
  })
}

async function run(page) {
  const state = await waitForScreen(page, 60_000)

  if (state.kind === 'alert') {
    throw new Error(`The deployment showed an error: ${state.text}`)
  }
  if (state.kind === 'connect') {
    throw new Error(
      'Production is showing the Connect screen. The saved session is missing or expired. ' +
        'Run `npm run demo:capture -- <production-url>` and update the DEMO_STORAGE_STATE secret.',
    )
  }
  if (state.kind === 'empty') {
    throw new Error(
      'The queue is empty. Seed 5-6 posts in the demo Buffer account, or use DEMO_MODE=fixture.',
    )
  }
  if (state.kind === 'end') {
    throw new Error('The queue is already cleared, so there is nothing to review.')
  }

  log('queue is ready')

  // Let the first card sit still so the viewer can read it.
  await pause(1.6)

  let reviewed = 0
  let reachedEnd = false

  while (reviewed < MAX_CARDS) {
    const card = page.locator('article.card').first()
    if (!(await isVisible(card))) {
      reachedEnd = (await isVisible(page.locator('.enough').first()))
      break
    }

    const text = (await page.locator('article.card .card-text').first().innerText()).trim()
    const decision = DECISIONS[reviewed % DECISIONS.length] || 'keep'
    const words = text.split(/\s+/).filter(Boolean).length
    const left = await leftCount(page)
    log(`card ${reviewed + 1}/${MAX_CARDS}: ${words} words, ${left ?? '?'} left, ${decision}`)

    const budget = QUEUE_END - elapsed()
    if (budget < 3.2) {
      log('queue time budget spent; moving to Essence')
      break
    }

    // Rest the pointer on the card while the text is being read.
    const box = await card.boundingBox()
    if (box) {
      await page.mouse.move(
        box.x + box.width * 0.42,
        box.y + box.height * 0.34,
        { steps: 20 },
      )
    }
    await pause(Math.min(readSeconds(text), Math.max(1.0, budget - 2.2)))

    const button = page
      .locator('article.card .actions button')
      .filter({ hasText: decision === 'keep' ? 'Keep' : 'Cut' })
      .first()

    if (!(await isVisible(button))) throw new Error('The card has no Keep/Cut action.')

    const before = await liveText(page)
    await click(page, button)
    await waitForAdvance(page, before, decision)
    reviewed += 1

    if (await isVisible(page.locator('.enough').first())) {
      reachedEnd = true
      break
    }
  }

  // The last decision may have cleared the queue while the budget check was
  // ending the loop. Treat that as the end screen so the closing shot is right.
  if (!reachedEnd && (await isVisible(page.locator('.enough').first()))) {
    reachedEnd = true
  }

  if (reachedEnd) {
    await parkCursor(page)
    log('queue cleared')
    await pause(2.2)
  } else {
    log(`stopped after ${reviewed} card(s); opening Essence from the queue`)
  }

  // Essence: paste, trim, keep the destination as a draft, send.
  const trimEntry = page.getByRole('button', { name: 'Trim a draft' }).first()
  if (!(await isVisible(trimEntry))) throw new Error('Could not find "Trim a draft".')
  await click(page, trimEntry)

  await page.locator('#essence-draft').waitFor({ state: 'visible', timeout: 15_000 })
  log('Essence is ready')

  await click(page, page.locator('#essence-draft'))
  await page.locator('#essence-draft').fill(DEMO_DRAFT)
  await pause(1.1)

  const trim = page.getByRole('button', { name: /^Trim/ }).first()
  const beforeTrim = Date.now()
  await click(page, trim)
  await waitForEssenceResult(page)
  log(`trim finished in ${((Date.now() - beforeTrim) / 1000).toFixed(1)}s`)

  const resultPause = clamp(52 - elapsed(), 0.6, 2.2)
  await pause(resultPause)

  await page.locator('#essence-destination').selectOption('draft')
  await pause(0.7)

  await click(page, page.getByRole('button', { name: /^Send to Buffer/ }).first())
  await waitForSent(page)
  log('saved as a draft')
  await parkCursor(page)

  await pause(clamp(56 - elapsed(), 0.8, 2.4))

  if (reachedEnd) {
    const back = page.getByRole('button', { name: 'Back to the queue' }).first()
    if (await isVisible(back)) {
      await click(page, back)
      await page.locator('.enough').first().waitFor({ state: 'visible', timeout: 15_000 })
      await parkCursor(page)
      log('back on the end screen')
    }
  }

  await holdUntil(HOLD_UNTIL, page)
  log(`recording length ${elapsed().toFixed(1)}s`)
}

async function waitForScreen(page, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const alert = page.locator('main [role="alert"]').first()
    if (await isVisible(alert)) {
      const text = (await alert.innerText().catch(() => '')).trim()
      if (text) return { kind: 'alert', text }
    }
    if (await isVisible(page.locator('article.card').first())) return { kind: 'queue' }
    if (await isVisible(page.locator('.enough').first())) return { kind: 'end' }
    if (await isVisible(page.getByText('Nothing scheduled.', { exact: true }))) {
      return { kind: 'empty' }
    }
    if (await isVisible(page.getByText('Connect Buffer', { exact: true }))) {
      return { kind: 'connect' }
    }
    await page.waitForTimeout(200)
  }
  throw new Error(
    'The app did not reach a known screen in 60s. Check the deployment URL, session and network.',
  )
}

async function waitForAdvance(page, before, decision) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const error = page.locator('.card-error').first()
    if (await isVisible(error)) {
      const text = (await error.innerText().catch(() => '')).trim()
      throw new Error(`Buffer rejected the ${decision}: ${text || 'no message'}`)
    }

    const live = (await liveText(page)).trim()
    if (live !== before && /^(Kept|Cut)\./.test(live)) return live
    await page.waitForTimeout(120)
  }
  throw new Error('The card did not advance after the decision. Check the Buffer connection.')
}

async function waitForEssenceResult(page) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const error = page.locator('.essay-error[role="alert"]').first()
    if (await isVisible(error)) {
      const text = (await error.innerText().catch(() => '')).trim()
      throw new Error(`Trim failed: ${text || 'no message'}`)
    }
    if (await isVisible(page.locator('#essence-result'))) return
    await page.waitForTimeout(150)
  }
  throw new Error('Trim did not finish in 30s. Check the AI key and quota on the deployment.')
}

async function waitForSent(page) {
  const saved = page.locator('h1.headline', { hasText: /^(Saved|In the queue)\.$/ })
  const error = page.locator('.essay-error[role="alert"]')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await isVisible(saved)) return
    if (await isVisible(error)) {
      const text = (await error.innerText().catch(() => '')).trim()
      throw new Error(`Send failed: ${text || 'no message'}`)
    }
    await page.waitForTimeout(150)
  }
  throw new Error('Send did not finish in 30s. Check the Buffer connection.')
}

async function leftCount(page) {
  const meta = page.locator('.queue-line .meta').first()
  if (!(await isVisible(meta))) return null
  const text = (await meta.textContent()) || ''
  const match = text.match(/(\d+)\s+left/)
  return match ? Number(match[1]) : null
}

async function liveText(page) {
  const live = page.locator('[aria-live="polite"]').first()
  if (!(await isVisible(live))) return ''
  return (await live.textContent()) || ''
}

async function isVisible(locator) {
  try {
    if ((await locator.count()) === 0) return false
    return await locator.isVisible()
  } catch {
    return false
  }
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  const box = await locator.boundingBox()
  if (!box) throw new Error('Element is not visible, so it cannot be clicked.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 })
  await page.waitForTimeout(180)
}

async function click(page, locator) {
  await moveTo(page, locator)
  await page.mouse.down()
  await page.waitForTimeout(70)
  await page.mouse.up()
}

// Move the pointer to empty canvas so it does not sit on top of the closing
// line ("3 kept. 3 cut.") or the actions.
async function parkCursor(page) {
  await page.mouse.move(1780, 1000, { steps: 24 })
  await page.waitForTimeout(220)
}

async function pause(seconds) {
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

async function holdUntil(seconds, page) {
  const ms = seconds * 1000 - (Date.now() - startedAt)
  if (ms > 0) await page.waitForTimeout(ms)
}

async function main() {
  const mode = await resolveMode()
  await fs.mkdir(OUT_DIR, { recursive: true })

  if (mode === 'live') {
    await fs.access(STATE_PATH).catch(() => {
      throw new Error(
        `Live mode needs a saved session at ${path.relative(ROOT, STATE_PATH)}. ` +
          'Run `npm run demo:capture -- <production-url>` first.',
      )
    })
  }

  console.log(`Recording ${BASE_URL} in ${mode} mode -> ${path.relative(ROOT, OUT_DIR)}`)

  const tempVideoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enough-demo-'))
  const browser = await chromium.launch({
    args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1920, height: 1080 },
    },
    ...(mode === 'live' ? { storageState: STATE_PATH } : {}),
  })

  await context.addInitScript(CURSOR_SCRIPT)
  if (mode === 'fixture') await installFixtureRoutes(context)

  const page = await context.newPage()
  startedAt = Date.now()
  let failure = null

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
    await pause(0.4)
    await run(page)
  } catch (error) {
    failure = error
    console.error(`Recording failed: ${error.message}`)
  } finally {
    const video = page.video()
    await context.close().catch(() => {})
    let saved = false
    if (video) {
      try {
        await video.saveAs(path.join(OUT_DIR, 'enough-demo.webm'))
        saved = true
      } catch (error) {
        console.error(`Could not save the video: ${error.message}`)
      }
    }
    await browser.close().catch(() => {})
    await fs.rm(tempVideoDir, { recursive: true, force: true }).catch(() => {})
    if (!saved) {
      throw failure || new Error('No video was produced.')
    }
  }

  if (failure) {
    console.error('A partial video was saved for diagnosis.')
    process.exitCode = 1
  } else {
    console.log(`WebM written to ${path.relative(ROOT, path.join(OUT_DIR, 'enough-demo.webm'))}`)
    console.log('Next: bash demo/to-mp4.sh')
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
