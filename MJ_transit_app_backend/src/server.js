import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { query } from './db.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/routes', async (_req, res) => {
  try {
    const { rows } = await query(
      'select id, name, color_hex from routes order by name'
    )
    res.json(rows)
  } catch (error) {
    console.error('Failed to fetch routes', error)
    res.status(500).json({ message: 'Unable to fetch routes' })
  }
})

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
})
