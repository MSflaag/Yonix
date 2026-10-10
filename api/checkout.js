// api/checkout.js — Stripe Checkout Session creator + Discord notify
// Env vars: STRIPE_SECRET_KEY, SITE_URL, DISCORD_BOT_TOKEN, DISCORD_OWNER_ID

import Stripe from 'stripe';
import { buildOrderMessage, sendOwnerDM } from './notify.js';
import { createRateLimit, getClientIp } from './lib/ratelimit.js';

const checkoutLimiter = createRateLimit('checkout', 10, 60 * 1000); // 10 per minute per IP

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Parse a French price string like "25€" or "119,99€" → integer cents
function parsePriceCents(raw) {
  if (!raw) return null;
  const clean = raw.replace(/[€\s]/g, '').replace(',', '.');
  const euros = parseFloat(clean);
  if (isNaN(euros)) return null;
  return Math.round(euros * 100);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const ip = getClientIp(req);
  const rl = checkoutLimiter(ip);
  if (!rl.allowed) {
    return res.status(429).json({
      error: `Trop de requêtes. Réessaie dans ${rl.retryAfter} secondes.`,
      retryAfter: rl.retryAfter,
    });
  }

  const {
    productName,
    tierName,
    priceRaw,
    downloadFile,
    // Basic Fit client fields
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
    cgvAccepted,
  } = req.body || {};

  if (!productName || !tierName || !priceRaw) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!cgvAccepted) {
    return res.status(400).json({ error: 'Vous devez accepter les Conditions Générales de Vente.' });
  }

  const amountCents = parsePriceCents(priceRaw);
  if (!amountCents || amountCents < 50) {
    return res.status(400).json({ error: 'Invalid price' });
  }

  // Build metadata — Stripe metadata values must be strings ≤500 chars
  const metadata = {
    productName: String(productName).slice(0, 500),
    tierName: String(tierName).slice(0, 500),
    priceRaw: String(priceRaw).slice(0, 100),
    ...(downloadFile ? { downloadFile: String(downloadFile).slice(0, 500) } : {}),
    // Basic Fit client fields
    ...(clientPrenom ? { clientPrenom: String(clientPrenom).slice(0, 200) } : {}),
    ...(clientNom ? { clientNom: String(clientNom).slice(0, 200) } : {}),
    ...(clientDOB ? { clientDOB: String(clientDOB).slice(0, 20) } : {}),
    ...(clientEmail ? { clientEmail: String(clientEmail).slice(0, 320) } : {}),
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: tierName ? `${productName} — ${tierName}` : productName,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/?cancelled=1`,
    });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  // Fire-and-forget Discord notify — don't block the redirect
  const notifyPayload = {
    productName,
    tierName,
    priceRaw,
    sessionId: session.id,
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
  };

  sendOwnerDM(buildOrderMessage(notifyPayload)).catch((err) => {
    console.error('[checkout] Discord notify failed (non-blocking):', err.message);
  });

  return res.status(200).json({ url: session.url });
}
