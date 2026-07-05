import pg from 'pg'

const { Pool } = pg

// Pool reutilizable entre invocaciones (Vercel reutiliza el contexto en caliente)
let pool
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    })
  }
  return pool
}

const RENDER = process.env.RENDER_API_URL || 'https://control-gastos-api-jflv.onrender.com'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ detail: 'Method not allowed' })

  const { shortcut_token, token, importe } = req.body ?? {}
  const tok = shortcut_token || token

  if (!tok)                  return res.status(401).json({ detail: 'shortcut_token requerido' })

  const imp = parseFloat(importe)
  if (!imp || imp <= 0)      return res.status(422).json({ detail: 'importe inválido' })

  const client = await getPool().connect()
  try {
    // Validar token
    const { rows: users } = await client.query(
      'SELECT email FROM users WHERE shortcut_token = $1',
      [tok]
    )
    if (!users.length) return res.status(401).json({ detail: 'Token inválido' })

    // Guardar gasto pendiente con la fecha de hoy
    const { rows } = await client.query(
      'INSERT INTO pending_transactions (user_email, importe) VALUES ($1, $2) RETURNING id, fecha::text, importe',
      [users[0].email, imp]
    )

    // Despertar Render para que el SSE notifique a la app (fire & forget)
    fetch(`${RENDER}/api/notify`, { method: 'POST' }).catch(() => {})

    return res.status(200).json(rows[0])
  } catch (err) {
    console.error('[shortcut-pending]', err.message)
    return res.status(500).json({ detail: err.message })
  } finally {
    client.release()
  }
}
