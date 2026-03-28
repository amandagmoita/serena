// ─── AUTENTICAÇÃO: REGISTRO + LOGIN + VERIFICAÇÃO EMAIL ──
// Uses: Resend for email verification codes
//       redis.js helper for user/session/code storage
//
// Required ENV vars:
//   RESEND_API_KEY — API key from resend.com
//   AUTH_SECRET — Secret for signing session tokens
//
// Keys used in Redis:
//   user:{email}    — account data (password hash, verified status)
//   code:{email}    — verification code (TTL 15 min)
//   session:{token} — session data (TTL 60 days)

import { redisGet, redisSet, redisCommand } from './redis.js';
import crypto from 'crypto';

// ─── RESEND ──────────────────────────────────────────────
async function sendVerificationEmail(email, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Serena — Vida Autoral <serena@vidaautoral.com.br>',
      to: email,
      subject: `✦ Seu código de verificação: ${code}`,
      html: `
        <div style="font-family:'Helvetica Neue',sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
          <div style="text-align:center;margin-bottom:2rem;">
            <span style="font-size:0.75rem;letter-spacing:0.3em;color:#9B7D61;">✦ VIDA AUTORAL</span>
          </div>
          <div style="background:linear-gradient(135deg,#E9D7C0,#FED8A6);border-radius:16px;padding:2rem;text-align:center;">
            <p style="color:#2C2017;font-size:0.95rem;margin-bottom:1.5rem;">
              Seu código de verificação para acessar a Serena:
            </p>
            <div style="font-size:2.2rem;letter-spacing:0.5em;font-weight:600;color:#2C2017;margin:1rem 0;">
              ${code}
            </div>
            <p style="color:rgba(44,32,23,0.5);font-size:0.8rem;margin-top:1.5rem;">
              O código expira em 15 minutos.
            </p>
          </div>
          <p style="color:rgba(44,32,23,0.35);font-size:0.72rem;text-align:center;margin-top:1.5rem;">
            Se você não solicitou este código, ignore este email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[Resend] Erro ao enviar email:', err);
    throw new Error('Falha ao enviar email de verificação');
  }
}

// ─── CRYPTO HELPERS ──────────────────────────────────────
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const result = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return result === hash;
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(email) {
  const payload = email + ':' + Date.now() + ':' + Math.random();
  return crypto.createHmac('sha256', process.env.AUTH_SECRET || 'serena-secret-change-me')
    .update(payload).digest('hex').substring(0, 32);
}

// ─── REDIS WITH TTL ──────────────────────────────────────
// redisSet doesn't support TTL, so we use redisCommand directly
async function redisSetWithTTL(key, value, ttlSeconds) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return await redisCommand('SET', key, json, 'EX', ttlSeconds.toString());
}

// ─── MAIN HANDLER ────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, code, token } = req.body;
  const normalizedEmail = email?.toLowerCase().trim();

  try {
    switch (action) {

      // ─── REGISTER ──────────────────────────────────
      case 'register': {
        if (!normalizedEmail || !password || password.length < 6) {
          return res.json({ success: false, message: 'Email e senha (mín. 6 caracteres) são obrigatórios.' });
        }

        // Check if already exists and is verified
        const existing = await redisGet(`user:${normalizedEmail}`);
        if (existing && existing.verified) {
          return res.json({ success: false, message: 'Esta conta já existe. Faça login.' });
        }

        // Hash password
        const { salt, hash } = hashPassword(password);

        // Generate verification code
        const verifyCode = generateCode();

        // Save user (unverified)
        await redisSet(`user:${normalizedEmail}`, {
          email: normalizedEmail,
          passwordHash: hash,
          passwordSalt: salt,
          verified: false,
          createdAt: Date.now(),
        });

        // Save code with 15 min TTL
        await redisSetWithTTL(`code:${normalizedEmail}`, { code: verifyCode, type: 'verify' }, 900);

        // Send email via Resend
        await sendVerificationEmail(normalizedEmail, verifyCode);

        return res.json({ success: true });
      }

      // ─── VERIFY CODE ───────────────────────────────
      case 'verify-code': {
        const codeData = await redisGet(`code:${normalizedEmail}`);
        if (!codeData || codeData.code !== code) {
          return res.json({ success: false, message: 'Código inválido ou expirado. Solicite um novo.' });
        }

        const userData = await redisGet(`user:${normalizedEmail}`);
        if (!userData) {
          return res.json({ success: false, message: 'Conta não encontrada.' });
        }

        // Mark as verified
        userData.verified = true;
        await redisSet(`user:${normalizedEmail}`, userData);

        // Generate session token (60 days TTL)
        const sessionToken = generateToken(normalizedEmail);
        await redisSetWithTTL(`session:${sessionToken}`, {
          email: normalizedEmail,
          createdAt: Date.now(),
        }, 86400 * 60);

        // Get subscriber data for expiry info
        const subscriber = await redisGet(`subscriber:${normalizedEmail}`);
        const expiresAt = subscriber?.expiresAt || (Date.now() + 60 * 24 * 60 * 60 * 1000);

        return res.json({
          success: true,
          token: sessionToken,
          name: subscriber?.name || '',
          expiresAt,
        });
      }

      // ─── RESEND CODE ───────────────────────────────
      case 'resend-code': {
        const newCode = generateCode();
        await redisSetWithTTL(`code:${normalizedEmail}`, { code: newCode, type: 'verify' }, 900);
        await sendVerificationEmail(normalizedEmail, newCode);
        return res.json({ success: true });
      }

      // ─── LOGIN ─────────────────────────────────────
      case 'login': {
        const user = await redisGet(`user:${normalizedEmail}`);
        if (!user) {
          return res.json({ success: false, message: 'Conta não encontrada. Registre-se primeiro.' });
        }
        if (!user.verified) {
          // Resend verification code
          const reCode = generateCode();
          await redisSetWithTTL(`code:${normalizedEmail}`, { code: reCode, type: 'verify' }, 900);
          await sendVerificationEmail(normalizedEmail, reCode);
          return res.json({ success: false, message: 'Email ainda não verificado. Reenviamos o código de verificação.' });
        }

        if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
          return res.json({ success: false, message: 'Senha incorreta.' });
        }

        // Generate session
        const loginToken = generateToken(normalizedEmail);
        await redisSetWithTTL(`session:${loginToken}`, {
          email: normalizedEmail,
          createdAt: Date.now(),
        }, 86400 * 60);

        // Get subscriber for expiry
        const sub = await redisGet(`subscriber:${normalizedEmail}`);
        const expiry = sub?.expiresAt || (Date.now() + 60 * 24 * 60 * 60 * 1000);
        const daysLeft = sub?.expiresAt
          ? Math.ceil((sub.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
          : 60;

        return res.json({
          success: true,
          token: loginToken,
          name: sub?.name || '',
          expiresAt: expiry,
          daysRemaining: daysLeft,
        });
      }

      // ─── FORGOT PASSWORD ──────────────────────────
      case 'forgot-password': {
        const userData3 = await redisGet(`user:${normalizedEmail}`);
        if (!userData3) {
          return res.json({ success: false, message: 'Conta não encontrada com este email.' });
        }

        const resetCode = generateCode();
        await redisSetWithTTL(`code:${normalizedEmail}`, { code: resetCode, type: 'reset' }, 900);
        await sendVerificationEmail(normalizedEmail, resetCode);

        return res.json({ success: true });
      }

      // ─── CHECK SESSION ────────────────────────────
      case 'check-session': {
        const session = await redisGet(`session:${token}`);
        if (!session || session.email !== normalizedEmail) {
          return res.json({ valid: false });
        }

        // Check subscriber is still active
        const sub2 = await redisGet(`subscriber:${normalizedEmail}`);
        if (!sub2 || sub2.status !== 'active') {
          return res.json({ valid: false });
        }

        return res.json({
          valid: true,
          expiresAt: sub2.expiresAt || (Date.now() + 60 * 24 * 60 * 60 * 1000),
        });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

  } catch (e) {
    console.error('[Auth] Erro:', e);
    return res.status(500).json({ success: false, message: 'Erro interno. Tente novamente.' });
  }
}
