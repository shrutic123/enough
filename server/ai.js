// One small seam over the chat-completion APIs. The provider is whichever key
// is present, so a deployment only needs to set one of them. Nothing in this
// file logs the draft or a key: callers log the event and status instead.

const DEFAULT_TIMEOUT_MS = 25_000

// Order matters: the first key present wins. This keeps a deliberate choice
// possible (set only the key you want) without another setting.
const PROVIDERS = [
  {
    name: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    // Free-tier Gemini is per-model: Flash is about 5 requests/minute and
    // 20/day, while Flash-Lite is about 15/minute and 500/day. Lite is the
    // default so a day of demoing does not exhaust the key; Flash is the
    // quality fallback when Lite is unavailable. Both are free.
    defaultModel: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.5-flash',
    // Bound each attempt so a slow model leaves time for the fallback. Lite
    // normally answers in one to two seconds, but the free tier can take
    // longer under load; twelve seconds covers that without returning to the
    // old 25-second wait.
    timeoutMs: 12_000,
    request: ({ key, model, prompt }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json',
      },
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Editing one paragraph is a low-complexity task. Minimal thinking
        // keeps the trim fast enough for a typing interaction.
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
      },
      read: (json) =>
        (json?.candidates?.[0]?.content?.parts || [])
          .map((part) => part?.text)
          .filter((text) => typeof text === 'string')
          .join(''),
    }),
  },
  {
    name: 'openai',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4.1-mini',
    request: ({ key, model, prompt }) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1200,
      },
      read: (json) => json?.choices?.[0]?.message?.content,
    }),
  },
  {
    name: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-5',
    request: ({ key, model, prompt }) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      },
      read: (json) => json?.content?.[0]?.text,
    }),
  },
]

function hasKey(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// Resolve the provider for this call. Returns null when no key is configured.
function activeProvider() {
  for (const provider of PROVIDERS) {
    const key = process.env[provider.keyEnv]
    if (!hasKey(key)) continue
    const model = process.env.AI_MODEL?.trim() || provider.defaultModel
    return { ...provider, key: key.trim(), model }
  }
  return null
}

export function hasAiProvider() {
  return activeProvider() !== null
}

// For logs and development causes only. Never includes the key.
export function aiProviderName() {
  return activeProvider()?.name || null
}

const PROMPT =
  'You are an editor. Return only a trimmed version of the text. Keep the one idea the writer actually meant. ' +
  'Delete filler, repetition and anything that is not needed. Do not add facts, links, hashtags, emoji, calls to action or new sentences. ' +
  "Preserve the writer's voice, @mentions and URLs exactly. Do not explain or comment. Return the text and nothing else.\n\nTEXT:\n"

function providerError(name, status, message) {
  const error = new Error(message)
  error.provider = name
  error.status = status
  return error
}

// Pull only the provider's short human message. The response body is never
// logged, and this is the only part of it ever surfaced.
function shortProviderMessage(json) {
  const message = json?.error?.message || json?.message
  return typeof message === 'string' ? message.slice(0, 300) : ''
}

async function requestOne(provider, model, text) {
  const request = provider.request({ key: provider.key, model, prompt: `${PROMPT}${text}` })

  let res
  try {
    res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(provider.timeoutMs || DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    // A timeout or a network failure has no HTTP status to report.
    const message = err?.name === 'TimeoutError' ? 'The provider timed out' : 'Could not reach the provider'
    throw providerError(provider.name, 0, message)
  }

  const json = await res.json().catch(() => null)

  if (!res.ok) {
    throw providerError(provider.name, res.status, shortProviderMessage(json) || `HTTP ${res.status}`)
  }

  const value = request.read(json)
  if (typeof value !== 'string' || !value.trim()) {
    throw providerError(provider.name, 502, 'The provider returned no text')
  }
  return value
}

export async function trimToEssence(text) {
  const provider = activeProvider()
  if (!provider) {
    const error = new Error('No AI provider is configured')
    error.provider = null
    error.status = 503
    throw error
  }

  const models = [provider.model]
  if (provider.fallbackModel && provider.fallbackModel !== provider.model) {
    models.push(provider.fallbackModel)
  }

  let lastError
  let sawBusy = false
  for (const model of models) {
    try {
      return await requestOne(provider, model, text)
    } catch (err) {
      lastError = err
      if (err.status === 429 || err.status === 503) sawBusy = true
      // Try the fallback for every failure, including a timeout: the free
      // tier can stall one model while the other still answers, and a timeout
      // on the first attempt must not end the request.
      if (model === models[models.length - 1]) {
        if (sawBusy) lastError.busy = true
        throw lastError
      }
    }
  }
  throw lastError
}
