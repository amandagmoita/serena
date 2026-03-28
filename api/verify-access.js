// ─── VERIFICAÇÃO DE ACESSO DO ASSINANTE ──────────────────

import { redisGet, redisSet } from './redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const key = `subscriber:${normalizedEmail}`;
    const subscriber = await redisGet(key);

    if (!subscriber) {
      return res.status(200).json({
        access: false, reason: 'not_found',
        message: 'Esse email não tem uma assinatura ativa. Garanta seu acesso à Serena!',
      });
    }

    const now = Date.now();
    const isExpired = subscriber.expiresAt && now > subscriber.expiresAt;
    const isCanceled = subscriber.status === 'canceled';
    const isStatusExpired = subscriber.status === 'expired';
    const isPastDue = subscriber.status === 'past_due';

    if (isCanceled) {
      return res.status(200).json({
        access: false, reason: 'canceled',
        message: 'Sua assinatura foi cancelada. Reative para continuar conversando com a Serena!',
        name: subscriber.name,
      });
    }

    if (isExpired || isStatusExpired) {
      await redisSet(key, { ...subscriber, status: 'expired' });
      return res.status(200).json({
        access: false, reason: 'expired',
        message: 'Seu período de acesso expirou. Renove para continuar sua jornada com a Serena!',
        name: subscriber.name,
      });
    }

    if (isPastDue) {
      const daysRemaining = subscriber.expiresAt
        ? Math.ceil((subscriber.expiresAt - now) / (24 * 60 * 60 * 1000))
        : null;
      return res.status(200).json({
        access: true, reason: 'past_due',
        message: 'Atenção: seu pagamento está pendente. Regularize para não perder acesso.',
        name: subscriber.name, expiresAt: subscriber.expiresAt,
        daysRemaining, warning: true,
      });
    }

    const daysRemaining = subscriber.expiresAt
      ? Math.ceil((subscriber.expiresAt - now) / (24 * 60 * 60 * 1000))
      : null;

    return res.status(200).json({
      access: true, reason: 'active',
      name: subscriber.name,
      expiresAt: subscriber.expiresAt,
      daysRemaining,
    });

  } catch (error) {
    console.error('[Verify Access] Erro:', error);
    return res.status(500).json({
      access: false, reason: 'error',
      message: 'Erro ao verificar acesso. Tente novamente.',
    });
  }
}
