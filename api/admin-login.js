// ─── LOGIN ADMIN ─────────────────────────────────────────
// Email + senha fixa definidos em variáveis de ambiente
// ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body;

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ error: 'Admin não configurado' });
    }

    if (
      email?.toLowerCase().trim() === adminEmail.toLowerCase().trim() &&
      password === adminPassword
    ) {
      return res.status(200).json({
        success: true,
        token: process.env.ADMIN_SECRET,
        name: 'Admin',
      });
    }

    return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });

  } catch (error) {
    console.error('[Admin Login] Erro:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
