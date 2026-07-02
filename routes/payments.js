const express = require('express');
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const { db } = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';
const PADDLE_ENV = (process.env.PADDLE_ENV || 'sandbox').toLowerCase();

const paddle = PADDLE_API_KEY
  ? new Paddle(PADDLE_API_KEY, {
      environment: PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox
    })
  : null;

// Planes con acceso "todo incluido" (no piden pago por archivo)
const UNLIMITED_PLANS = ['pro', 'enterprise'];

// ═══════════════════════════════════════════════
// CONFIG — el frontend llama esto para inicializar Paddle.js
// ═══════════════════════════════════════════════
router.get('/config', (req, res) => {
  res.json({
    clientToken: process.env.PADDLE_CLIENT_TOKEN || '',
    environment: PADDLE_ENV,
    prices: { pro: process.env.PADDLE_PRICE_PRO_MONTHLY || null },
    ready: Boolean(process.env.PADDLE_CLIENT_TOKEN)
  });
});

// ═══════════════════════════════════════════════
// Info para armar el checkout de un archivo puntual (pago único)
// ═══════════════════════════════════════════════
router.get('/checkout-info/:fileId', verifyToken, async (req, res) => {
  try {
    const file = await db.get('SELECT id, service, price_usd, payment_status FROM files WHERE id = ? AND user_id = ?', [req.params.fileId, req.user.id]);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (!file.price_usd) return res.status(400).json({ error: 'Este archivo no tiene precio asignado. Contactá al admin.' });

    const tool = await db.get('SELECT paddle_price_id FROM tools WHERE name = ? OR branch = ?', [file.service, file.service]);

    res.json({
      fileId: file.id,
      priceUsd: file.price_usd,
      paymentStatus: file.payment_status,
      paddlePriceId: tool?.paddle_price_id || null,
      customData: { type: 'file', fileId: String(file.id), userId: String(req.user.id) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ═══════════════════════════════════════════════
// Utilidad exportada: ¿este usuario tiene plan ilimitado activo?
// ═══════════════════════════════════════════════
function hasUnlimitedPlan(user) {
  return user?.subscription_status === 'active' && UNLIMITED_PLANS.includes(user?.subscription_plan);
}

// ═══════════════════════════════════════════════
// WEBHOOK — se monta en server.js con express.raw() ANTES de express.json()
// ═══════════════════════════════════════════════
async function webhookHandler(req, res) {
  if (!paddle || !PADDLE_WEBHOOK_SECRET) {
    console.error('⚠️ Webhook de Paddle recibido pero falta PADDLE_API_KEY / PADDLE_WEBHOOK_SECRET');
    return res.status(500).send('Paddle no configurado');
  }

  const signature = req.headers['paddle-signature'] || '';
  const rawBody = req.body.toString();

  let eventData;
  try {
    eventData = await paddle.webhooks.unmarshal(rawBody, PADDLE_WEBHOOK_SECRET, signature);
  } catch (err) {
    console.error('❌ Firma de webhook Paddle inválida:', err.message);
    return res.status(400).send('Firma inválida');
  }

  // Idempotencia
  try {
    const existing = await db.get('SELECT id FROM payment_events WHERE paddle_event_id = ?', [eventData.eventId]);
    if (existing) return res.status(200).send('OK (ya procesado)');
    await db.run('INSERT INTO payment_events (paddle_event_id, event_type, payload) VALUES (?,?,?)', [
      eventData.eventId, eventData.eventType, JSON.stringify(eventData.data)
    ]);
  } catch (err) {
    console.error('Error guardando payment_event:', err.message);
  }

  try {
    const data = eventData.data;
    const customData = data.customData || {};

    switch (eventData.eventType) {
      case 'transaction.completed': {
        if (customData.type === 'file' && customData.fileId) {
          await db.run(
            "UPDATE files SET payment_status = 'paid', paddle_transaction_id = ?, updated_at = NOW() WHERE id = ?",
            [data.id, customData.fileId]
          );
          console.log(`✅ Archivo #${customData.fileId} marcado como pagado (tx ${data.id})`);
        }
        break;
      }

      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.activated': {
        const userId = customData.userId;
        const plan = customData.plan || 'pro';
        if (userId) {
          await db.run(
            `UPDATE users SET
               paddle_customer_id = ?, paddle_subscription_id = ?, subscription_status = ?,
               subscription_plan = ?, subscription_renews_at = ?, membership_level = ?, updated_at = NOW()
             WHERE id = ?`,
            [data.customerId, data.id, data.status, plan, data.nextBilledAt || null, plan, userId]
          );
          console.log(`✅ Suscripción ${data.status} para user #${userId} (plan ${plan})`);
        }
        break;
      }

      case 'subscription.canceled':
      case 'subscription.paused': {
        const user = await db.get('SELECT id FROM users WHERE paddle_subscription_id = ?', [data.id]);
        if (user) {
          await db.run(
            "UPDATE users SET subscription_status = ?, membership_level = 'free', updated_at = NOW() WHERE id = ?",
            [eventData.eventType === 'subscription.paused' ? 'paused' : 'canceled', user.id]
          );
          console.log(`ℹ️ Suscripción ${eventData.eventType} para user #${user.id}`);
        }
        break;
      }

      default:
        console.log(`ℹ️ Evento Paddle sin manejar: ${eventData.eventType}`);
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error procesando webhook Paddle:', err);
    res.status(200).send('OK (con errores internos, ver logs)');
  }
}

module.exports = { router, webhookHandler, hasUnlimitedPlan, UNLIMITED_PLANS };
