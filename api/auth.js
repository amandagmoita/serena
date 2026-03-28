// /api/auth.js — Vercel Serverless Function
// Handles: register, verify-code, resend-code, login, forgot-password, check-session
// Uses: Resend for email verification, Upstash Redis for user storage
//
// Required ENV vars:
//   RESEND_API_KEY — API key from resend.com
//   UPSTASH_REDIS_REST_URL — Upstash Redis REST URL
//   UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST token
//   AUTH_SECRET — Secret for signing session tokens (any random string)
//
// Install: npm install @upstash/redis resend

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);

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
  const payload = email + ':' + Date.now();
  return crypto.createHmac('sha256', process.env.AUTH_SECRET || 'serena-secret')
    .update(payload).digest('hex').substring(0, 32);
}

// ─── RESEND EMAIL ────────────────────────────────────────
async function sendVerificationEmail(email, code) {
  await resend.emails.send({
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
    `
  });
}

// ─── MAIN HANDLER ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, password, code, token } = req.body;

  try {
    switch (action) {

      // ─── REGISTER ──────────────────────────────────
      case 'register': {
        if (!email || !password || password.length < 6) {
          return res.json({ success: false, message: 'Email e senha (mín. 6 caracteres) são obrigatórios.' });
        }

        // Check if already exists
        const existing = await redis.get(`user:${email}`);
        if (existing && existing.verified) {
          return res.json({ success: false, message: 'Esta conta já existe. Faça login.' });
        }

        // Hash password
        const { salt, hash } = hashPassword(password);

        // Generate verification code
        const verifyCode = generateCode();

        // Save user (unverified)
        await redis.set(`user:${email}`, {
          email,
          passwordHash: hash,
          passwordSalt: salt,
          verified: false,
          createdAt: Date.now()
        });

        // Save code (expires in 15 min)
        await redis.set(`code:${email}`, { code: verifyCode, type: 'verify' }, { ex: 900 });

        // Send email via Resend
        await sendVerificationEmail(email, verifyCode);

        return res.json({ success: true });
      }

      // ─── VERIFY CODE ───────────────────────────────
      case 'verify-code': {
        const codeData = await redis.get(`code:${email}`);
        if (!codeData || codeData.code !== code) {
          return res.json({ success: false, message: 'Código inválido ou expirado. Solicite um novo.' });
        }

        const userData = await redis.get(`user:${email}`);
        if (!userData) {
          return res.json({ success: false, message: 'Conta não encontrada.' });
        }

        // If it's a password reset, set a flag for the frontend
        if (codeData.type === 'reset') {
          // For simplicity: mark as verified and let them in 
          // (they can change password in settings later)
          userData.verified = true;
          await redis.set(`user:${email}`, userData);
        } else {
          // Normal verification
          userData.verified = true;
          await redis.set(`user:${email}`, userData);
        }

        // Generate session token
        const sessionToken = generateToken(email);
        await redis.set(`session:${sessionToken}`, { email, createdAt: Date.now() }, { ex: 86400 * 60 });

        // Calculate expiry (2 months from Hotmart purchase)
        // This comes from the verify-access API, but for now use 60 days
        const expiresAt = Date.now() + (60 * 24 * 60 * 60 * 1000);

        return res.json({
          success: true,
          token: sessionToken,
          name: userData.name || '',
          expiresAt
        });
      }

      // ─── RESEND CODE ───────────────────────────────
      case 'resend-code': {
        const verifyCode2 = generateCode();
        await redis.set(`code:${email}`, { code: verifyCode2, type: 'verify' }, { ex: 900 });
        await sendVerificationEmail(email, verifyCode2);
        return res.json({ success: true });
      }

      // ─── LOGIN ─────────────────────────────────────
      case 'login': {
        const user = await redis.get(`user:${email}`);
        if (!user) {
          return res.json({ success: false, message: 'Conta não encontrada. Registre-se primeiro.' });
        }
        if (!user.verified) {
          // Resend verification
          const newCode = generateCode();
          await redis.set(`code:${email}`, { code: newCode, type: 'verify' }, { ex: 900 });
          await sendVerificationEmail(email, newCode);
          return res.json({ success: false, message: 'Email ainda não verificado. Reenviamos o código.' });
        }

        if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
          return res.json({ success: false, message: 'Senha incorreta.' });
        }

        // Generate session
        const loginToken = generateToken(email);
        await redis.set(`session:${loginToken}`, { email, createdAt: Date.now() }, { ex: 86400 * 60 });

        const loginExpiry = Date.now() + (60 * 24 * 60 * 60 * 1000);

        return res.json({
          success: true,
          token: loginToken,
          name: user.name || '',
          expiresAt: loginExpiry,
          daysRemaining: 60
        });
      }

      // ─── FORGOT PASSWORD ──────────────────────────
      case 'forgot-password': {
        const userData3 = await redis.get(`user:${email}`);
        if (!userData3) {
          return res.json({ success: false, message: 'Conta não encontrada com este email.' });
        }

        const resetCode = generateCode();
        await redis.set(`code:${email}`, { code: resetCode, type: 'reset' }, { ex: 900 });
        await sendVerificationEmail(email, resetCode);

        return res.json({ success: true });
      }

      // ─── CHECK SESSION ────────────────────────────
      case 'check-session': {
        const session = await redis.get(`session:${token}`);
        if (!session || session.email !== email) {
          return res.json({ valid: false });
        }

        // Could also re-check Hotmart status here
        return res.json({
          valid: true,
          expiresAt: Date.now() + (60 * 24 * 60 * 60 * 1000)
        });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

  } catch (e) {
    console.error('Auth handler error:', e);
    return res.status(500).json({ success: false, message: 'Erro interno. Tente novamente.' });
  }
}
