// api/checkout.js — Stripe Checkout Session creator + Discord notify
// Connexion obligatoire (yonix_session) + domaine email vérifié
// Env vars: STRIPE_SECRET_KEY, SITE_URL, DISCORD_BOT_TOKEN, DISCORD_OWNER_ID, AUTH_SECRET

import Stripe from 'stripe';
import { buildOrderMessage, sendOwnerDM } from './notify.js';
import { getEmailFromCookie, validateVerifiedEmail } from './auth/send-link.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Parse a French price string like "25€" or "119,99€" → integer cents
function parsePriceCents(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/[€\s]/g, '').replace(',', '.');
  const euros = parseFloat(clean);
  if (isNaN(euros)) return null;
  return Math.round(euros * 100);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Vérification stricte de la connexion client
  const sessionEmail = getEmailFromCookie(req.headers.cookie);
  if (!sessionEmail) {
    return res.status(401).json({
      error: 'Connexion obligatoire : tu dois te connecter ou créer un compte pour passer commande.',
      requireAuth: true,
    });
  }

  const emailCheck = validateVerifiedEmail(sessionEmail);
  if (!emailCheck.valid) {
    return res.status(403).json({
      error: emailCheck.error,
      requireAuth: true,
    });
  }
  const authEmail = emailCheck.email;

  const {
    productName,
    tierName,
    priceRaw,
    downloadFile,
    items,
    // Basic Fit client fields
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
  } = req.body || {};

  if (!productName || !tierName || !priceRaw) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const amountCents = parsePriceCents(priceRaw);
  if (!amountCents || amountCents < 50) {
    return res.status(400).json({ error: 'Invalid price' });
  }

  // Build line_items — support multi-item cart or single product
  let lineItems;
  if (Array.isArray(items) && items.length > 1) {
    const validItems = items
      .map(it => {
        const c = parsePriceCents(it.priceRaw || it.price);
        if (!c || c < 50) return null;
        return {
          price_data: {
            currency: 'eur',
            product_data: {
              name: it.tierName ? `${it.productName} — ${it.tierName}` : String(it.productName || 'Article Yonix'),
            },
            unit_amount: c,
          },
          quantity: 1,
        };
      })
      .filter(Boolean);
    if (validItems.length > 0) {
      lineItems = validItems;
    }
  }
  if (!lineItems) {
    lineItems = [
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
    ];
  }

  // Build metadata — Stripe metadata values must be strings ≤500 chars
  const metadata = {
    accountEmail: String(authEmail).slice(0, 320),
    productName: String(productName).slice(0, 500),
    tierName: String(tierName).slice(0, 500),
    priceRaw: String(priceRaw).slice(0, 100),
    deliveryStatus: downloadFile ? 'delivered' : 'pending',
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
      customer_email: authEmail,
      line_items: lineItems,
      metadata,
      success_url: `${SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/boutique`,
    });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  // Fire-and-forget Discord notify — don't block the redirect
  const notifyPayload = {
    accountEmail: authEmail,
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
