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
app.use(session({
  secret: process.env.SESSION_SECRET || 'hpcars_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── PASSPORT ───
const { router: authRouter, passport } = require('./routes/auth');
app.use(passport.initialize());
app.use('/api/auth', authRouter);

// ─── SETUP ADMIN ───
app.get('/api/setup', (req, res) => {
  try {
    const db = require('./db');
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com').split(',').map(e => e.trim());
    const results = [];
    ADMIN_EMAILS.forEach(email => {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      const newPw = bcrypt.hashSync('Admin1234!', 12);
      if (existing) {
        db.prepare('UPDATE users SET role=?, membership_level=?, email_verified=1, password=? WHERE email=?').run('admin','enterprise',newPw,email);
        results.push(`✅ ${email} — admin + contraseña reseteada a Admin1234!`);
      } else {
        db.prepare('INSERT INTO users (email,password,name,role,membership_level,email_verified) VALUES (?,?,?,?,?,1)').run(email,newPw,'Admin HP CARS','admin','enterprise');
        results.push(`✅ ${email} — creado con contraseña: Admin1234!`);
      }
    });
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FILES ───
const filesRouter = require('./routes/files');
app.use('/api/files', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/submit') {
    upload.single('file')(req, res, err => { if (err) return res.status(400).json({ error: err.message }); next(); });
  } else next();
}, filesRouter);

app.use('/api/admin', require('./routes/admin'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/users', require('./routes/users'));

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// ─── LOGOUT ───
app.get('/logout', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <script>localStorage.removeItem('hpcars_token');localStorage.removeItem('hpcars_user');window.location.href='/';</script>
  </head><body style="background:#07080f;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
  <p>Cerrando sesión...</p></body></html>`);
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🚀 HP CARS Portal — http://localhost:${PORT}`);
  console.log(`📂 Uploads: ${UPLOADS_DIR}`);
  console.log(`🌐 CORS: habilitado`);
});

module.exports = app;
