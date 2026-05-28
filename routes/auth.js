const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hpcars_secret_change_in_production';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com,gildaadmin@gmail.com').split(',');

// ─── TOKEN MIDDLEWARE ───
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && !ADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

// ─── REGISTER ───
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Faltan campos' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  try {
    const hashedPw = bcrypt.hashSync(password, 12);
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const membership = ADMIN_EMAILS.includes(email) ? 'enterprise' : 'free';

    const stmt = db.prepare('INSERT INTO users (email, password, name, role, membership_level, email_verified) VALUES (?,?,?,?,?,?)');
    const result = stmt.run(email, hashedPw, name, role, membership, 0);

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?,?,?)').run(result.lastInsertRowid, verifyToken, expires);

    // TODO: Send verification email via nodemailer/sendgrid
    // sendVerificationEmail(email, name, verifyToken);
    console.log(`📧 Verify email token for ${email}: ${verifyToken}`);

    // Log action
    db.prepare('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)').run(result.lastInsertRowid, 'register', JSON.stringify({ email, provider: 'local' }));

    res.status(201).json({ message: 'Registrado exitosamente. Verificá tu email.', userId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El email ya está registrado' });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── LOGIN ───
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Credenciales inválidas' });

    // Auto-elevate admins
    if (ADMIN_EMAILS.includes(email) && user.role !== 'admin') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
      user.role = 'admin';
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    db.prepare('INSERT INTO usage_logs (user_id, action) VALUES (?,?)').run(user.id, 'login');

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        membership_level: user.membership_level,
        email_verified: user.email_verified
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── VERIFY EMAIL ───
router.get('/verify/:token', (req, res) => {
  const { token } = req.params;
  try {
    const record = db.prepare('SELECT * FROM email_verifications WHERE token = ? AND used = 0').get(token);
    if (!record) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Token expirado' });

    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(record.user_id);
    db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(record.id);

    res.redirect('/?verified=1');
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar' });
  }
});

// ─── PROFILE ───
router.get('/profile', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, membership_level, email_verified, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── GOOGLE OAUTH (stub — configure with passport.js) ───
router.get('/google', (req, res) => {
  // TODO: Implement with passport-google-oauth20
  // For now redirect to login with info
  res.redirect('/?oauth=google-pending');
});

router.get('/google/callback', (req, res) => {
  res.redirect('/dashboard.html');
});

// ─── FACEBOOK OAUTH (stub) ───
router.get('/facebook', (req, res) => {
  res.redirect('/?oauth=facebook-pending');
});

router.get('/facebook/callback', (req, res) => {
  res.redirect('/dashboard.html');
});

module.exports = { router, verifyToken, isAdmin };
