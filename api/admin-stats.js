// ─── ADMIN: ESTATÍSTICAS E DASHBOARD ─────────────────────
// Retorna dados agregados para o painel admin
// ──────────────────────────────────────────────────────────

import { redisCommand } from './redis.js';
import { redisGet } from './redis.js';

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
    const { action } = req.body;

    switch (action) {
      case 'stats': {
        // Buscar todas as chaves de assinantes
        const keys = await redisCommand('KEYS', 'subscriber:*');
        
        let total = 0, active = 0, canceled = 0, expired = 0, pastDue = 0;
        const subscribers = [];
        const now = Date.now();

        for (const key of (keys || [])) {
          const data = await redisGet(key);
          if (!data) continue;
          total++;

          // Verificar se expirou pelo prazo
          const isTimeExpired = data.expiresAt && now > data.expiresAt;

          if (data.status === 'active' && !isTimeExpired) active++;
          else if (data.status === 'canceled') canceled++;
          else if (data.status === 'expired' || isTimeExpired) expired++;
          else if (data.status === 'past_due') pastDue++;

          subscribers.push({
            email: data.email,
            name: data.name || '',
            status: isTimeExpired && data.status === 'active' ? 'expired' : data.status,
            productName: data.productName || '—',
            activatedAt: data.activatedAt,
            expiresAt: data.expiresAt,
            daysRemaining: data.expiresAt ? Math.ceil((data.expiresAt - now) / 86400000) : null,
            lastEvent: data.lastEvent,
          });
        }

        // Ordenar por data de ativação (mais recente primeiro)
        subscribers.sort((a, b) => (b.activatedAt || 0) - (a.activatedAt || 0));

        // Buscar conversas para estatísticas de uso
        const convoKeys = await redisCommand('KEYS', 'convos:*:index');
        let totalConversations = 0;
        let totalMessages = 0;
        let activeUsers7d = 0;
        const sevenDaysAgo = now - (7 * 86400000);

        for (const key of (convoKeys || [])) {
          const index = await redisGet(key);
          if (!index || !Array.isArray(index)) continue;
          totalConversations += index.length;
          let userActive = false;
          for (const convo of index) {
            totalMessages += convo.messageCount || 0;
            if (convo.updatedAt && convo.updatedAt > sevenDaysAgo) userActive = true;
          }
          if (userActive) activeUsers7d++;
        }

        return res.status(200).json({
          summary: { total, active, canceled, expired, pastDue },
          usage: { totalConversations, totalMessages, activeUsers7d },
          subscribers,
        });
      }

      default:
        return res.status(400).json({ error: 'Use: stats' });
    }

  } catch (error) {
    console.error('[Admin Stats] Erro:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
