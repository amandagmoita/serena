// ─── WEBHOOK HOTMART → SERENA ────────────────────────────
// Recebe eventos da Hotmart e gerencia acesso dos assinantes
// ──────────────────────────────────────────────────────────

import { redisGet, redisSet } from './redis.js';

const MAX_ACCESS_DAYS = 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;

    // ─── VERIFICAR HOTTOK ───
    const hottok = payload.hottok || payload.data?.hottok;
    if (hottok && hottok !== process.env.HOTMART_HOTTOK) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    // ─── EXTRAIR DADOS ───
    const event = payload.event;
    const buyerEmail = (
      payload.data?.buyer?.email ||
      payload.data?.subscriber?.email ||
      payload.email ||
      ''
    ).toLowerCase().trim();

    const buyerName = payload.data?.buyer?.name || payload.data?.subscriber?.name || '';
    const productId = payload.data?.product?.id || payload.prod || '';
    const subscriberCode = payload.data?.subscription?.subscriber?.code || payload.subscriber_code || '';
    const transactionId = payload.data?.purchase?.transaction || payload.transaction || '';

    if (!buyerEmail) {
      return res.status(400).json({ error: 'Email não encontrado no payload' });
    }

    console.log(`[Hotmart] ${event} | ${buyerEmail} | prod:${productId}`);

    // ─── PROCESSAR EVENTO ───
    const key = `subscriber:${buyerEmail}`;
    const now = Date.now();

    switch (event) {
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE': {
        const expiresAt = now + (MAX_ACCESS_DAYS * 24 * 60 * 60 * 1000);
        await redisSet(key, {
          email: buyerEmail, name: buyerName, status: 'active',
          productId, subscriberCode, transactionId,
          activatedAt: now, expiresAt,
          lastEvent: event, lastEventAt: now,
        });
        console.log(`[✓] LIBERADO ${buyerEmail} até ${new Date(expiresAt).toISOString()}`);
        break;
      }

      case 'SUBSCRIPTION_CANCELLATION':
      case 'PURCHASE_REFUNDED':
      case 'PURCHASE_CHARGEBACK':
      case 'PURCHASE_CANCELED': {
        const existing = await redisGet(key);
        await redisSet(key, {
          ...(existing || {}), email: buyerEmail,
          status: 'canceled', canceledAt: now,
          lastEvent: event, lastEventAt: now,
        });
        console.log(`[✗] REVOGADO ${buyerEmail} — ${event}`);
        break;
      }

      case 'PURCHASE_EXPIRED': {
        const existing = await redisGet(key);
        await redisSet(key, {
          ...(existing || {}), email: buyerEmail,
          status: 'expired', expiredAt: now,
          lastEvent: event, lastEventAt: now,
        });
        console.log(`[⏰] EXPIRADO ${buyerEmail}`);
        break;
      }

      case 'PURCHASE_PROTEST':
      case 'PURCHASE_DELAYED': {
        const existing = await redisGet(key);
        if (existing) {
          await redisSet(key, {
            ...existing, status: 'past_due',
            lastEvent: event, lastEventAt: now,
          });
        }
        console.log(`[⚠] ATRASADO ${buyerEmail}`);
        break;
      }

      case 'SWITCH_PLAN': {
        const existing = await redisGet(key);
        const expiresAt = now + (MAX_ACCESS_DAYS * 24 * 60 * 60 * 1000);
        await redisSet(key, {
          ...(existing || {}), email: buyerEmail,
          status: 'active', expiresAt,
          lastEvent: event, lastEventAt: now,
        });
        console.log(`[↻] PLANO ATUALIZADO ${buyerEmail}`);
        break;
      }

      default:
        console.log(`[?] Evento não tratado: ${event}`);
    }

    return res.status(200).json({ received: true, event });

  } catch (error) {
    console.error('[Hotmart Webhook] Erro:', error);
    return res.status(200).json({ received: true, error: 'Processamento falhou' });
  }
}
