// api/session.js — retrieve Stripe session status + metadata
// GET /api/session?session_id=cs_xxx
// Used by success.html to check payment and get download/client info

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;
  if (!session_id || !session_id.startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const m = session.metadata || {};
    const local = (globalThis.__yonixDeliveries && globalThis.__yonixDeliveries.get(session_id)) || {};
    const deliveredProduct =
      local.deliveredProduct !== undefined
        ? local.deliveredProduct
        : ((m.deliveredProduct || '') + (m.deliveredProduct2 || '')).trim();
    const downloadFile = local.deliveredFile || m.deliveredFile || m.downloadFile || '';

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
