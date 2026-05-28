const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { verifyToken } = require('./auth');
const { sendEmail, fileReceived } = require('./email');

const router = express.Router();

// Ensure uploads directory exists
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, '../results');
[UPLOADS_DIR, RESULTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── SUBMIT FILE ───
router.post('/submit', verifyToken, (req, res) => {
  // Note: requires multer middleware. Add to server.js:
  // const multer = require('multer');
  // const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 50 * 1024 * 1024 } });
  // app.use('/api/files', upload.single('file'), require('./routes/files'));

  const { service, brand, model, year, ecu, engine, description } = req.body;
  const file = req.file;

  if (!service || !brand || !model) {
    return res.status(400).json({ error: 'Faltan campos requeridos: service, brand, model' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO files (user_id, service, filename, filepath, brand, model, year, ecu, engine, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      req.user.id,
      service,
      file ? file.originalname : null,
      file ? file.path : null,
      brand, model, year || null, ecu || null, engine || null,
      description || null,
      'pending'
    );

    // Create notification for user
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
      req.user.id,
      'file_submitted',
      '📁 Archivo recibido',
      `Tu archivo de ${service} para ${brand} ${model} fue recibido. Te notificaremos cuando esté listo.`
    );

    // Send confirmation email
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);
    if (user) {
      const { subject, html } = fileReceived(user.name, { service, brand, model, fileId: result.lastInsertRowid });
      sendEmail({ to: user.email, subject, html });
    }

    // TODO: Notify admin
    console.log(`📨 Nuevo archivo: user=${req.user.email} service=${service} ${brand} ${model}`);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Archivo recibido. Te notificaremos por email cuando esté listo.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el archivo' });
  }
});

// ─── MY FILES ───
router.get('/my', verifyToken, (req, res) => {
  try {
    const files = db.prepare(`
      SELECT id, service, filename, brand, model, year, ecu, engine, description, status, payment_status, tuner_notes, created_at, updated_at
      FROM files WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

// ─── SINGLE FILE STATUS ───
router.get('/:id', verifyToken, (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── DOWNLOAD ───
router.get('/download/:id', verifyToken, (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (file.status === 'expired') return res.status(410).json({ error: 'El archivo expiró (2 días o 3 descargas)' });
    if (file.status !== 'ready' && file.status !== 'completed') return res.status(403).json({ error: 'El archivo no está listo para descargar' });
    if (!file.result_filepath || !fs.existsSync(file.result_filepath)) {
      return res.status(404).json({ error: 'Archivo resultado no encontrado en el servidor' });
    }

    // Check expiry
    if (file.expires_at && new Date(file.expires_at) < new Date()) {
      db.prepare("UPDATE files SET status = 'expired' WHERE id = ?").run(file.id);
      try { fs.unlinkSync(file.result_filepath); } catch(e) {}
      return res.status(410).json({ error: 'El archivo expiró (límite de 2 días alcanzado)' });
    }

    // Check download limit
    const newCount = (file.download_count || 0) + 1;
    const limit = file.download_limit || 3;
    
    if (newCount >= limit) {
      // Last download — mark expired after this one
      db.prepare("UPDATE files SET download_count = ?, status = 'expired' WHERE id = ?").run(newCount, file.id);
      // Send download then delete file
      res.download(file.result_filepath, `hpcars_${file.service}_${file.brand}_${file.model}.bin`, (err) => {
        if (!err) {
          try { fs.unlinkSync(file.result_filepath); } catch(e) {}
        }
      });
    } else {
      db.prepare('UPDATE files SET download_count = ? WHERE id = ?').run(newCount, file.id);
      res.download(file.result_filepath, `hpcars_${file.service}_${file.brand}_${file.model}.bin`);
    }

    // Log download
    db.prepare('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)').run(
      req.user.id, 'download', JSON.stringify({ fileId: file.id, service: file.service, downloadNum: newCount, limit })
    );

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar' });
  }
});

// ─── NOTIFICATIONS ───
router.get('/notifications/my', verifyToken, (req, res) => {
  try {
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
    res.json({ notifications: notifs });
  } catch {
    res.status(500).json({ error: 'Error' });
  }
});

router.put('/notifications/:id/read', verifyToken, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
