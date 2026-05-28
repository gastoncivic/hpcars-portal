const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { db } = require('../db');
const { sendEmail, emailVerification } = require('./email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hpcars_secret_change_in_production';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com').split(',').map(e => e.trim());
const BASE_URL = process.env.BASE_URL || 'https://hpcars-portal.onrender.com';

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && !ADMIN_EMAILS.includes(req.user.email))
    return res.status(403).json({ error: 'Acceso denegado' });
  next();
};

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ─── GOOGLE OAUTH ───
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/api/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const name = profile.displayName;
    const avatar = profile.photos[0]?.value;
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const membership = role === 'admin' ? 'enterprise' : 'free';

    let user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (user) {
      await db.run('UPDATE users SET avatar_url = ?, provider = ?, email_verified = 1 WHERE id = ?', [avatar, 'google', user.id]);
      if (ADMIN_EMAILS.includes(email)) await db.run('UPDATE users SET role = ?, membership_level = ? WHERE id = ?', ['admin', 'enterprise', user.id]);
      user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    } else {
      const r = await db.run('INSERT INTO users (email, name, role, membership_level, email_verified, provider, provider_id, avatar_url) VALUES (?,?,?,?,1,?,?,?)',
        [email, name, role, membership, 'google', profile.id, avatar]);
      user = await db.get('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
    }
    await db.run('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)', [user.id, 'oauth_login', JSON.stringify({ provider: 'google' })]);
    done(null, user);
  } catch (err) { done(err); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  done(null, user);
});

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?oauth=error' }),
  (req, res) => {
    const token = makeToken(req.user);
    const user = { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, membership_level: req.user.membership_level, avatar_url: req.user.avatar_url };
    res.redirect(`/?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
  }
);

router.get('/facebook', (req, res) => res.redirect('/?oauth=facebook-pending'));
router.get('/facebook/callback', (req, res) => res.redirect('/'));

// ─── REGISTER ───
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Faltan campos' });
  if (password.length < 8) return res.status(400).json({ error: 'Contraseña mínimo 8 caracteres' });
  try {
    const hashedPw = bcrypt.hashSync(password, 12);
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const membership = role === 'admin' ? 'enterprise' : 'free';
    const result = await db.run('INSERT INTO users (email, password, name, role, membership_level, email_verified) VALUES (?,?,?,?,?,0)',
      [email, hashedPw, name, role, membership]);
    const verifyTk = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.run('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?,?,?)', [result.lastInsertRowid, verifyTk, expires]);
    console.log(`📧 Verify token for ${email}: ${verifyTk}`);
    try { const { subject, html } = emailVerification(name, verifyTk); sendEmail({ to: email, subject, html }); } catch(e) {}
    await db.run('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)', [result.lastInsertRowid, 'register', JSON.stringify({ email })]);
    res.status(201).json({ message: 'Registrado. Verificá tu email.', userId: result.lastInsertRowid });
  } catch (err) {
    if (err.message?.includes('unique') || err.code === '23505') return res.status(400).json({ error: 'El email ya está registrado' });
    console.error(err); res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── LOGIN ───
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !user.password) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (ADMIN_EMAILS.includes(email) && user.role !== 'admin') {
      await db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
      user.role = 'admin';
    }
    const token = makeToken(user);
    await db.run('INSERT INTO usage_logs (user_id, action) VALUES (?,?)', [user.id, 'login']);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, membership_level: user.membership_level, email_verified: user.email_verified } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error del servidor' }); }
});

// ─── VERIFY EMAIL ───
router.get('/verify/:token', async (req, res) => {
  try {
    const record = await db.get('SELECT * FROM email_verifications WHERE token = ? AND used = 0', [req.params.token]);
    if (!record) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Token expirado' });
    await db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [record.user_id]);
    await db.run('UPDATE email_verifications SET used = 1 WHERE id = ?', [record.id]);
    res.redirect('/?verified=1');
  } catch (err) { res.status(500).json({ error: 'Error al verificar' }); }
});

// ─── PROFILE ───
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id, email, name, role, membership_level, email_verified, avatar_url, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = { router, verifyToken, isAdmin, passport };
