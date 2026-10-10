const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'Discord non configuré.' });
  
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${SITE_URL}/api/auth/discord-callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
  });
  
  return res.redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
}
