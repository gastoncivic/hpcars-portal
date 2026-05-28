const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

// Middleware para verificar token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Obtener lista de usuarios (admin)
router.get('/', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, email, name, membership_level, created_at FROM users');
    const users = stmt.all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Actualizar nivel de membresía de un usuario
router.put('/:userId/membership', verifyToken, (req, res) => {
  const { membership_level } = req.body;
  const { userId } = req.params;

  if (!['free', 'basic', 'pro', 'premium'].includes(membership_level)) {
    return res.status(400).json({ error: 'Nivel de membresía inválido' });
  }

  try {
    const stmt = db.prepare('UPDATE users SET membership_level = ? WHERE id = ?');
    stmt.run(membership_level, userId);
    res.json({ message: 'Membresía actualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar membresía' });
  }
});

// Otorgar acceso a herramienta
router.post('/:userId/grant-tool', verifyToken, (req, res) => {
  const { toolId } = req.body;
  const { userId } = req.params;

  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO user_tools (user_id, tool_id, access_granted) VALUES (?, ?, 1)');
    stmt.run(userId, toolId);
    res.json({ message: 'Acceso otorgado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al otorgar acceso' });
  }
});

// Revocar acceso a herramienta
router.post('/:userId/revoke-tool', verifyToken, (req, res) => {
  const { toolId } = req.body;
  const { userId } = req.params;

  try {
    const stmt = db.prepare('UPDATE user_tools SET access_granted = 0 WHERE user_id = ? AND tool_id = ?');
    stmt.run(userId, toolId);
    res.json({ message: 'Acceso revocado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al revocar acceso' });
  }
});

module.exports = router;
