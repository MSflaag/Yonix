// api/session.js — retrieve Stripe or Direct Card session status + metadata + product logo
// GET /api/session?session_id=cs_xxx
// Used by success.html to verify payment and get product icon, download, and order info

import Stripe from 'stripe';
import { buildOrderMessage, sendOwnerDM } from './notify.js';
import { resolveProductLogoPath } from './account/orders.js';

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
const notifiedSessions = globalThis.__yonixNotifiedSessions || (globalThis.__yonixNotifiedSessions = new Set());

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
    const productLogo = resolveProductLogoPath(m.serviceId || m.productId || m.serviceName || m.productName, m.serviceImage);

    return res.status(200).json({
      status: directOrder.payment_status || 'paid',
      amount: directOrder.amount_total || 0,
      currency: directOrder.currency || 'eur',
      created: directOrder.created || Math.floor(Date.now() / 1000),
      metadata: {
        ...m,
        productLogo,
        ...(deliveredProduct ? { deliveredProduct } : {}),
        ...(downloadFile ? { downloadFile } : {}),
      },
    });
  }

  // 2. Fallback if Stripe is not configured (only in local dev without STRIPE_SECRET_KEY)
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
    const productLogo = resolveProductLogoPath(m.serviceId || m.productId || m.serviceName || m.productName, m.serviceImage);

    if (session.payment_status === 'paid' && !notifiedSessions.has(session.id)) {
      notifiedSessions.add(session.id);
      const qtyNum = parseInt(m.quantity || '1', 10) || 1;
      sendOwnerDM(buildOrderMessage({
        accountEmail: m.accountEmail || session.customer_details?.email || session.customer_email || '',
        productName: qtyNum > 1 ? `${m.productName} (×${qtyNum})` : (m.productName || 'Produit'),
        tierName: m.tierName || '',
        priceRaw: m.priceRaw || '',
        sessionId: session.id,
        clientPrenom: m.clientPrenom || '',
        clientNom: m.clientNom || '',
        clientDOB: m.clientDOB || '',
        clientEmail: m.clientEmail || '',
      })).catch(() => {});
    }

    return res.status(200).json({
      status: session.payment_status,
      amount: session.amount_total || 0,
      currency: session.currency || 'eur',
      created: session.created || Math.floor(Date.now() / 1000),
      metadata: {
        ...m,
        productLogo,
        ...(deliveredProduct ? { deliveredProduct } : {}),
        ...(downloadFile ? { downloadFile } : {}),
      },
    });
  } catch (err) {
    console.error('[session] Stripe error:', err.message);
    return res.status(404).json({ status: 'unpaid', error: 'Session Stripe introuvable ou non payée.' });
  }
}
