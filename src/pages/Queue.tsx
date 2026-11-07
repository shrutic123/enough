import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { QueueCard, SessionResponse } from '../types'
import { getQueue, cutPost } from '../lib/api'
import { formatLeft } from '../lib/format'
import {
  browserStorage,
  playCrumpleSound,
  primeCrumpleSound,
  readSoundPreference,
  writeSoundPreference,
} from '../lib/sound'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { QueueCardView, type ReviewCard } from '../components/QueueCard'
import Crumple from '../components/Crumple'
import { fixtureCards } from '../fixtures/cards'
import EndPage from './End'
import EssencePage from './Essence'

const MAX_CARDS = 20
const STRIKE_MS = 220
const KEEP_MS = 220
const ENTER_MS = 200
const COLLAPSE_MS = 280
const LEAVE_FALLBACK_MS = 820
const REDUCED_KEEP_MS = 120
const REDUCED_ENTER_MS = 120
const REDUCED_LEAVE_FALLBACK_MS = 160

type Phase = 'idle' | 'striking' | 'leaving' | 'collapsing'
type LoadState = 'loading' | 'ready' | 'error'
type Decision = 'keep' | 'cut'
type SourceCard = QueueCard & { reason?: string }

function dueTime(dueAt: string | null): number | null {
  if (!dueAt) return null
  const time = new Date(dueAt).getTime()
  return Number.isFinite(time) ? time : null
}

function compareDueAt(a: SourceCard, b: SourceCard): number {
  const aTime = dueTime(a.dueAt)
  const bTime = dueTime(b.dueAt)

  if (aTime === null && bTime === null) return 0
  if (aTime === null) return 1
  if (bTime === null) return -1
  return aTime - bTime
}

function reasonFor(card: SourceCard): string | undefined {
  if (card.reason) return card.reason
  if (card.status === 'error') return "This one didn't send."

  const time = dueTime(card.dueAt)
  if (time !== null && time < Date.now()) return 'This was meant to go out already.'

  return undefined
}

function toReviewCards(posts: SourceCard[]): ReviewCard[] {
  return [...posts]
    .sort(compareDueAt)
    .slice(0, MAX_CARDS)
    .map((post) => ({
      id: post.id,
      text: post.text,
      channelName: post.channelName,
      service: post.service,
      dueAt: post.dueAt,
      asset: post.asset,
      reason: reasonFor(post),
    }))
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export default function QueuePage({ session }: { session: SessionResponse }) {
  const organizationId = session.account?.organizations?.[0]?.id
  const isDemo =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'
  const reduced = useReducedMotion()

  const [status, setStatus] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [attempt, setAttempt] = useState(0)
  // The editor replaces the queue's screen but not the page, so review progress
  // survives a detour into the editor.
  const [writing, setWriting] = useState(false)

  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)
  const [kept, setKept] = useState(0)
  const [cut, setCut] = useState(0)

  const [phase, setPhase] = useState<Phase>('idle')
  const [struck, setStruck] = useState(false)
  const [keptVisual, setKeptVisual] = useState(false)
  const [gone, setGone] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [entering, setEntering] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [cutError, setCutError] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(() => readSoundPreference(browserStorage()))

  const timers = useRef<number[]>([])
  const phaseRef = useRef<Phase>('idle')
  const indexRef = useRef(0)
  const cardsRef = useRef<ReviewCard[]>([])
  const goneRef = useRef(false)
  const decisionRef = useRef<Decision | null>(null)
  const pendingFocusRef = useRef(false)
  const keepButtonRef = useRef<HTMLButtonElement>(null)
  const cutButtonRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const [crumpling, setCrumpling] = useState(false)
  const [crumpleTarget, setCrumpleTarget] = useState<HTMLElement | null>(null)
  const mountedRef = useRef(true)

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }, [])

  const later = useCallback((run: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timers.current = timers.current.filter((timer) => timer !== id)
      run()
    }, delay)
    timers.current.push(id)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
    }
  }, [clearTimers])

  useEffect(() => {
    if (isDemo) {
      const next = toReviewCards(fixtureCards)
      cardsRef.current = next
      setCards(next)
      setStatus('ready')
      setError(null)
      return
    }

    if (!organizationId) return

    let active = true
    setStatus('loading')
    setError(null)

    getQueue(organizationId)
      .then((response) => {
        if (!active) return
        const next = toReviewCards(response.posts)
        cardsRef.current = next
        setCards(next)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : "Buffer didn't respond. Your queue is unchanged. Try again.",
        )
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [attempt, isDemo, organizationId])

  const advance = useCallback(() => {
    clearTimers()

    const decision = decisionRef.current
    decisionRef.current = null

    const total = cardsRef.current.length
    const nextIndex = indexRef.current + 1
    const left = Math.max(total - nextIndex, 0)

    phaseRef.current = 'idle'
    setPhase('idle')
    goneRef.current = false
    setGone(false)
    setStruck(false)
    setKeptVisual(false)
    setCollapsed(false)
    setCutError(null)
    setCrumpling(false)
    setCrumpleTarget(null)

    if (decision === 'keep') {
      setKept((value) => value + 1)
      setAnnouncement(`Kept. ${formatLeft(left)}.`)
    } else if (decision === 'cut') {
      setCut((value) => value + 1)
      setAnnouncement(`Cut. ${formatLeft(left)}.`)
    }

    indexRef.current = nextIndex

    if (nextIndex >= total) {
      pendingFocusRef.current = false
      setEntering(false)
      setDone(true)
      return
    }

    setIndex(nextIndex)
    pendingFocusRef.current = true
    // The next card rises into place, so the stack reads as a pile rather than
    // a text swap. The first card does not animate.
    setEntering(true)
    later(() => setEntering(false), reduced ? REDUCED_ENTER_MS : ENTER_MS)
  }, [clearTimers, later, reduced])

  const beginCollapse = useCallback(() => {
    if (phaseRef.current !== 'leaving') return

    clearTimers()
    phaseRef.current = 'collapsing'
    setPhase('collapsing')
    setCollapsed(true)

    later(advance, reduced ? 0 : COLLAPSE_MS)
  }, [advance, clearTimers, later, reduced])

  const beginLeaving = useCallback(() => {
    if (phaseRef.current !== 'striking') return

    phaseRef.current = 'leaving'
    setPhase('leaving')
    goneRef.current = true
    setGone(true)

    // The sound is the paper, not a notification: it starts with the crumple.
    if (soundOn) playCrumpleSound()

    // The blank sheet crumples after the words leave. The canvas takes over
    // from the now-hidden card.
    const target = cardRef.current ?? document.querySelector('article.card')
    setCrumpleTarget(target as HTMLElement | null)
    setCrumpling(true)

    // Safety net in case the crumple animation never reports animationend.
    later(
      beginCollapse,
      reduced ? REDUCED_LEAVE_FALLBACK_MS : LEAVE_FALLBACK_MS,
    )
  }, [beginCollapse, later, reduced, soundOn])

  const handleCut = useCallback(() => {
    if (phaseRef.current !== 'idle') return

    const card = cardsRef.current[indexRef.current]
    if (!card) return

    decisionRef.current = 'cut'
    phaseRef.current = 'striking'
    setPhase('striking')
    setStruck(true)
    setCutError(null)

    // The focus ring should name the decision that is actually running. It
    // moves to Cut before the strike and the crumple begin, so a keyboard user
    // never sees Keep focused while the card is being cut.
    cutButtonRef.current?.focus()

    // A cut click is the gesture that lets the audio context start.
    if (soundOn) void primeCrumpleSound()

    // The pencil draws while Buffer deletes. The card only dissolves once the
    // delete is confirmed, so a failure leaves the queue and the card intact.
    const startedAt = Date.now()
    const remove = isDemo ? Promise.resolve({ ok: true as const }) : cutPost(card.id)

    remove
      .then(() => {
        if (!mountedRef.current || phaseRef.current !== 'striking') return
        const wait = reduced ? 0 : Math.max(0, STRIKE_MS - (Date.now() - startedAt))
        later(beginLeaving, wait)
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current) return

        clearTimers()
        decisionRef.current = null
        phaseRef.current = 'idle'
        setPhase('idle')
        setStruck(false)
        setCrumpling(false)
        setCrumpleTarget(null)

        const message =
          reason instanceof Error && reason.message
            ? reason.message
            : "Buffer didn't delete that post. Your queue is unchanged. Try again."
        setCutError(message)
      })
  }, [beginLeaving, clearTimers, isDemo, later, reduced, soundOn])

  const handleKeep = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    if (!cardsRef.current[indexRef.current]) return

    decisionRef.current = 'keep'
    phaseRef.current = 'leaving'
    setPhase('leaving')
    setKeptVisual(true)

    later(beginCollapse, reduced ? REDUCED_KEEP_MS : KEEP_MS)
  }, [beginCollapse, later, reduced])

  const toggleSound = useCallback(() => {
    const next = !soundOn
    setSoundOn(next)
    writeSoundPreference(browserStorage(), next)

    // Turning it on previews the paper at a softer level, so the setting is
    // audible immediately rather than only after the next confirmed cut.
    if (next) void primeCrumpleSound().then(() => playCrumpleSound(0.75))
  }, [soundOn])

  const handleCrumpleDone = useCallback(() => {
    setCrumpling(false)
    setCrumpleTarget(null)
    beginCollapse()
  }, [beginCollapse])

  const handleCardAnimationEnd = useCallback(() => {
    if (goneRef.current) beginCollapse()
  }, [beginCollapse])

  useEffect(() => {
    if (status !== 'ready' || done) return

    function onKeyDown(event: KeyboardEvent) {
      if (writing) return
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (phaseRef.current !== 'idle') return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        handleKeep()
      } else if (key === 'c') {
        event.preventDefault()
        handleCut()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [done, handleCut, handleKeep, status, writing])

  useEffect(() => {
    if (writing || !pendingFocusRef.current || done) return

    const node = keepButtonRef.current
    if (!node) return

    pendingFocusRef.current = false
    node.focus()
  }, [done, index, writing])

  if (writing) {
    return (
      <EssencePage
        session={session}
        onBack={() => {
          setWriting(false)
          setAttempt((value) => value + 1)
        }}
      />
    )
  }

  const current = cards[index]
  const remaining = cards.length - index
  const remainingShare = cards.length > 0 ? Math.round((remaining / cards.length) * 100) : 0
  const stackClass = [
    'sheet-stack',
    remaining > 1 ? 'stacked' : '',
    // The pile dims as the slot closes, so a keep or a cut never leaves an
    // empty outline hanging in the page while the next card is missing.
    gone || collapsed ? 'leaving' : '',
  ]
    .filter(Boolean)
    .join(' ')
  let screen: ReactNode

  if (!isDemo && !organizationId) {
    screen = (
      <main className="stage">
        <div className="column">
          <p className="meta" role="alert">
            No Buffer organization found. Reconnect and try again.
          </p>
        </div>
      </main>
    )
  } else if (status === 'loading') {
    screen = (
      <main className="stage">
        <div className="column">
          <p className="meta">Reading your queue.</p>
        </div>
      </main>
    )
  } else if (status === 'error') {
    screen = (
      <main className="stage">
        <div className="column">
          <p className="meta" role="alert">
            {error ?? "Buffer didn't respond. Your queue is unchanged. Try again."}
          </p>
          <div className="actions">
            <button className="act" type="button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
            <a className="act" href="/api/auth/login">
              Reconnect
            </a>
          </div>
        </div>
      </main>
    )
  } else if (cards.length === 0) {
    screen = (
      <main className="stage">
        <div className="column">
          <p className="meta">Nothing scheduled.</p>
          <p className="body-copy">Your Buffer queue is empty. There is nothing to review.</p>
          <div className="actions">
            <a className="act" href="https://publish.buffer.com">
              Back to Buffer
            </a>
            {!isDemo ? (
              <button className="act" type="button" onClick={() => setWriting(true)}>
                Trim a draft
              </button>
            ) : null}
          </div>
        </div>
      </main>
    )
  } else if (done || !current) {
    screen = (
      <EndPage
        kept={kept}
        cut={cut}
        onWrite={isDemo ? undefined : () => setWriting(true)}
      />
    )
  } else {
    screen = (
      <main className="stage review-stage">
        <div className="column">
          <div className="queue-head">
            <div className="queue-line">
              <p className="meta">
                {formatLeft(remaining)}
                {!isDemo ? (
                  <>
                    {' · '}
                    <button className="act" type="button" onClick={() => setWriting(true)}>
                      Trim a draft
                    </button>
                  </>
                ) : null}
              </p>
              <button
                className="act queue-sound"
                type="button"
                onClick={toggleSound}
                aria-label={
                  soundOn ? 'Turn the crumple sound off' : 'Turn the crumple sound on'
                }
              >
                {soundOn ? 'Sound off' : 'Sound on'}
              </button>
            </div>
            <div className="queue-progress" aria-hidden="true">
              <span style={{ width: `${remainingShare}%` }} />
            </div>
          </div>
          <div className="queue-body">
            <span className={keptVisual ? 'keep-note on' : 'keep-note'} aria-hidden="true">
              kept
            </span>
            <div className={collapsed ? 'slot collapsed' : 'slot'}>
              <div className={stackClass}>
                <span className="stack-edge edge-one" aria-hidden="true" />
                <span className="stack-edge edge-two" aria-hidden="true" />
                <QueueCardView
                  ref={keepButtonRef}
                  card={current}
                  struck={struck}
                  kept={keptVisual}
                  gone={gone}
                  busy={phase !== 'idle'}
                  entering={entering && phase === 'idle'}
                  error={cutError}
                  onKeep={handleKeep}
                  onCut={handleCut}
                  onAnimationEnd={handleCardAnimationEnd}
                  cutRef={cutButtonRef}
                  cardRef={(node) => {
                    cardRef.current = node
                  }}
                />
                <Crumple
                  active={crumpling}
                  target={crumpleTarget}
                  onDone={handleCrumpleDone}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <>
      {screen}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
