const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── DIRS ───
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, 'results');
[UPLOADS_DIR, RESULTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── MULTER ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.bin', '.ori', '.hex', '.zip', '.rar', '.7z', '.ecu', '.kess', '.cmd', '.ktag'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('application/')) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// ─── CORS ───
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// ─── MIDDLEWARE ───
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── ROUTES ───
const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);

// Files route — inject multer for submit endpoint only
const filesRouter = require('./routes/files');
app.use('/api/files', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/submit') {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  } else {
    next();
  }
}, filesRouter);

app.use('/api/admin', require('./routes/admin'));

// Legacy tools/users routes (keep for backwards compat)
app.use('/api/tools', require('./routes/tools'));
app.use('/api/users', require('./routes/users'));

// ─── HEALTH ───
app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

// ─── SPA FALLBACK ───
app.get('*', (req, res) => {
  // If the path looks like an API route return 404 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  // Otherwise serve index.html for SPA navigation
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── ERROR HANDLER ───
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// ─── START ───
app.listen(PORT, () => {
  console.log(`🚀 HP CARS Portal — http://localhost:${PORT}`);
  console.log(`📂 Uploads: ${UPLOADS_DIR}`);
  console.log(`📁 Results: ${RESULTS_DIR}`);
  console.log(`🌐 CORS: ${corsOptions.origin}`);
});

module.exports = app;
