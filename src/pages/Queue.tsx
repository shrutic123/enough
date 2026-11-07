import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { QueueCard, SessionResponse } from '../types'
import { getQueue } from '../lib/api'
import { formatLeft } from '../lib/format'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { QueueCardView, type ReviewCard } from '../components/QueueCard'
import { fixtureCards } from '../fixtures/cards'
import EndPage from './End'

const MAX_CARDS = 20
const STRIKE_MS = 220
const KEEP_MS = 180
const COLLAPSE_MS = 280
const DISSOLVE_FALLBACK_MS = 400
const REDUCED_KEEP_MS = 120
const REDUCED_DISSOLVE_FALLBACK_MS = 160

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
      dueAt: post.dueAt,
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

  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)
  const [kept, setKept] = useState(0)
  const [cut, setCut] = useState(0)

  const [phase, setPhase] = useState<Phase>('idle')
  const [struck, setStruck] = useState(false)
  const [keptVisual, setKeptVisual] = useState(false)
  const [gone, setGone] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const timers = useRef<number[]>([])
  const phaseRef = useRef<Phase>('idle')
  const indexRef = useRef(0)
  const cardsRef = useRef<ReviewCard[]>([])
  const goneRef = useRef(false)
  const decisionRef = useRef<Decision | null>(null)
  const pendingFocusRef = useRef(false)
  const keepButtonRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => () => clearTimers(), [clearTimers])

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
      setDone(true)
      return
    }

    setIndex(nextIndex)
    pendingFocusRef.current = true
  }, [clearTimers])

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

    // Safety net in case the dissolve animation never reports animationend.
    later(
      beginCollapse,
      reduced ? REDUCED_DISSOLVE_FALLBACK_MS : DISSOLVE_FALLBACK_MS,
    )
  }, [beginCollapse, later, reduced])

  const handleCut = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    if (!cardsRef.current[indexRef.current]) return

    decisionRef.current = 'cut'
    phaseRef.current = 'striking'
    setPhase('striking')
    setStruck(true)

    later(beginLeaving, reduced ? 0 : STRIKE_MS)
  }, [beginLeaving, later, reduced])

  const handleKeep = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    if (!cardsRef.current[indexRef.current]) return

    decisionRef.current = 'keep'
    phaseRef.current = 'leaving'
    setPhase('leaving')
    setKeptVisual(true)

    later(beginCollapse, reduced ? REDUCED_KEEP_MS : KEEP_MS)
  }, [beginCollapse, later, reduced])

  const handleCardAnimationEnd = useCallback(() => {
    if (goneRef.current) beginCollapse()
  }, [beginCollapse])

  useEffect(() => {
    if (status !== 'ready' || done) return

    function onKeyDown(event: KeyboardEvent) {
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
  }, [done, handleCut, handleKeep, status])

  useEffect(() => {
    if (!pendingFocusRef.current || done) return

    const node = keepButtonRef.current
    if (!node) return

    pendingFocusRef.current = false
    node.focus()
  }, [done, index])

  const current = cards[index]
  const remaining = cards.length - index
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
          </div>
        </div>
      </main>
    )
  } else if (done || !current) {
    screen = <EndPage kept={kept} cut={cut} />
  } else {
    screen = (
      <main className="stage">
        <div className="column">
          <p className="meta">{formatLeft(remaining)}</p>
          <div className={collapsed ? 'slot collapsed' : 'slot'}>
            <QueueCardView
              ref={keepButtonRef}
              card={current}
              struck={struck}
              kept={keptVisual}
              gone={gone}
              busy={phase !== 'idle'}
              onKeep={handleKeep}
              onCut={handleCut}
              onAnimationEnd={handleCardAnimationEnd}
            />
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
