// api/session.js — retrieve Stripe or Direct Card session status + metadata
// GET /api/session?session_id=cs_xxx
// Used by success.html to check payment and get download/client info

import Stripe from 'stripe';

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const isRealStripeKey =
  Boolean(stripeKey) &&
  (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('sk_test_')) &&
  !stripeKey.includes('...');

const stripe = isRealStripeKey
  ? new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  : null;

const localOrders = globalThis.__yonixOrders || (globalThis.__yonixOrders = new Map());
const localDeliveries = globalThis.__yonixDeliveries || (globalThis.__yonixDeliveries = new Map());

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query || {};
  if (!session_id || !String(session_id).startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  const localDeliv = localDeliveries.get(session_id) || {};

  // 1. Check direct card orders in memory first
  const directOrder = localOrders.get(session_id);
  if (directOrder) {
    const m = directOrder.metadata || {};
    const deliveredProduct =
      localDeliv.deliveredProduct !== undefined
        ? localDeliv.deliveredProduct
        : ((m.deliveredProduct || '') + (m.deliveredProduct2 || '')).trim();
    const downloadFile = localDeliv.deliveredFile || m.deliveredFile || m.downloadFile || '';

    return res.status(200).json({
      status: directOrder.payment_status || 'paid',
      metadata: {
        ...m,
        ...(deliveredProduct ? { deliveredProduct } : {}),
        ...(downloadFile ? { downloadFile } : {}),
      },
    });
  }

  // 2. Fallback if Stripe is not configured (client-side order metadata will be used by success.html)
  if (!stripe) {
    return res.status(200).json({
      status: 'paid',
      metadata: {
        ...(localDeliv.deliveredProduct ? { deliveredProduct: localDeliv.deliveredProduct } : {}),
        ...(localDeliv.deliveredFile ? { downloadFile: localDeliv.deliveredFile } : {}),
      },
    });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const m = session.metadata || {};
    const deliveredProduct =
      localDeliv.deliveredProduct !== undefined
        ? localDeliv.deliveredProduct
        : ((m.deliveredProduct || '') + (m.deliveredProduct2 || '')).trim();
    const downloadFile = localDeliv.deliveredFile || m.deliveredFile || m.downloadFile || '';

    return res.status(200).json({
      status: session.payment_status,
      metadata: {
        ...m,
        ...(deliveredProduct ? { deliveredProduct } : {}),
        ...(downloadFile ? { downloadFile } : {}),
      },
    });
  } catch (err) {
    console.error('[session] Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
