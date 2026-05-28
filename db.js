const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hpcars.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('✅ Conectado a SQLite:', DB_PATH);

function initializeDatabase() {
  // ─── USERS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      membership_level TEXT DEFAULT 'free',
      email_verified INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'local',
      provider_id TEXT,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── FILES ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ─── TOOLS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      category TEXT,
      branch TEXT,
      icon TEXT,
      enabled INTEGER DEFAULT 1,
      is_automatic INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── USAGE LOGS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT,
      details TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ─── EMAIL VERIFICATIONS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ─── NOTIFICATIONS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT,
      title TEXT,
      message TEXT,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  console.log('✅ Tablas de base de datos inicializadas');

  // Seed admin users
  const adminEmails = ['angelgastoncalvo@gmail.com'];
  adminEmails.forEach(email => {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO users (email, name, role, email_verified, membership_level) VALUES (?, ?, ?, 1, ?)').run(
        email, 'Angel Gastón Calvo', 'admin', 'enterprise'
      );
    } else {
      db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', email);
    }
  });

  // Seed default tools
  const toolCount = db.prepare('SELECT COUNT(*) as count FROM tools').get();
  if (toolCount.count === 0) {
    const tools = [
      ['Chiptuning Stage 1', 'Remapeo ECU Stage 1', 'chiptuning', 'chiptuning', '🔥', 1, 1],
      ['Chiptuning Stage 2', 'Remapeo ECU Stage 2', 'chiptuning', 'chiptuning', '🔥', 1, 0],
      ['DPF OFF', 'Eliminación filtro de partículas', 'chiptuning', 'chiptuning', '💨', 1, 0],
      ['EGR OFF', 'Desactivación sistema EGR', 'chiptuning', 'chiptuning', '⚙️', 1, 1],
      ['IMMO OFF E78', 'Inmovilizador E78', 'immo', 'immo', '🔓', 1, 0],
      ['IMMO OFF E80', 'Inmovilizador E80', 'immo', 'immo', '🔓', 1, 0],
      ['PSA Seed Key', 'Llave PSA todos los algoritmos', 'seedkey', 'seedkey', '🔑', 1, 1],
      ['VAG Seed Key', 'Llave VAG IMMO4/IMMO5', 'seedkey', 'seedkey', '🔑', 1, 1],
      ['EEPROM Recovery', 'Recuperación EEPROM', 'special', 'special', '⚡', 1, 0],
    ];
    const stmt = db.prepare('INSERT INTO tools (name, description, branch, category, icon, enabled, is_automatic) VALUES (?,?,?,?,?,?,?)');
    tools.forEach(t => stmt.run(...t));
    console.log('✅ Herramientas por defecto insertadas');
  }
}

initializeDatabase();

module.exports = db;
