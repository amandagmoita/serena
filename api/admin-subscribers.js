// ─── ADMIN: GERENCIAR ASSINANTES ─────────────────────────

import { redisGet, redisSet, redisDel } from './redis.js';

const MAX_ACCESS_DAYS = 365;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const { action, email, days } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const key = `subscriber:${normalizedEmail}`;

    switch (action) {
      case 'add': {
        const accessDays = days || MAX_ACCESS_DAYS;
        const now = Date.now();
        const expiresAt = now + (accessDays * 24 * 60 * 60 * 1000);
        await redisSet(key, {
          email: normalizedEmail, name: '', status: 'active',
          productId: 'manual', subscriberCode: '',
          transactionId: 'admin-manual',
          activatedAt: now, expiresAt,
          lastEvent: 'ADMIN_ADD', lastEventAt: now,
        });
        return res.status(200).json({
          success: true,
          message: `Acesso liberado para ${normalizedEmail} por ${accessDays} dias`,
          expiresAt: new Date(expiresAt).toISOString(),
        });
      }

      case 'check': {
        const subscriber = await redisGet(key);
        if (!subscriber) {
          return res.status(200).json({ found: false, email: normalizedEmail });
        }
        return res.status(200).json({
          found: true, ...subscriber,
          expiresAtFormatted: subscriber.expiresAt ? new Date(subscriber.expiresAt).toISOString() : null,
          isExpired: subscriber.expiresAt ? Date.now() > subscriber.expiresAt : false,
        });
      }

      case 'remove': {
        await redisDel(key);
        return res.status(200).json({
          success: true, message: `Acesso removido para ${normalizedEmail}`,
        });
      }

      case 'extend': {
        const subscriber = await redisGet(key);
        if (!subscriber) {
          return res.status(404).json({ error: 'Assinante não encontrado' });
        }
        const extraDays = days || 30;
        const baseTime = Math.max(subscriber.expiresAt || Date.now(), Date.now());
        const newExpiry = baseTime + (extraDays * 24 * 60 * 60 * 1000);
        await redisSet(key, {
          ...subscriber, expiresAt: newExpiry,
          lastEvent: 'ADMIN_EXTEND', lastEventAt: Date.now(),
        });
        return res.status(200).json({
          success: true,
          message: `Acesso estendido em ${extraDays} dias para ${normalizedEmail}`,
          expiresAt: new Date(newExpiry).toISOString(),
        });
      }

      default:
        return res.status(400).json({ error: 'Use: add, check, remove, extend' });
    }

  } catch (error) {
    console.error('[Admin] Erro:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
