const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
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
    console.error('DB init error:', err);
  }
}
initDB();

async function incrementUsage(apiKey, type) {
  const today = new Date().toISOString().slice(0,10);
  const column = type === 'validate' ? 'validations' : 'enrichments';
  await pool.query(`
    INSERT INTO usage (api_key, date, ${column})
    VALUES ($1, $2, 1)
    ON CONFLICT (api_key, date)
    DO UPDATE SET ${column} = usage.${column} + 1
  `, [apiKey, today]);
}

async function getUsage(apiKey, type) {
  const today = new Date().toISOString().slice(0,10);
  const column = type === 'validate' ? 'validations' : 'enrichments';
  const res = await pool.query(
    `SELECT ${column} FROM usage WHERE api_key = $1 AND date = $2`,
    [apiKey, today]
  );
  return res.rows[0]?.[column] || 0;
}

module.exports = { incrementUsage, getUsage };