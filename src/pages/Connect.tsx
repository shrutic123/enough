export default function ConnectPage() {
  const params = new URLSearchParams(window.location.search)
  const error = params.has('error')
    ? params.get('error') || "Couldn't connect to Buffer. Try again."
    : null

  return (
    <main className="stage">
      <div className="column">
        <p className="wordmark">Enough</p>
        <h1 className="headline">Cut your queue down to what you meant to say.</h1>
        <p className="body-copy">
          Enough looks at the posts already in your Buffer queue.
        </p>
        <p className="body-copy">
          You keep or cut them, one card at a time. Nothing changes until you decide.
        </p>
        {error ? (
          <p className="error-copy" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <a className="act" href="/api/auth/login">
            Connect Buffer
          </a>
        </div>
      </div>
    </main>
  )
}
