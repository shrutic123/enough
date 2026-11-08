import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Channel, EssenceKind, SchedulingType, SessionResponse } from '../types'
import { createEssencePost, getChannels } from '../lib/api'
import { countWords, diffText } from '../lib/diff'
import type { DiffPart } from '../lib/diff'
import { useReducedMotion } from '../hooks/useReducedMotion'
import WordDiff from '../components/WordDiff'

const MAX_DRAFT = 4000

type Phase = 'edit' | 'diff' | 'result' | 'sent'
type ChannelState = 'loading' | 'ready' | 'error'
type Sent = { kind: EssenceKind; channelName: string; schedulingType?: SchedulingType }

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function formatWords(count: number): string {
  return `${count} ${count === 1 ? 'word' : 'words'}`
}

function channelName(channel: Channel | undefined): string {
  if (!channel) return 'that channel'
  return channel.displayName || channel.name
}

export default function EssencePage({
  session,
  onBack,
}: {
  session: SessionResponse
  onBack: () => void
}) {
  const organizationId = session.account?.organizations?.[0]?.id
  const reduced = useReducedMotion()

  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<EssenceKind>('scheduled')
  const [imageUrl, setImageUrl] = useState('')

  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState('')
  const [channelState, setChannelState] = useState<ChannelState>('loading')
  const [channelError, setChannelError] = useState<string | null>(null)
  // channelAttempt removed; channel errors show a connect prompt instead.

  const [phase, setPhase] = useState<Phase>('edit')
  const [parts, setParts] = useState<DiffPart[]>([])
  const [result, setResult] = useState('')
  // The word count of the text that was trimmed. Kept separately because the
  // draft becomes the trimmed text, and the diff must still say "24 to 11".
  const [sourceWords, setSourceWords] = useState(0)
  // True when the model returned the draft unchanged, so there is no mark to
  // draw. The result still appears; the count says why nothing moved.
  const [noCuts, setNoCuts] = useState(false)

  const [trimming, setTrimming] = useState(false)
  const [trimError, setTrimError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const mounted = useRef(true)
  const draftRef = useRef('')
  const draftField = useRef<HTMLTextAreaElement | null>(null)
  const swapTimer = useRef<number | null>(null)

  const clearAnimation = useCallback(() => {
    if (swapTimer.current !== null) {
      window.clearTimeout(swapTimer.current)
      swapTimer.current = null
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearAnimation()
    }
  }, [clearAnimation])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!organizationId) return

    let active = true
    setChannelState('loading')
    setChannelError(null)

    getChannels(organizationId)
      .then((response) => {
        if (!active) return
        const connected = response.channels.filter((channel) => !channel.isDisconnected)
        setChannels(connected)
        setChannelId((current) =>
          connected.some((channel) => channel.id === current) ? current : (connected[0]?.id ?? ''),
        )
        setChannelState('ready')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setChannelError(messageFor(reason, "Couldn't read your channels. Try again."))
        setChannelState('error')
      })

    return () => {
      active = false
    }
  }, [organizationId])

  const wordCount = countWords(draft)
  const resultWords = countWords(result)
  const tooLong = draft.length > MAX_DRAFT
  const busy = trimming || sending
  const selectedChannel = channels.find((channel) => channel.id === channelId)
  const limit = selectedChannel?.limit
  const unsupported = limit ? !limit.supported : false
  const overLimit = limit ? result.length > limit.max : false
  const needsImage = Boolean(limit?.needsImage) && !imageUrl.trim()
  const canTrim = !busy && draft.trim().length > 0 && !tooLong
  const canSend =
    phase === 'result' &&
    !busy &&
    result.trim().length > 0 &&
    Boolean(channelId) &&
    !needsImage &&
    !unsupported &&
    !overLimit

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value)
    setTrimError(null)

    // A result only describes the draft it came from. Editing the draft
    // retires it immediately, so no mark can describe stale text.
    if (phase !== 'edit') {
      clearAnimation()
      setPhase('edit')
      setParts([])
      setResult('')
      setNoCuts(false)
      setSendError(null)
      setAnnouncement('')
    }
  }

  function handleEditDraft() {
    clearAnimation()
    setPhase('edit')
    setParts([])
    setNoCuts(false)
    setSendError(null)
    setAnnouncement('')
    // The draft replaces the result in the same slot, so put the cursor back
    // where the writing is.
    window.requestAnimationFrame(() => draftField.current?.focus())
  }

  function handleTrim() {
    if (!canTrim) return

    const source = draft
    setTrimming(true)
    setTrimError(null)

    const body = JSON.stringify({ text: source })

    // Defer the fetch out of the click handler; React's event handling was
    // swallowing the promise resolution otherwise.
    setTimeout(() => {
      fetch('/api/ai/essence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then(async (r) => {
          const data = await r.json()
          if (!r.ok) throw new Error((typeof data?.error === 'string' && data.error) || 'fallback')
          return data as { trimmed: string }
        })
        .then((response) => {
          if (!mounted.current) return
          if (draftRef.current !== source) {
            return
          }

          clearAnimation()
          const nextParts = diffText(source, response.trimmed)
          const cuts = nextParts.filter((part) => part.removed).length
          const noMarks = cuts === 0
          const revealMs = Math.min(220 + Math.max(cuts - 1, 0) * 25 + 320 + 60, 2200)
          setSourceWords(countWords(source))
          setNoCuts(noMarks)
          setParts(nextParts)
          setResult(response.trimmed)
          setDraft(response.trimmed)
          // A draft the model left alone has no pencil mark to draw; go
          // straight to the result and say so in the count.
          setPhase(noMarks ? 'result' : 'diff')
          setAnnouncement(
            noMarks
              ? 'Already tight. Nothing to cut.'
              : `Trimmed. ${formatWords(countWords(response.trimmed))}.`,
          )

          // The pencil is a CSS animation, so it starts when the diff mounts.
          // There is no class flip to race: this timer only swaps the finished
          // diff for the editable result after the last word has collapsed.
          if (!noMarks && !reduced) {
            swapTimer.current = window.setTimeout(
              () => {
                swapTimer.current = null
                setPhase('result')
              },
              revealMs,
            )
          }
        })
        .catch((reason: unknown) => {
          if (!mounted.current) return
          setTrimError(messageFor(reason, "Couldn't trim that draft. Your text is unchanged."))
        })
        .finally(() => {
          if (mounted.current) setTrimming(false)
        })
    }, 0)

    return
  }

  async function handleSend() {
    if (!canSend || !organizationId || !channelId) return

    const channel = channels.find((item) => item.id === channelId)
    const text = result

    setSending(true)
    setSendError(null)

    try {
      const created = await createEssencePost({
        kind,
        text,
        channelId,
        organizationId,
        imageUrl: imageUrl.trim() || undefined,
      })
      if (!mounted.current) return

      clearAnimation()
      setSent({
        kind,
        channelName: channelName(channel),
        schedulingType: created.post.schedulingType,
      })
      setPhase('sent')
    } catch (reason: unknown) {
      if (!mounted.current) return
      setSendError(
        messageFor(reason, "Buffer didn't create that post. Your draft is still here. Try again."),
      )
    } finally {
      if (mounted.current) setSending(false)
    }
  }

  if (phase === 'sent' && sent) {
    return (
      <main className="stage">
        <div className="column">
          <h1 className="headline">{sent.kind === 'scheduled' ? 'In the queue.' : 'Saved.'}</h1>
          <p className="body-copy">
            {sent.kind === 'scheduled'
              ? `Added to the queue for ${sent.channelName}.`
              : `Saved as a draft for ${sent.channelName}.`}
          </p>
          {sent.kind === 'scheduled' && sent.schedulingType === 'notification' ? (
            <p className="count">Buffer will remind you when it's time to post.</p>
          ) : null}
          <div className="actions">
            <button className="act" type="button" onClick={onBack}>
              Back to the queue
            </button>
            <a className="act" href="https://publish.buffer.com">
              Open Buffer
            </a>
          </div>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="stage">
        <div className="column">
          <p className="meta">
            <button className="act" type="button" onClick={onBack}>
              Back to the queue
            </button>
          </p>

          <h1 className="headline">Essence</h1>
          <p className="body-copy">Paste a draft. Keep one idea.</p>

          {phase === 'edit' ? (
            <div className="essay-sheet">
              <label className="essay-label" htmlFor="essence-draft">
                Draft
              </label>
              <p className="essay-count">{formatWords(wordCount)}</p>
              <textarea
                id="essence-draft"
                ref={draftField}
                className="essay-input"
                value={draft}
                onChange={handleDraftChange}
                placeholder="Paste a draft."
                rows={8}
              />
              {tooLong ? (
                <p className="essay-error" role="alert">
                  That draft is too long. Keep it under 4,000 characters.
                </p>
              ) : null}
              {limit ? (
                <p className="count">
                  {draft.length.toLocaleString('en-US')} of{' '}
                  {limit.max.toLocaleString('en-US')} characters for {limit.label}.
                  {draft.length > limit.max ? ' Shorten it to send.' : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <section
              className="essay-sheet"
              aria-label="Trimmed draft"
              aria-busy={phase === 'diff' ? true : undefined}
            >
              <p className="essay-label">
                {phase === 'diff' ? 'Draft' : 'Trimmed draft'}
              </p>
              <p className="essay-count">
                {noCuts
                  ? `${formatWords(resultWords)}. Already tight.`
                  : `${formatWords(sourceWords)} to ${resultWords}.`}
              </p>
              {phase === 'diff' ? (
                <WordDiff parts={parts} />
              ) : (
                <textarea
                  id="essence-result"
                  className="essay-input"
                  value={result}
                  onChange={(event) => {
                    setResult(event.target.value)
                    if (noCuts) setNoCuts(false)
                  }}
                  readOnly={sending}
                  rows={8}
                />
              )}
              {limit ? (
                <p className="count">
                  {result.length.toLocaleString('en-US')} of{' '}
                  {limit.max.toLocaleString('en-US')} characters for {limit.label}.
                  {overLimit ? ' Shorten it to send.' : ''}
                </p>
              ) : null}
            </section>
          )}

          <div className="essay-meta">
            <div className="essay-field">
              {!organizationId ? (
                <div className="essay-row">
                  <p className="count">Connect Buffer to choose a channel and send.</p>
                  <a className="act" href="/api/auth/login">
                    Connect Buffer
                  </a>
                </div>
              ) : channelState === 'ready' && channels.length > 0 ? (
              <>
                <label className="essay-label" htmlFor="essence-channel">
                  Channel
                </label>
                <select
                  id="essence-channel"
                  className="essay-select"
                  value={channelId}
                  onChange={(event) => setChannelId(event.target.value)}
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.displayName || channel.name}
                    </option>
                  ))}
                </select>
                {limit && !limit.supported ? (
                  <p className="essay-error" role="alert">
                    {limit.note} Pick another channel.
                  </p>
                ) : limit?.note ? (
                  <p className="count">{limit.note}</p>
                ) : null}
              </>
            ) : channelState === 'loading' ? (
              <p className="count">Reading your channels.</p>
            ) : channelState === 'error' ? (
              <div className="essay-row">
                <p className="count">
                  {channelError === "Buffer didn't respond. Your queue is unchanged. Try again."
                    ? 'Connect Buffer to choose a channel and send.'
                    : (channelError ?? "Couldn't read your channels. Try again.")}
                </p>
                <a className="act" href="/api/auth/login">
                  Connect Buffer
                </a>
              </div>
            ) : (
              <div className="essay-row">
                <p className="count">No channel is connected. Connect one in Buffer first.</p>
                <a className="act" href="https://publish.buffer.com">
                  Open Buffer
                </a>
              </div>
            )}
          </div>

          {limit?.needsImage ? (
            <div className="essay-field">
              <label className="essay-label" htmlFor="essence-image">
                Image URL
              </label>
              <input
                id="essence-image"
                className="essay-input essay-line"
                type="url"
                value={imageUrl}
                onChange={(event) => {
                  setImageUrl(event.target.value)
                  setSendError(null)
                }}
                placeholder="https://"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="count">{limit.label} needs an image. Paste a public link.</p>
            </div>
          ) : null}

          <div className="essay-field">
            <label className="essay-label" htmlFor="essence-destination">
              Destination
            </label>
            <select
              id="essence-destination"
              className="essay-select"
              value={kind}
              onChange={(event) => setKind(event.target.value as EssenceKind)}
            >
              <option value="scheduled">Add to queue</option>
              <option value="draft">Save as draft</option>
            </select>
            <p className="count">
              {kind === 'scheduled'
                ? 'Goes into the next open slot.'
                : 'Stays a draft until you schedule it.'}
            </p>
          </div>
          </div>

          {phase === 'edit' ? (
            <div className="actions">
              <button
                className="act"
                type="button"
                aria-disabled={canTrim ? undefined : true}
                onClick={handleTrim}
              >
                {trimming ? 'Trimming.' : 'Trim'}
              </button>
            </div>
          ) : phase === 'result' ? (
            <div className="actions">
              <button
                className="act"
                type="button"
                aria-disabled={canSend ? undefined : true}
                onClick={handleSend}
              >
                {sending ? 'Sending.' : 'Send to Buffer'}
              </button>
              <button className="act" type="button" onClick={handleEditDraft}>
                Edit draft
              </button>
            </div>
          ) : null}

          {trimError ? (
            <p className="essay-error" role="alert">
              {trimError}
            </p>
          ) : null}

          {sendError ? (
            <p className="essay-error" role="alert">
              {sendError}
            </p>
          ) : null}
        </div>
      </main>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
