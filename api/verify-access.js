// /api/verify-access.js — Updated to support check-email action
// Now checks both Hotmart purchase AND whether user has a Serena account
//
// Required ENV vars:
//   HOTMART_TOKEN — Hotmart API Bearer token
//   KV_REST_API_URL — Vercel KV URL
//   KV_REST_API_TOKEN — Vercel KV token

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const data = await res.json();
  if (data.result) return JSON.parse(data.result);
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, action } = req.body;
  if (!email) return res.json({ hotmartAccess: false, message: 'Email obrigatório.' });

  try {
    // 1. Check Hotmart purchase
    const hotmartRes = await fetch(
      `https://developers.hotmart.com/payments/api/v1/subscriptions?subscriber_email=${encodeURIComponent(email)}&status=ACTIVE`,
      {
        headers: {
          Authorization: `Bearer ${process.env.HOTMART_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const hotmartData = await hotmartRes.json();

    const subscriptions = hotmartData?.items || [];
    const activeSub = subscriptions.find(s => s.status === 'ACTIVE');

    if (action === 'check-email') {
      // New flow: check Hotmart + check if account exists
      if (!activeSub && subscriptions.length === 0) {
        return res.json({
          hotmartAccess: false,
          hasAccount: false,
          message: 'Email não encontrado nas compras da Hotmart.'
        });
      }

      // Has Hotmart purchase — check expiry
      const purchaseDate = activeSub?.accession_date || subscriptions[0]?.accession_date;
      const expiresAt = purchaseDate ? purchaseDate + (60 * 24 * 60 * 60 * 1000) : null; // 2 months
      const now = Date.now();

      if (expiresAt && now > expiresAt) {
        return res.json({
          hotmartAccess: false,
          hasAccount: false,
          message: 'Seu acesso de 2 meses expirou.',
          reason: 'expired'
        });
      }

      // Check if user has a Serena account
      const userData = await kvGet(`user:${email}`);
      const hasAccount = userData && userData.verified;
      const daysRemaining = expiresAt ? Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)) : null;

      return res.json({
        hotmartAccess: true,
        hasAccount: !!hasAccount,
        name: activeSub?.subscriber?.name || '',
        expiresAt,
        daysRemaining,
        warning: daysRemaining && daysRemaining <= 7,
        message: daysRemaining && daysRemaining <= 7
          ? `Seu acesso expira em ${daysRemaining} dias.`
          : undefined
      });
    }

    // Legacy flow (backward compatible)
    if (!activeSub) {
      const canceledSub = subscriptions.find(s => s.status === 'CANCELED' || s.status === 'PAST_DUE');
      if (canceledSub) {
        return res.json({
          access: false,
          reason: canceledSub.status.toLowerCase(),
          message: 'Sua assinatura está ' + (canceledSub.status === 'CANCELED' ? 'cancelada' : 'com pagamento pendente') + '.'
        });
      }
      return res.json({ access: false, message: 'Email não encontrado. Use o mesmo email da compra na Hotmart.' });
    }

    const purchaseDate = activeSub.accession_date;
    const expiresAt = purchaseDate + (60 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));

    if (Date.now() > expiresAt) {
      return res.json({ access: false, reason: 'expired', message: 'Seu período de 2 meses de acesso expirou.' });
    }

    return res.json({
      access: true,
      name: activeSub.subscriber?.name || '',
      expiresAt,
      daysRemaining,
      warning: daysRemaining <= 7,
      message: daysRemaining <= 7 ? `Seu acesso expira em ${daysRemaining} dias.` : undefined
    });

  } catch (e) {
    console.error('Verify access error:', e);
    return res.status(500).json({ access: false, hotmartAccess: false, message: 'Erro ao verificar acesso. Tente novamente.' });
  }
}
