import type { CSSProperties } from 'react'
import type { DiffPart } from '../lib/diff'

export default function WordDiff({ parts, collapsed }: { parts: DiffPart[]; collapsed: boolean }) {
  return (
    <p className="essay-text">
      {parts.map((part, position) =>
        part.removed ? (
          <span
            key={position}
            className={'word cut' + (collapsed ? ' on gone' : '')}
            style={{ '--i': part.index } as CSSProperties}
          >
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </p>
  )
}
