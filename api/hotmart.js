// ─── WEBHOOK HOTMART → SERENA ────────────────────────────
// Dois produtos, duas regras:
//   Vida Autoral (7169759) → 60 dias de acesso à Serena
//   Serena Avulsa (7467966) → ativo enquanto assinatura paga
// ──────────────────────────────────────────────────────────

import { redisGet, redisSet } from './redis.js';

// ─── CONFIGURAÇÃO DOS PRODUTOS ───
const PRODUCTS = {
  '7169759': { name: 'Vida Autoral', accessDays: 60 },
  '7467966': { name: 'Serena Assinatura', accessDays: null }, // null = sem prazo fixo, ativo enquanto pagar
};

const DEFAULT_ACCESS_DAYS = 60; // fallback se produto desconhecido

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
    const productId = String(payload.data?.product?.id || payload.prod || '');
    const subscriberCode = payload.data?.subscription?.subscriber?.code || payload.subscriber_code || '';
    const transactionId = payload.data?.purchase?.transaction || payload.transaction || '';

    if (!buyerEmail) {
      return res.status(400).json({ error: 'Email não encontrado no payload' });
    }

    // ─── IDENTIFICAR PRODUTO ───
    const product = PRODUCTS[productId] || { name: 'Desconhecido', accessDays: DEFAULT_ACCESS_DAYS };

    console.log(`[Hotmart] ${event} | ${buyerEmail} | ${product.name} (${productId})`);

    // ─── PROCESSAR EVENTO ───
    const key = `subscriber:${buyerEmail}`;
    const now = Date.now();

    switch (event) {
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE': {
        const existing = await redisGet(key);

        // Calcular expiração baseada no produto
        let expiresAt;
        if (product.accessDays === null) {
          // Assinatura recorrente — sem data fixa de expiração
          expiresAt = null;
        } else {
          // Acesso por prazo fixo (Vida Autoral = 60 dias)
          expiresAt = now + (product.accessDays * 24 * 60 * 60 * 1000);
        }

        // Se já tem acesso ativo de outro produto, manter o mais longo
        if (existing && existing.status === 'active' && existing.expiresAt) {
          if (expiresAt !== null && existing.expiresAt > expiresAt) {
            expiresAt = existing.expiresAt; // manter o prazo mais longo
          }
        }

        await redisSet(key, {
          email: buyerEmail, name: buyerName, status: 'active',
          productId, productName: product.name,
          subscriberCode, transactionId,
          activatedAt: now, expiresAt,
          lastEvent: event, lastEventAt: now,
        });

        const expiryMsg = expiresAt ? `até ${new Date(expiresAt).toISOString()}` : 'sem prazo (assinatura ativa)';
        console.log(`[✓] LIBERADO ${buyerEmail} — ${product.name} — ${expiryMsg}`);
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
        console.log(`[✗] REVOGADO ${buyerEmail} — ${product.name} — ${event}`);
        break;
      }

      case 'PURCHASE_EXPIRED': {
        const existing = await redisGet(key);
        await redisSet(key, {
          ...(existing || {}), email: buyerEmail,
          status: 'expired', expiredAt: now,
          lastEvent: event, lastEventAt: now,
        });
        console.log(`[⏰] EXPIRADO ${buyerEmail} — ${product.name}`);
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
        console.log(`[⚠] ATRASADO ${buyerEmail} — ${product.name}`);
        break;
      }

      case 'SWITCH_PLAN': {
        const existing = await redisGet(key);
        await redisSet(key, {
          ...(existing || {}), email: buyerEmail,
          status: 'active', expiresAt: null,
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
