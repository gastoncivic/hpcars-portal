const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');
const { sendEmail, emailVerification } = require('./email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hpcars_secret_change_in_production';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'angelgastoncalvo@gmail.com').split(',').map(e => e.trim());
const BASE_URL = process.env.BASE_URL || 'https://hpcars-portal.onrender.com';

// ─── MIDDLEWARES ───
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

// ─── HELPER: generar JWT ───
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ─── GOOGLE OAUTH ───
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/api/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const name = profile.displayName;
    const avatar = profile.photos[0]?.value;
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const membership = ADMIN_EMAILS.includes(email) ? 'enterprise' : 'free';

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
      db.prepare('UPDATE users SET avatar_url = ?, provider = ?, email_verified = 1 WHERE id = ?')
        .run(avatar, 'google', user.id);
      if (ADMIN_EMAILS.includes(email)) {
        db.prepare('UPDATE users SET role = ?, membership_level = ? WHERE id = ?')
          .run('admin', 'enterprise', user.id);
      }
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      const result = db.prepare(
        'INSERT INTO users (email, name, role, membership_level, email_verified, provider, provider_id, avatar_url) VALUES (?,?,?,?,1,?,?,?)'
      ).run(email, name, role, membership, 'google', profile.id, avatar);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    db.prepare('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)').run(
      user.id, 'oauth_login', JSON.stringify({ provider: 'google' })
    );

    done(null, user);
  } catch (err) {
    done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user);
});

// ─── GOOGLE ROUTES ───
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false
}));

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?oauth=error' }),
  (req, res) => {
    const token = makeToken(req.user);
    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      membership_level: req.user.membership_level,
      avatar_url: req.user.avatar_url
    };
    // Always redirect to landing page — it handles the routing
    res.redirect(`/?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
  }
);

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

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?,?,?)').run(result.lastInsertRowid, verifyToken, expires);

    console.log(`📧 Verify email token for ${name}: ${verifyToken}`);
    // Send verification email
    const { subject, html } = emailVerification(name, verifyToken);
    sendEmail({ to: email, subject, html });

    db.prepare('INSERT INTO usage_logs (user_id, action, details) VALUES (?,?,?)').run(result.lastInsertRowid, 'register', JSON.stringify({ email }));

    res.status(201).json({ message: 'Registrado. Verificá tu email.', userId: result.lastInsertRowid });
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

    if (ADMIN_EMAILS.includes(email) && user.role !== 'admin') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
      user.role = 'admin';
    }

    const token = makeToken(user);
    db.prepare('INSERT INTO usage_logs (user_id, action) VALUES (?,?)').run(user.id, 'login');

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, membership_level: user.membership_level, email_verified: user.email_verified }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── VERIFY EMAIL ───
router.get('/verify/:token', (req, res) => {
  try {
    const record = db.prepare('SELECT * FROM email_verifications WHERE token = ? AND used = 0').get(req.params.token);
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
    const user = db.prepare('SELECT id, email, name, role, membership_level, email_verified, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── FACEBOOK (stub — add passport-facebook when ready) ───
router.get('/facebook', (req, res) => res.redirect('/?oauth=facebook-pending'));
router.get('/facebook/callback', (req, res) => res.redirect('/'));

module.exports = { router, verifyToken, isAdmin, passport };
