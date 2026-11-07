import { useEffect, useState } from 'react'
import { getSession } from './lib/api'
import type { SessionResponse } from './types'
import ConnectPage from './pages/Connect'
import QueuePage from './pages/Queue'

const DEMO_SESSION: SessionResponse = {
  connected: true,
  account: {
    id: 'demo',
    email: 'demo@enough.local',
    organizations: [{ id: 'demo', name: 'Demo' }],
  },
}

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'

  useEffect(() => {
    if (isDemo) return
    let active = true

    getSession()
      .then((next) => {
        if (active) setSession(next)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : "Buffer didn't respond. Your queue is unchanged. Try again.",
        )
      })

    return () => {
      active = false
    }
  }, [isDemo])

  // Dev-only fixture mode. `import.meta.env.DEV` is false in production builds.
  if (isDemo) return <QueuePage session={DEMO_SESSION} />

  if (error) {
    return (
      <main className="stage">
        <div className="column">
          <p className="meta" role="alert">
            {error}
          </p>
          <div className="actions">
            <button className="act" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="stage">
        <div className="column">
          <p className="meta">One moment.</p>
        </div>
      </main>
    )
  }

  return session.connected ? <QueuePage session={session} /> : <ConnectPage />
}
