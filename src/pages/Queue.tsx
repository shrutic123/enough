import type { SessionResponse } from '../types'

export default function QueuePage({ session }: { session: SessionResponse }) {
  return (
    <main className="stage">
      <div className="column">
        <p className="meta">{session.account?.email ?? 'Connected to Buffer'}</p>
        <div className="card">
          <p className="card-text">Your queue is next.</p>
        </div>
      </div>
    </main>
  )
}
