const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10
});

console.log('✅ Conectado a PostgreSQL (Neon)');

// ─── QUERY HELPER ───
// Converts SQLite ? params to PostgreSQL $1, $2...
async function query(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return result;
}

// SQLite-compatible helpers
const db = {
  // Returns first row or undefined
  async get(sql, params = []) {
    const r = await query(sql, params);
    return r.rows[0] || undefined;
  },
  // Returns all rows
  async all(sql, params = []) {
    const r = await query(sql, params);
    return r.rows;
  },
  // Returns { lastInsertRowid, changes }
  async run(sql, params = []) {
    // Add RETURNING id for INSERT
    let pgSql = sql;
    if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
      pgSql = sql + ' RETURNING id';
    }
    let i = 0;
    pgSql = pgSql.replace(/\?/g, () => `$${++i}`);
    const r = await pool.query(pgSql, params);
    return { lastInsertRowid: r.rows[0]?.id, changes: r.rowCount };
  },
  // Execute raw SQL (no params)
  async exec(sql) {
    return pool.query(sql);
  },
  pool
};

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT NOT NULL DEFAULT '',
      role TEXT DEFAULT 'user',
      membership_level TEXT DEFAULT 'free',
      email_verified INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'local',
      provider_id TEXT,
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      service TEXT NOT NULL,
      filename TEXT,
      filepath TEXT,
      brand TEXT,
      model TEXT,
      year TEXT,
      ecu TEXT,
      engine TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      result_filepath TEXT,
      tuner_notes TEXT,
      payment_status TEXT DEFAULT 'pending',
      payment_id TEXT,
      download_count INTEGER DEFAULT 0,
      download_limit INTEGER DEFAULT 3,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      category TEXT,
      branch TEXT,
      icon TEXT,
      enabled INTEGER DEFAULT 1,
      is_automatic INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT,
      title TEXT,
      message TEXT,
      read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('✅ Tablas inicializadas');

  // Seed admins
  const adminEmails = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com').split(',').map(e => e.trim());
  for (const email of adminEmails) {
    await pool.query(`
      INSERT INTO users (email, name, role, email_verified, membership_level)
      VALUES ($1, 'Admin HP CARS', 'admin', 1, 'enterprise')
      ON CONFLICT (email) DO UPDATE SET role = 'admin', membership_level = 'enterprise'
    `, [email]);
  }

  // Seed tools
  const tc = await pool.query('SELECT COUNT(*) as count FROM tools');
  if (parseInt(tc.rows[0].count) === 0) {
    const tools = [
      ['Chiptuning Stage 1','Remapeo ECU Stage 1','chiptuning','chiptuning','🔥',1,1],
      ['Chiptuning Stage 2','Remapeo ECU Stage 2','chiptuning','chiptuning','🔥',1,0],
      ['DPF OFF','Eliminación filtro de partículas','chiptuning','chiptuning','💨',1,0],
      ['EGR OFF','Desactivación sistema EGR','chiptuning','chiptuning','⚙️',1,1],
      ['IMMO OFF E78','Inmovilizador E78','immo','immo','🔓',1,0],
      ['IMMO OFF E80','Inmovilizador E80','immo','immo','🔓',1,0],
      ['PSA Seed Key','Llave PSA todos los algoritmos','seedkey','seedkey','🔑',1,1],
      ['VAG Seed Key','Llave VAG IMMO4/IMMO5','seedkey','seedkey','🔑',1,1],
      ['EEPROM Recovery','Recuperación EEPROM','special','special','⚡',1,0],
    ];
    for (const t of tools) {
      await pool.query(
        'INSERT INTO tools (name,description,branch,category,icon,enabled,is_automatic) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (name) DO NOTHING',
        t
      );
    }
    console.log('✅ Herramientas insertadas');
  }
}

module.exports = { db, pool, initializeDatabase };
