import { forwardRef } from 'react'
import type { QueueCard } from '../types'
import { formatCardSubline } from '../lib/format'

export type ReviewCard = {
  id: string
  text: string
  channelName: string
  service: string
  dueAt: string | null
  reason?: string
  asset?: QueueCard['asset']
}

type QueueCardViewProps = {
  card: ReviewCard
  struck: boolean
  kept: boolean
  gone: boolean
  busy: boolean
  error?: string | null
  onKeep: () => void
  onCut: () => void
  onAnimationEnd: () => void
}

export const QueueCardView = forwardRef<HTMLButtonElement, QueueCardViewProps>(
  function QueueCardView(
    { card, struck, kept, gone, busy, error, onKeep, onCut, onAnimationEnd },
    keepRef,
  ) {
    const cardClass = ['card', kept ? 'is-kept' : '', gone ? 'is-gone' : '']
      .filter(Boolean)
      .join(' ')
    const mediaLabel = card.asset?.type === 'video' ? 'Video post' : 'Image post'
    const displayText = card.text.trim() || (card.asset ? mediaLabel : '')

    return (
      <article
        className={cardClass}
        aria-busy={busy || undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) onAnimationEnd()
        }}
      >
        <div className="card-top">
          <p className="card-text">
            <span className={struck ? 'struck on' : 'struck'}>{displayText}</span>
          </p>
          {card.asset ? (
            <img
              className="card-thumb"
              src={card.asset.thumbnail}
              alt=""
              loading="lazy"
            />
          ) : null}
        </div>
        <p className="card-sub">{formatCardSubline(card.service, card.channelName, card.dueAt)}</p>
        {error ? (
          <p className="card-why card-error" role="alert">
            {error}
          </p>
        ) : card.reason ? (
          <p className="card-why">{card.reason}</p>
        ) : null}
        <div className="actions">
          <button
            ref={keepRef}
            className="act"
            type="button"
            aria-disabled={busy || undefined}
            onClick={onKeep}
          >
            Keep <kbd aria-hidden="true">K</kbd>
          </button>
          <button
            className="act"
            type="button"
            aria-disabled={busy || undefined}
            onClick={onCut}
          >
            Cut <kbd aria-hidden="true">C</kbd>
          </button>
        </div>
      </article>
    )
  },
)
