// ─── API DE CONVERSAS ────────────────────────────────────
// Salva e recupera histórico de conversas por email
// + Perfil HD da usuária (save-profile / load-profile)
// ──────────────────────────────────────────────────────────
import { redisGet, redisSet, redisDel, redisCommand } from './redis.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { action, email, conversationId, title, messages, preview, profile } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });
    const normalizedEmail = email.toLowerCase().trim();
    switch (action) {
      // ══ LISTAR CONVERSAS ══
      case 'list': {
        const indexKey = `convos:${normalizedEmail}:index`;
        const index = await redisGet(indexKey) || [];
        return res.status(200).json({ conversations: index });
      }
      // ══ SALVAR / ATUALIZAR CONVERSA ══
      case 'save': {
        if (!conversationId || !messages) {
          return res.status(400).json({ error: 'conversationId e messages obrigatórios' });
        }
        const convoKey = `convos:${normalizedEmail}:${conversationId}`;
        const indexKey = `convos:${normalizedEmail}:index`;
        // Salvar mensagens
        await redisSet(convoKey, { messages, updatedAt: Date.now() });
        // Atualizar índice
        const index = await redisGet(indexKey) || [];
        const existing = index.findIndex(c => c.id === conversationId);
        const convoMeta = {
          id: conversationId,
          title: title || preview || 'Nova conversa',
          preview: preview || '',
          updatedAt: Date.now(),
          messageCount: messages.length,
        };
        if (existing >= 0) {
          index[existing] = convoMeta;
        } else {
          index.unshift(convoMeta);
        }
        // Manter no máximo 50 conversas
        if (index.length > 50) index.length = 50;
        await redisSet(indexKey, index);
        return res.status(200).json({ saved: true, id: conversationId });
      }
      // ══ CARREGAR CONVERSA ══
      case 'load': {
        if (!conversationId) {
          return res.status(400).json({ error: 'conversationId obrigatório' });
        }
        const convoKey = `convos:${normalizedEmail}:${conversationId}`;
        const convo = await redisGet(convoKey);
        if (!convo) {
          return res.status(404).json({ error: 'Conversa não encontrada' });
        }
        return res.status(200).json(convo);
      }
      // ══ DELETAR CONVERSA ══
      case 'delete': {
        if (!conversationId) {
          return res.status(400).json({ error: 'conversationId obrigatório' });
        }
        const convoKey = `convos:${normalizedEmail}:${conversationId}`;
        const indexKey = `convos:${normalizedEmail}:index`;
        await redisDel(convoKey);
        const index = await redisGet(indexKey) || [];
        const filtered = index.filter(c => c.id !== conversationId);
        await redisSet(indexKey, filtered);
        return res.status(200).json({ deleted: true });
      }
      // ══ SALVAR PERFIL HD ══
      case 'save-profile': {
        if (!profile) {
          return res.status(400).json({ error: 'profile obrigatório' });
        }
        const profileKey = `profile:${normalizedEmail}`;
        await redisSet(profileKey, { ...profile, updatedAt: Date.now() });
        console.log(`[Profile] Salvo: ${normalizedEmail}`);
        return res.status(200).json({ success: true });
      }
      // ══ CARREGAR PERFIL HD ══
      case 'load-profile': {
        const profileKey = `profile:${normalizedEmail}`;
        const savedProfile = await redisGet(profileKey);
        if (savedProfile && savedProfile.name && savedProfile.hdData) {
          return res.status(200).json({ profile: savedProfile });
        }
        return res.status(200).json({ profile: null });
      }
      default:
        return res.status(400).json({ error: 'Use: list, save, load, delete, save-profile, load-profile' });
    }
  } catch (error) {
    console.error('[Conversations] Erro:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
