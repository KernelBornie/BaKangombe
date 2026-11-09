const { Pool } = require('pg');

let pool = null;
if (process.env.POSTGRES_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
  } catch (err) {
    console.warn('Postgres connection pool failed, falling back to in-memory store:', err.message);
  }
}

const memoryUsage = new Map();

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage (
        id SERIAL PRIMARY KEY,
        api_key VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        validations INTEGER DEFAULT 0,
        enrichments INTEGER DEFAULT 0,
        UNIQUE(api_key, date)
      );
      CREATE INDEX IF NOT EXISTS idx_api_key ON usage(api_key);
    `);
    console.log('Database initialized');
  } catch (err) {
    console.warn('DB init warning (using in-memory fallback):', err.message);
  }
}
initDB();

async function incrementUsage(apiKey, type) {
  const today = new Date().toISOString().slice(0,10);
  const column = type === 'validate' ? 'validations' : 'enrichments';
  if (pool) {
    try {
      await pool.query(`
        INSERT INTO usage (api_key, date, ${column})
        VALUES ($1, $2, 1)
        ON CONFLICT (api_key, date)
        DO UPDATE SET ${column} = usage.${column} + 1
      `, [apiKey, today]);
      return;
    } catch (err) {
      // fallback
    }
  }
  const key = `${apiKey}:${today}`;
  const curr = memoryUsage.get(key) || { validations: 0, enrichments: 0 };
  curr[column] = (curr[column] || 0) + 1;
  memoryUsage.set(key, curr);
}

async function getUsage(apiKey, type) {
  const today = new Date().toISOString().slice(0,10);
  const column = type === 'validate' ? 'validations' : 'enrichments';
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT ${column} FROM usage WHERE api_key = $1 AND date = $2`,
        [apiKey, today]
      );
      return res.rows[0]?.[column] || 0;
    } catch (err) {
      // fallback
    }
  }
  const key = `${apiKey}:${today}`;
  return memoryUsage.get(key)?.[column] || 0;
}

module.exports = { incrementUsage, getUsage };