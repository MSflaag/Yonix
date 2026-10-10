// api/auth/discord-callback.js
// Reçoit le code OAuth2 Discord, échange contre un access_token,
// récupère l'ID Discord et le lie à la session active via cookie.
// Env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SITE_URL, AUTH_SECRET

import crypto from 'crypto';

const SITE_URL    = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const CLIENT_ID   = process.env.DISCORD_CLIENT_ID;
const CLIENT_SEC  = process.env.DISCORD_CLIENT_SECRET;
const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';

// Lit le cookie yonix_session et retourne l'email si valide
function getEmailFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith('yonix_session='));
  if (!match) return null;
  const token = match.slice('yonix_session='.length);
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length !== 3) return null;
    const [email, expiresStr, hmac] = parts;
    if (Date.now() > parseInt(expiresStr, 10)) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${email}|${expiresStr}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    return email;
  } catch { return null; }
}

// Génère un cookie yonix_discord contenant l'ID et le username Discord
function buildDiscordCookie(discordId, discordTag) {
  const payload = `${discordId}|${discordTag}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}|${hmac}`).toString('base64url');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  return `yonix_discord=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export default async function handler(req, res) {
  const { code, error } = req.query || {};

  if (error || !code) {
    return res.redirect(302, `/account.html?discord=cancelled`);
  }

  if (!CLIENT_ID || !CLIENT_SEC) {
    return res.redirect(302, `/account.html?discord=error&reason=config`);
  }

  const redirect_uri = `${SITE_URL}/api/auth/discord-callback`;

  // 1) Échanger le code contre un access_token
  let tokenData;
  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SEC,
        grant_type:    'authorization_code',
        code,
        redirect_uri,
      }),
    });
    tokenData = await r.json();
    if (!tokenData.access_token) throw new Error('No access_token');
  } catch (err) {
    console.error('[discord-callback] token exchange failed:', err.message);
    return res.redirect(302, `/account.html?discord=error&reason=token`);
  }

  // 2) Récupérer le profil Discord
  let discordUser;
  try {
    const r = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    discordUser = await r.json();
    if (!discordUser.id) throw new Error('No Discord ID');
  } catch (err) {
    console.error('[discord-callback] user fetch failed:', err.message);
    return res.redirect(302, `/account.html?discord=error&reason=profile`);
  }

  const discordId  = discordUser.id;
  const discordTag = discordUser.username + (discordUser.discriminator && discordUser.discriminator !== '0' ? '#' + discordUser.discriminator : '');

  // 3) Poser le cookie Discord (30 jours, HttpOnly)
  const discordCookie = buildDiscordCookie(discordId, discordTag);
  res.setHeader('Set-Cookie', discordCookie);

  // 4) Rediriger vers le profil avec succès
  return res.redirect(302, `/account.html?discord=linked&tag=${encodeURIComponent(discordTag)}`);
}
