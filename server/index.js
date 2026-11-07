// Replaced by the real server agent.
import express from 'express'

const app = express()
const port = process.env.PORT || 3001

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
