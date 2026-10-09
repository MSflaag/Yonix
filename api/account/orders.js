// api/account/orders.js
// Retourne les commandes Stripe de l'utilisateur connecté
// Env: STRIPE_SECRET_KEY, AUTH_SECRET

import Stripe from 'stripe';
import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

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
    const expires = parseInt(expiresStr, 10);
    if (Date.now() > expires) return null;

    const payload = `${email}|${expires}`;
    const expected = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(payload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    return email;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = getEmailFromCookie(req.headers.cookie);
  if (!email) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  try {
    // Récupère toutes les sessions Stripe payées pour cet email
    const sessions = await stripe.checkout.sessions.list({
      limit: 50,
    });

    const orders = sessions.data
      .filter(
        (s) =>
          s.payment_status === 'paid' &&
          s.customer_details?.email?.toLowerCase() === email.toLowerCase()
      )
      .map((s) => ({
        id: s.id,
        date: s.created,
        productName: s.metadata?.productName || 'Produit',
        tierName: s.metadata?.tierName || '',
        priceRaw: s.metadata?.priceRaw || '',
        amount: s.amount_total, // centimes
        currency: s.currency,
        downloadFile: s.metadata?.downloadFile || null,
      }));

    return res.status(200).json({ email, orders });
  } catch (err) {
    console.error('[orders] Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
}
