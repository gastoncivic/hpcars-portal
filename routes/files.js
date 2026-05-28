const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { verifyToken } = require('./auth');
const { sendEmail, fileReceived, fileReady } = require('./email');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, '../results');
[UPLOADS_DIR, RESULTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── SUBMIT FILE ───
router.post('/submit', verifyToken, async (req, res) => {
  const { service, brand, model, year, ecu, engine, description } = req.body;
  const file = req.file;
  if (!service || !brand || !model) return res.status(400).json({ error: 'Faltan campos: service, brand, model' });
  try {
    // Auto-restore user if needed
    const existingUser = await db.get('SELECT id FROM users WHERE id = ?', [req.user.id]);
    if (!existingUser) {
      const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e=>e.trim());
      const role = ADMIN_EMAILS.includes(req.user.email) ? 'admin' : 'user';
      await db.run('INSERT INTO users (id, email, name, role, membership_level, email_verified) VALUES (?,?,?,?,?,1) ON CONFLICT (id) DO NOTHING',
        [req.user.id, req.user.email, req.user.email.split('@')[0], role, role==='admin'?'enterprise':'free']);
    }

    const result = await db.run(
      'INSERT INTO files (user_id, service, filename, filepath, brand, model, year, ecu, engine, description, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, service, file?.originalname||null, file?.path||null, brand, model, year||null, ecu||null, engine||null, description||null, 'pending']
    );

    await db.run('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)',
      [req.user.id, 'file_submitted', '📁 Archivo recibido', `Tu archivo de ${service} para ${brand} ${model} fue recibido.`]);

    try {
      const userRow = await db.get('SELECT name, email FROM users WHERE id = ?', [req.user.id]);
      if (userRow?.email) {
        const { subject, html } = fileReceived(userRow.name, { service, brand, model, fileId: result.lastInsertRowid });
        sendEmail({ to: userRow.email, subject, html });
      }
    } catch(e) { console.error('Email error:', e.message); }

    res.json({ success: true, id: result.lastInsertRowid, message: 'Archivo recibido.' });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Error al procesar: ' + err.message });
  }
});

// ─── MY FILES ───
router.get('/my', verifyToken, async (req, res) => {
  try {
    const files = await db.all(
      'SELECT id, service, filename, brand, model, year, ecu, engine, description, status, payment_status, tuner_notes, download_count, download_limit, expires_at, created_at, updated_at FROM files WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ files });
  } catch (err) { res.status(500).json({ error: 'Error al obtener archivos' }); }
});

// ─── SINGLE FILE ───
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.json(file);
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});

// ─── DOWNLOAD ───
router.get('/download/:id', verifyToken, async (req, res) => {
  try {
    const file = await db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (file.status === 'expired') return res.status(410).json({ error: 'El archivo expiró (2 días o 3 descargas)' });
    if (!['ready','completed'].includes(file.status)) return res.status(403).json({ error: 'El archivo no está listo' });
    if (!file.result_filepath || !fs.existsSync(file.result_filepath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });

    if (file.expires_at && new Date(file.expires_at) < new Date()) {
      await db.run("UPDATE files SET status = 'expired' WHERE id = ?", [file.id]);
      try { fs.unlinkSync(file.result_filepath); } catch(e) {}
      return res.status(410).json({ error: 'El archivo expiró' });
    }

    const newCount = (file.download_count || 0) + 1;
    const limit = file.download_limit || 3;

    await db.run('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)',
      [req.user.id, 'download', JSON.stringify({ fileId: file.id, downloadNum: newCount })]);

    if (newCount >= limit) {
      await db.run("UPDATE files SET download_count = ?, status = 'expired' WHERE id = ?", [newCount, file.id]);
      res.download(file.result_filepath, `hpcars_${file.service}_${file.brand}_${file.model}.bin`, () => {
        try { fs.unlinkSync(file.result_filepath); } catch(e) {}
      });
    } else {
      await db.run('UPDATE files SET download_count = ? WHERE id = ?', [newCount, file.id]);
      res.download(file.result_filepath, `hpcars_${file.service}_${file.brand}_${file.model}.bin`);
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al descargar' }); }
});

// ─── NOTIFICATIONS ───
router.get('/notifications/my', verifyToken, async (req, res) => {
  try {
    const notifs = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.id]);
    res.json({ notifications: notifs });
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.put('/notifications/:id/read', verifyToken, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

module.exports = router;
