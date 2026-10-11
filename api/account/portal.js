// api/account/portal.js
// Crée une session Stripe Customer Portal et retourne l'URL de redirection
// Env: STRIPE_SECRET_KEY, SITE_URL, AUTH_SECRET

import crypto from 'crypto';
import Stripe from 'stripe';

const SITE_URL    = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const stripe      = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = getEmailFromCookie(req.headers.cookie);
  if (!email) return res.status(401).json({ error: 'Non authentifié.' });

  try {
    // Cherche le Customer Stripe par email
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId;

    if (customers.data.length) {
      customerId = customers.data[0].id;
    } else {
      // Crée le customer s'il n'existe pas encore
      const c = await stripe.customers.create({ email });
      customerId = c.id;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/account.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[portal] Stripe error:', err.message);
    return res.status(500).json({ error: 'Impossible de créer le portail.' });
  }
}
