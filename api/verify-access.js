// ─── VERIFICAÇÃO DE ACESSO DO ASSINANTE ──────────────────
// Updated: supports 'check-email' action for new auth flow
// Also supports legacy flow (no action) for backward compatibility

import { redisGet, redisSet } from './redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, action } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const key = `subscriber:${normalizedEmail}`;
    const subscriber = await redisGet(key);

    // ══════════════════════════════════════════════════
    // NEW FLOW: check-email (for password-based auth)
    // ══════════════════════════════════════════════════
    if (action === 'check-email') {
      // 1. Check if email exists as subscriber in Redis
      if (!subscriber) {
        return res.status(200).json({
          hotmartAccess: false,
          hasAccount: false,
          message: 'Email não encontrado. Use o mesmo email da compra na Hotmart.',
        });
      }

      // 2. Check subscriber status
      const now = Date.now();
      const isExpired = subscriber.expiresAt && now > subscriber.expiresAt;
      const isCanceled = subscriber.status === 'canceled';
      const isStatusExpired = subscriber.status === 'expired';

      if (isCanceled) {
        return res.status(200).json({
          hotmartAccess: false,
          hasAccount: false,
          message: 'Sua assinatura foi cancelada.',
          reason: 'canceled',
        });
      }

      if (isExpired || isStatusExpired) {
        await redisSet(key, { ...subscriber, status: 'expired' });
        return res.status(200).json({
          hotmartAccess: false,
          hasAccount: false,
          message: 'Seu período de acesso expirou.',
          reason: 'expired',
        });
      }

      // 3. Active subscriber — check if has Serena account (user: key)
      const userAccount = await redisGet(`user:${normalizedEmail}`);
      const hasAccount = userAccount && userAccount.verified === true;

      const daysRemaining = subscriber.expiresAt
        ? Math.ceil((subscriber.expiresAt - now) / (24 * 60 * 60 * 1000))
        : null;

      return res.status(200).json({
        hotmartAccess: true,
        hasAccount: !!hasAccount,
        name: subscriber.name || '',
        expiresAt: subscriber.expiresAt,
        daysRemaining,
        warning: daysRemaining && daysRemaining <= 7,
        message: daysRemaining && daysRemaining <= 7
          ? `Seu acesso expira em ${daysRemaining} dias.`
          : undefined,
      });
    }

    // ══════════════════════════════════════════════════
    // LEGACY FLOW (no action — backward compatible)
    // ══════════════════════════════════════════════════
    if (!subscriber) {
      return res.status(200).json({
        access: false,
        reason: 'not_found',
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
        access: false,
        reason: 'canceled',
        message: 'Sua assinatura foi cancelada. Reative para continuar conversando com a Serena!',
        name: subscriber.name,
      });
    }

    if (isExpired || isStatusExpired) {
      await redisSet(key, { ...subscriber, status: 'expired' });
      return res.status(200).json({
        access: false,
        reason: 'expired',
        message: 'Seu período de acesso expirou. Renove para continuar sua jornada com a Serena!',
        name: subscriber.name,
      });
    }

    if (isPastDue) {
      const daysRemaining = subscriber.expiresAt
        ? Math.ceil((subscriber.expiresAt - now) / (24 * 60 * 60 * 1000))
        : null;
      return res.status(200).json({
        access: true,
        reason: 'past_due',
        message: 'Atenção: seu pagamento está pendente. Regularize para não perder acesso.',
        name: subscriber.name,
        expiresAt: subscriber.expiresAt,
        daysRemaining,
        warning: true,
      });
    }

    const daysRemaining = subscriber.expiresAt
      ? Math.ceil((subscriber.expiresAt - now) / (24 * 60 * 60 * 1000))
      : null;

    return res.status(200).json({
      access: true,
      reason: 'active',
      name: subscriber.name,
      expiresAt: subscriber.expiresAt,
      daysRemaining,
    });

  } catch (error) {
    console.error('[Verify Access] Erro:', error);
    return res.status(500).json({
      access: false,
      reason: 'error',
      message: 'Erro ao verificar acesso. Tente novamente em instantes.',
    });
  }
}
