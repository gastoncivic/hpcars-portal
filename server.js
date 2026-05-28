const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, 'results');
[UPLOADS_DIR, RESULTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'hpcars_session', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`); next(); });

// ─── INIT DB THEN START ───
const { initializeDatabase, db } = require('./db');

const { router: authRouter, passport } = require('./routes/auth');
app.use(passport.initialize());
app.use('/api/auth', authRouter);

// ─── SETUP ADMIN ───
app.get('/api/setup', async (req, res) => {
  try {
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com').split(',').map(e => e.trim());
    const results = [];
    for (const email of ADMIN_EMAILS) {
      const newPw = bcrypt.hashSync('Admin1234!', 12);
      const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        await db.run('UPDATE users SET role=?, membership_level=?, email_verified=1, password=? WHERE email=?', ['admin','enterprise',newPw,email]);
        results.push(`✅ ${email} — admin + contraseña reseteada`);
      } else {
        await db.run('INSERT INTO users (email,password,name,role,membership_level,email_verified) VALUES (?,?,?,?,?,1)', [email,newPw,'Admin HP CARS','admin','enterprise']);
        results.push(`✅ ${email} — creado con Admin1234!`);
      }
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const filesRouter = require('./routes/files');
app.use('/api/files', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/submit') {
    upload.single('file')(req, res, err => { if (err) return res.status(400).json({ error: err.message }); next(); });
  } else next();
}, filesRouter);

app.use('/api/admin', require('./routes/admin'));

app.get('/logout', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><script>localStorage.removeItem('hpcars_token');localStorage.removeItem('hpcars_user');window.location.href='/';</script></head><body style="background:#07080f;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><p>Cerrando sesión...</p></body></html>`);
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => { console.error('Error:', err.message); res.status(500).json({ error: err.message }); });

// Init DB then listen
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 HP CARS Portal — http://localhost:${PORT}`);
    console.log(`📂 Uploads: ${UPLOADS_DIR}`);
    console.log(`🗄️ Database: PostgreSQL (Neon)`);
  });
}).catch(err => { console.error('DB init error:', err); process.exit(1); });

module.exports = app;
