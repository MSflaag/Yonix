// api/auth/logout.js
// Efface le cookie de session et redirige vers la home

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', [
    'yonix_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]);
  return res.redirect(302, `${SITE_URL}/`);
}
