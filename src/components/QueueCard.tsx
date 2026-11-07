import { forwardRef } from 'react'
import { formatCardSubline } from '../lib/format'

export type ReviewCard = {
  id: string
  text: string
  channelName: string
  dueAt: string | null
  reason?: string
}

type QueueCardViewProps = {
  card: ReviewCard
  struck: boolean
  kept: boolean
  gone: boolean
  busy: boolean
  onKeep: () => void
  onCut: () => void
  onAnimationEnd: () => void
}

export const QueueCardView = forwardRef<HTMLButtonElement, QueueCardViewProps>(
  function QueueCardView(
    { card, struck, kept, gone, busy, onKeep, onCut, onAnimationEnd },
    keepRef,
  ) {
    const cardClass = ['card', kept ? 'is-kept' : '', gone ? 'is-gone' : '']
      .filter(Boolean)
      .join(' ')

    return (
      <article
        className={cardClass}
        aria-busy={busy || undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) onAnimationEnd()
        }}
      >
        <p className="card-text">
          <span className={struck ? 'struck on' : 'struck'}>{card.text}</span>
        </p>
        <p className="card-sub">{formatCardSubline(card.channelName, card.dueAt)}</p>
        {card.reason ? <p className="card-why">{card.reason}</p> : null}
        <div className="actions">
          <button ref={keepRef} className="act" type="button" onClick={onKeep}>
            Keep <kbd aria-hidden="true">K</kbd>
          </button>
          <button className="act" type="button" onClick={onCut}>
            Cut <kbd aria-hidden="true">C</kbd>
          </button>
        </div>
      </article>
    )
  },
)
