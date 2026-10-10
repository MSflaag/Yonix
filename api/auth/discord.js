// api/auth/discord.js
// Lance le flux OAuth2 Discord — redirige vers discord.com/oauth2/authorize
// Env: DISCORD_CLIENT_ID, SITE_URL

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

export default function handler(req, res) {
  if (!CLIENT_ID) {
    return res.status(500).json({ error: 'DISCORD_CLIENT_ID non configuré.' });
  }

  const redirect_uri = encodeURIComponent(`${SITE_URL}/api/auth/discord-callback`);
  const scope = encodeURIComponent('identify email');
  const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}&prompt=none`;

  res.redirect(302, url);
}
