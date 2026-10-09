// api/auth/verify.js
// Vérifie le magic link token, pose le cookie de session, redirige vers /account.html
// Env: AUTH_SECRET, SITE_URL

import crypto from 'crypto';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
// Session cookie dure 30 jours
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // secondes

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;

    const [email, expiresStr, hmac] = parts;
    const expires = parseInt(expiresStr, 10);

    if (Date.now() > expires) return null; // expiré

    const payload = `${email}|${expires}`;
    const expected = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(payload)
      .digest('hex');

    // Comparaison timing-safe
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;

    return email;
  } catch {
    return null;
  }
}

function buildSessionToken(email) {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${email}|${expires}`;
  const hmac = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${hmac}`).toString('base64url');
}

export default async function handler(req, res) {
  const { token } = req.query || {};

  if (!token) {
    return res.redirect(302, `${SITE_URL}/login.html?error=missing`);
  }

  const email = verifyToken(token);
  if (!email) {
    return res.redirect(302, `${SITE_URL}/login.html?error=expired`);
  }

  // Émet un cookie de session httpOnly + SameSite=Lax
  const sessionToken = buildSessionToken(email);
  const isProd = process.env.NODE_ENV === 'production' || SITE_URL.startsWith('https');

  res.setHeader('Set-Cookie', [
    `yonix_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${isProd ? '; Secure' : ''}`,
  ]);

  return res.redirect(302, `${SITE_URL}/account.html`);
}
