// api/auth/send-link.js
// Génère un magic link et l'envoie par email via Resend
// Env: RESEND_API_KEY, AUTH_SECRET, SITE_URL, RESEND_FROM (optionnel)

import crypto from 'crypto';
import { createRateLimit, getClientIp } from '../lib/ratelimit.js';

const emailLimiter = createRateLimit('send-link-email', 3, 60 * 1000); // 3 per minute per email
const ipLimiter = createRateLimit('send-link-ip', 10, 60 * 1000);     // 10 per minute per IP

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// RESEND_FROM doit être un email sur un domaine vérifié dans Resend,
// ex: "Yonix <no-reply@ton-domaine.com>"
// Si non configuré → utilise l'adresse sandbox Resend (fonctionne UNIQUEMENT
// vers l'email vérifié du compte Resend — ok pour les tests)
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';

// Token = base64url(email + expires + hmac)
function generateToken(email) {
  const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
  const payload = `${email}|${expires}`;
  const hmac = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${hmac}`).toString('base64url');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalide.' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const ip = getClientIp(req);
  const ipCheck = ipLimiter(ip);
  if (!ipCheck.allowed) {
    return res.status(429).json({
      error: `Trop de requêtes. Réessaie dans ${ipCheck.retryAfter} secondes.`,
      retryAfter: ipCheck.retryAfter,
    });
  }

  const emailCheck = emailLimiter(normalizedEmail);
  if (!emailCheck.allowed) {
    return res.status(429).json({
      error: `Trop de requêtes pour cet email. Réessaie dans ${emailCheck.retryAfter} secondes.`,
      retryAfter: emailCheck.retryAfter,
    });
  }

  if (!RESEND_API_KEY) {
    console.error('[send-link] RESEND_API_KEY manquante');
    return res.status(500).json({ error: 'Service email non configuré.' });
  }
  const token = generateToken(normalizedEmail);
  const link = `${SITE_URL}/api/auth/verify?token=${token}`;

  const emailBody = {
    from: RESEND_FROM,
    to: [normalizedEmail],
    subject: 'Ton lien de connexion Yonix',
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#020c1a;font-family:'Segoe UI',system-ui,sans-serif;color:#f0f8ff">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020c1a;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#030f20;border-radius:16px;border:1px solid rgba(0,200,255,.15);overflow:hidden;max-width:92vw">
        <tr>
          <td style="padding:32px 36px 24px;text-align:center;border-bottom:1px solid rgba(0,200,255,.1)">
            <span style="font-size:2.2rem;font-weight:700;letter-spacing:.04em;background:linear-gradient(90deg,#00e5ff,#1a7cff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">YONIX</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px">
            <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f0f8ff">Connexion à ton compte</p>
            <p style="margin:0 0 28px;font-size:15px;color:#5f8aaa;line-height:1.6">Clique sur le bouton ci-dessous pour accéder à tes commandes. Ce lien expire dans <strong style="color:#00c8ff">15 minutes</strong>.</p>
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr><td align="center">
                <a href="${link}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#1a7cff,#00c8ff);color:#fff;font-size:15px;font-weight:600;border-radius:10px;text-decoration:none;letter-spacing:.02em">Se connecter →</a>
              </td></tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;color:#5f8aaa;word-break:break-all">Ou copie ce lien : <a href="${link}" style="color:#00c8ff">${link}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 36px;border-top:1px solid rgba(0,200,255,.1);text-align:center">
            <p style="margin:0;font-size:12px;color:#3a5a70">Si tu n'as pas demandé ce lien, ignore cet email. © Yonix</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailBody),
    });

    if (!r.ok) {
      const errBody = await r.text();
      console.error('[send-link] Resend error', r.status, errBody);

      // Parse Resend error for a user-friendly message
      let userMsg = 'Impossible d\'envoyer l\'email.';
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.message) {
          // Domain not verified → guide
          if (parsed.message.includes('domain') || parsed.message.includes('sender')) {
            userMsg = 'Domaine expéditeur non vérifié. Contacte le support.';
          }
        }
      } catch {}

      return res.status(500).json({ error: userMsg, debug: r.status });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[send-link] fetch error:', err.message);
    return res.status(500).json({ error: 'Erreur réseau.' });
  }
}
