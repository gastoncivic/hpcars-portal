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

// Obtener todas las herramientas disponibles
router.get('/', verifyToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM tools WHERE enabled = 1');
    const tools = stmt.all();
    res.json(tools);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener herramientas' });
  }
});

// Obtener herramientas accesibles para el usuario
router.get('/my-tools', verifyToken, (req, res) => {
  try {
    const query = `
      SELECT t.* FROM tools t
      JOIN user_tools ut ON t.id = ut.tool_id
      WHERE ut.user_id = ? AND ut.access_granted = 1 AND t.enabled = 1
    `;
    
    const stmt = db.prepare(query);
    const tools = stmt.all(req.user.id);
    res.json(tools);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener herramientas' });
  }
});

// Registrar uso de herramienta
router.post('/:toolId/log', verifyToken, (req, res) => {
  const { action, details } = req.body;
  const { toolId } = req.params;

  try {
    const stmt = db.prepare('INSERT INTO usage_logs (user_id, tool_id, action, details) VALUES (?, ?, ?, ?)');
    const result = stmt.run(req.user.id, toolId, action, JSON.stringify(details));
    
    res.json({ message: 'Uso registrado', logId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar uso' });
  }
});

module.exports = router;
