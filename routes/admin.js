const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { verifyToken, isAdmin } = require('./auth');
const { sendEmail, fileReady } = require('./email');

const router = express.Router();

router.use((req, res, next) => {
  if (req.query.t && !req.headers.authorization) req.headers.authorization = 'Bearer ' + req.query.t;
  next();
});
router.use(verifyToken, isAdmin);

// ─── STATS ───
router.get('/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [totalUsers, totalFiles, pendingFiles, usersToday, filesToday, readyFiles, completedFiles] = await Promise.all([
      db.get('SELECT COUNT(*) as c FROM users'),
      db.get('SELECT COUNT(*) as c FROM files'),
      db.get("SELECT COUNT(*) as c FROM files WHERE status IN ('pending','waiting','processing')"),
      db.get('SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = ?', [today]),
      db.get('SELECT COUNT(*) as c FROM files WHERE DATE(created_at) = ?', [today]),
      db.get("SELECT COUNT(*) as c FROM files WHERE status = 'ready'"),
      db.get("SELECT COUNT(*) as c FROM files WHERE status = 'completed'"),
    ]);

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('es', { weekday: 'short' });
      const cnt = await db.get('SELECT COUNT(*) as c FROM files WHERE DATE(created_at) = ?', [dateStr]);
      days.push({ day: dayLabel, date: dateStr, count: parseInt(cnt.c) });
    }

    const byBranch = {};
    for (const s of ['chiptuning','immo','seedkey','special']) {
      const r = await db.get('SELECT COUNT(*) as c FROM files WHERE service = ?', [s]);
      byBranch[s] = parseInt(r.c);
    }

    const recentUsers = await db.all('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 5');

    res.json({
      totalUsers: parseInt(totalUsers.c), totalFiles: parseInt(totalFiles.c),
      pendingFiles: parseInt(pendingFiles.c), usersToday: parseInt(usersToday.c),
      filesToday: parseInt(filesToday.c), readyFiles: parseInt(readyFiles.c),
      completedFiles: parseInt(completedFiles.c), dailyActivity: days, byBranch, recentUsers
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ─── ALL FILES ───
router.get('/files', async (req, res) => {
  try {
    const files = await db.all(`
      SELECT f.id, f.service, f.filename, f.filepath, f.brand, f.model, f.year, 
             f.ecu, f.engine, f.description, f.status, f.tuner_notes, 
             f.download_count, f.download_limit, f.expires_at,
             f.payment_status, f.result_filepath, f.created_at, f.updated_at,
             u.name as user_name, u.email as user_email
      FROM files f LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC LIMIT 200
    `);
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── UPDATE FILE STATUS ───
router.put('/files/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending','processing','waiting','ready','completed'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    await db.run('UPDATE files SET status = ?, updated_at = NOW() WHERE id = ?', [status, req.params.id]);
    if (status === 'ready') {
      const file = await db.get('SELECT f.*, u.email, u.name FROM files f LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?', [req.params.id]);
      if (file) {
        await db.run('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)',
          [file.user_id, 'file_ready', '✅ Archivo listo', `Tu archivo de ${file.service} para ${file.brand} ${file.model} está listo.`]);
        try {
          const { subject, html } = fileReady(file.name||'Cliente', { service: file.service, brand: file.brand, model: file.model, fileId: file.id });
          sendEmail({ to: file.email, subject, html }).catch(e => console.error('Email error:', e.message));
        } catch(e) {}
      }
    }
    res.json({ success: true, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DOWNLOAD ORIGINAL ───
router.get('/files/:id/download-original', async (req, res) => {
  try {
    const file = await db.get('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (!file.filepath) return res.status(404).json({ error: 'Sin archivo original' });
    if (!fs.existsSync(file.filepath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    res.download(file.filepath, file.filename || `original_${file.id}.bin`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── UPLOAD RESULT ───
router.post('/files/:id/upload-result', async (req, res) => {
  const multer = require('multer');
  const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, '../results');
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, RESULTS_DIR),
    filename: (req, file, cb) => cb(null, `result_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`)
  });
  const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }).single('result');
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    try {
      const { tuner_notes } = req.body;
      const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      await db.run('UPDATE files SET result_filepath=?, tuner_notes=?, status=?, download_count=0, download_limit=3, expires_at=?, updated_at=NOW() WHERE id=?',
        [req.file.path, tuner_notes||null, 'ready', expiresAt, req.params.id]);
      const file = await db.get('SELECT f.*, u.email, u.name FROM files f LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?', [req.params.id]);
      if (file) {
        await db.run('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)',
          [file.user_id, 'file_ready', '✅ Archivo listo para descargar', `Tu archivo de ${file.service} está listo.`]);
        // Fire and forget — don't block the response
        try {
          const { subject, html } = fileReady(file.name||'Cliente', { service: file.service, brand: file.brand, model: file.model, fileId: file.id, tunerNotes: tuner_notes });
          console.log(`📧 Enviando a ${file.email}`);
          sendEmail({ to: file.email, subject, html })
            .then(r => console.log(`📧 Resultado:`, JSON.stringify(r)))
            .catch(e => console.error('📧 Email error:', e.message));
        } catch(e) { console.error('Email setup error:', e.message); }
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

// ─── DELETE FILE ───
router.delete('/files/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM files WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ALL USERS ───
router.get('/users', async (req, res) => {
  try {
    const users = await db.all('SELECT u.*, (SELECT COUNT(*) FROM files WHERE user_id = u.id) as file_count FROM users u ORDER BY u.created_at DESC');
    res.json({ users: users.map(u => ({ ...u, password: undefined })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/membership', async (req, res) => {
  const { level } = req.body;
  if (!['free','pro','enterprise'].includes(level)) return res.status(400).json({ error: 'Plan inválido' });
  try { await db.run('UPDATE users SET membership_level = ? WHERE id = ?', [level, req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try { await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
    await db.run('DELETE FROM notifications WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM usage_logs WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM email_verifications WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM files WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/logs', async (req, res) => {
  try {
    const logs = await db.all('SELECT l.*, u.email FROM usage_logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 100');
    res.json({ logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
