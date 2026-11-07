import app from './app.js'
import { PORT } from './config.js'

// Local development listener only. Vite terminates HTTPS on 5173 and proxies
// /api here. Vercel imports app.js from api/index.js instead and never listens.
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
})
