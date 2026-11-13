#!/usr/bin/env node
// Opens the production app, lets you complete Buffer's OAuth flow once, and
// saves the sealed session cookie as a Playwright storageState file.
//
//   npm run demo:capture -- https://enough-nu-flame.vercel.app
//
// The file is a credential. It stays in demo/.auth/ (gitignored); upload it to
// GitHub only as the DEMO_STORAGE_STATE secret.
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE_URL = (process.argv[2] || process.env.DEMO_URL || 'https://enough-nu-flame.vercel.app').replace(/\/+$/, '')
const OUT = path.resolve(ROOT, process.env.DEMO_STATE_OUT || 'demo/.auth/state.json')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function sessionState(page) {
  try {
    return await page.evaluate(async () => {
      const response = await fetch('/api/buffer/session', { cache: 'no-store' })
      return response.ok ? await response.json() : null
    })
  } catch {
    return null
  }
}

async function main() {
  const origin = new URL(BASE_URL).origin
  console.log(`Opening ${BASE_URL}`)
  console.log('Complete the Buffer login in the browser window. This terminal will wait.')

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  let connected = false
  let lastNote = 0

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })

    const deadline = Date.now() + 5 * 60_000
    while (Date.now() < deadline) {
      // The OAuth round trip leaves this origin for auth.buffer.com. Only ask
      // the app for its session once it is back.
      if (page.url().startsWith(origin)) {
        const state = await sessionState(page)
        if (state?.connected) {
          connected = true
          break
        }
      }

      if (Date.now() - lastNote > 15_000) {
        lastNote = Date.now()
        console.log(`Waiting for the callback on ${origin} ...`)
      }
      await sleep(1000)
    }

    if (!connected) {
      throw new Error('No connected Buffer session appeared within five minutes.')
    }

    // Wait for the queue request too: this proves the access token works and
    // lets the server rotate it before we export the cookie.
    await page.locator('article.card, .enough, .meta').first().waitFor({
      state: 'visible',
      timeout: 45_000,
    }).catch(() => {})
    await sleep(500)

    await fs.mkdir(path.dirname(OUT), { recursive: true })
    await context.storageState({ path: OUT })
    await fs.chmod(OUT, 0o600)

    console.log('')
    console.log(`Saved ${path.relative(ROOT, OUT)}`)
    console.log('')
    console.log('Add it to GitHub as a repository secret (the output is base64, not the JSON):')
    console.log('')
    console.log(
      `  base64 < ${path.relative(ROOT, OUT)} | tr -d '\\n' | gh secret set DEMO_STORAGE_STATE --repo shrutic123/enough`,
    )
    console.log('')
    console.log('Then run the Demo video workflow with mode=live.')
    console.log('Treat this cookie like a password. It grants access to the Buffer account.')
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
