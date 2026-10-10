import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

function getEmailFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/yonix_session=([^;]+)/);
  if (!match) return null;
  try {
    const token = match[1];
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;
    const [email, expiresStr, hmac] = parts;
    if (Date.now() > parseInt(expiresStr, 10)) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${email}|${expiresStr}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    return email;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const { code, error } = req.query;
  if (error || !code) return res.redirect(302, '/login.html?error=discord_failed');

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${SITE_URL}/api/auth/discord-callback`;

  if (!clientId || !clientSecret) return res.redirect(302, '/login.html?error=discord_failed');

  try {
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) throw new Error('Token error');
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userRes.ok) throw new Error('User error');
    const userData = await userRes.json();

    const discordInfo = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar
    };

    const discordCookieValue = Buffer.from(JSON.stringify(discordInfo)).toString('base64url');
    // Not httpOnly so frontend can read it
    const cookie = `yonix_discord=${discordCookieValue}; Path=/; Max-Age=31536000`;
    res.setHeader('Set-Cookie', cookie);

    const email = getEmailFromCookie(req.headers.cookie);
    if (email) {
      return res.redirect(302, '/profile.html?discord=linked');
    } else {
      return res.redirect(302, '/login.html?discord=linked');
    }

  } catch (err) {
    return res.redirect(302, '/login.html?error=discord_failed');
  }
}
