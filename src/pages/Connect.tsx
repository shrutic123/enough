export default function ConnectPage() {
  const params = new URLSearchParams(window.location.search)
  const error = params.has('error')
    ? params.get('error') || "Couldn't connect to Buffer. Try again."
    : null

  return (
    <main className="stage">
      <div className="column connect">
        <p className="wordmark">Enough</p>
        <h1 className="headline connect-headline">
          Cut your queue down to what you meant to say.
        </h1>
        <p className="body-copy connect-copy">
          Keep or cut what's already in your Buffer queue, one post at a time. Nothing changes
          until you decide.
        </p>
        {error ? (
          <p className="error-copy" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions connect-actions">
          <a className="act" href="/api/auth/login">
            Connect Buffer
          </a>
        </div>
      </div>
    </main>
  )
}
