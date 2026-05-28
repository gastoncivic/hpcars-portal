const express = require('express');
const db = require('../db');
const { verifyToken, isAdmin } = require('./auth');
const { sendEmail, fileReady } = require('./email');

const router = express.Router();

// All admin routes require token + admin role
router.use(verifyToken, isAdmin);

// ─── STATS ───
router.get('/stats', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalFiles = db.prepare('SELECT COUNT(*) as c FROM files').get().c;
    const pendingFiles = db.prepare("SELECT COUNT(*) as c FROM files WHERE status IN ('pending','waiting','processing')").get().c;
    const usersToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = ?").get(today).c;
    const filesToday = db.prepare("SELECT COUNT(*) as c FROM files WHERE DATE(created_at) = ?").get(today).c;
    const readyFiles = db.prepare("SELECT COUNT(*) as c FROM files WHERE status = 'ready'").get().c;
    const completedFiles = db.prepare("SELECT COUNT(*) as c FROM files WHERE status = 'completed'").get().c;

    // Daily activity last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('es', { weekday: 'short' });
      const count = db.prepare('SELECT COUNT(*) as c FROM files WHERE DATE(created_at) = ?').get(dateStr).c;
      days.push({ day: dayLabel, date: dateStr, count });
    }

    // By branch
    const byBranch = {};
    ['chiptuning', 'immo', 'seedkey', 'special'].forEach(s => {
      byBranch[s] = db.prepare('SELECT COUNT(*) as c FROM files WHERE service = ?').get(s).c;
    });

    // Recent signups
    const recentUsers = db.prepare('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 5').all();

    res.json({
      totalUsers, totalFiles, pendingFiles, usersToday, filesToday,
      readyFiles, completedFiles, dailyActivity: days, byBranch, recentUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ─── ALL FILES (admin) ───
router.get('/files', (req, res) => {
  try {
    const files = db.prepare(`
      SELECT f.*, u.name as user_name, u.email as user_email
      FROM files f
      LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 200
    `).all();
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

// ─── UPDATE FILE STATUS ───
router.put('/files/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'waiting', 'ready', 'completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

  try {
    db.prepare('UPDATE files SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);

    // Get file + user info to send notification
    const file = db.prepare('SELECT f.*, u.email, u.name FROM files f LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?').get(req.params.id);

    if (file && status === 'ready') {
      // Create notification for user
      db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
        file.user_id,
        'file_ready',
        '✅ Archivo listo para descargar',
        `Tu archivo de ${file.service} para ${file.brand} ${file.model} está listo. Ingresá al portal para descargarlo.`
      );
      // Send email notification
      if (file && file.email) {
        const { subject, html } = fileReady(file.name || 'Cliente', { service: file.service, brand: file.brand, model: file.model, fileId: file.id, tunerNotes: file.tuner_notes });
        sendEmail({ to: file.email, subject, html });
        console.log(`📧 Email enviado a ${file.email}`);
      }
    }

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// ─── UPLOAD RESULT FILE ───
router.put('/files/:id/result', (req, res) => {
  const { result_filepath, tuner_notes } = req.body;
  try {
    db.prepare('UPDATE files SET result_filepath = ?, tuner_notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(result_filepath, tuner_notes || null, 'ready', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ─── DELETE FILE ───
router.delete('/files/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ─── ALL USERS ───
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM files WHERE user_id = u.id) as file_count
      FROM users u
      ORDER BY u.created_at DESC
    `).all();
    res.json({ users: users.map(u => ({ ...u, password: undefined })) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// ─── UPDATE USER MEMBERSHIP ───
router.put('/users/:id/membership', (req, res) => {
  const { level } = req.body;
  const valid = ['free', 'pro', 'enterprise'];
  if (!valid.includes(level)) return res.status(400).json({ error: 'Plan inválido' });
  try {
    db.prepare('UPDATE users SET membership_level = ? WHERE id = ?').run(level, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ─── DELETE USER ───
router.delete('/users/:id', (req, res) => {
  try {
    // Don't allow deleting yourself
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
    }
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM usage_logs WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM files WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ─── UPDATE USER ROLE ───
router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ─── USAGE LOGS ───
router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT l.*, u.email FROM usage_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC LIMIT 100
    `).all();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
