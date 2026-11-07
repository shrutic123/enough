import { useEffect, useRef } from 'react'
import { formatTotals } from '../lib/format'

export default function EndPage({ kept, cut }: { kept: number; cut: number }) {
  const headingRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="stage">
      <div className="column">
        <p className="enough" ref={headingRef} tabIndex={-1}>
          Enough.
        </p>
        <p className="enough-sub">{formatTotals(kept, cut)}</p>
        <div className="actions">
          <a className="act" href="https://publish.buffer.com">
            Back to Buffer
          </a>
          <button className="act" type="button" onClick={() => window.location.reload()}>
            Start over
          </button>
        </div>
      </div>
    </main>
  )
}
