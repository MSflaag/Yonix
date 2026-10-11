// api/account/orders.js
// GET  → Retourne les commandes Stripe de l'utilisateur connecté + produits livrés sur le site
// POST → Actions Admin : lister toutes les commandes et envoyer/livrer le produit directement sur chaque commande
// Env: STRIPE_SECRET_KEY, AUTH_SECRET, ADMIN_PASSWORD (optionnel, défaut: yonix-admin-2026), ADMIN_EMAIL (optionnel)

import Stripe from 'stripe';
import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const ADMIN_SECRET = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'yonix-admin-2026';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

// Cache de secours en mémoire pour les livraisons (en complément des metadata Stripe)
const localDeliveries = globalThis.__yonixDeliveries || (globalThis.__yonixDeliveries = new Map());

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

function isAuthorizedAdmin(email, providedKey) {
  if (ADMIN_EMAIL && email && email.toLowerCase() === ADMIN_EMAIL) return true;
  if (providedKey && String(providedKey).trim() === ADMIN_SECRET) return true;
  if (providedKey && String(providedKey).trim() === AUTH_SECRET) return true;
  return false;
}

function formatSessionOrder(s) {
  const m = s.metadata || {};
  const local = localDeliveries.get(s.id) || {};
  const deliveredProduct =
    local.deliveredProduct !== undefined
      ? local.deliveredProduct
      : ((m.deliveredProduct || '') + (m.deliveredProduct2 || '')).trim();
  const downloadFile = local.deliveredFile || m.deliveredFile || m.downloadFile || null;
  const deliveredAt = local.deliveredAt || (m.deliveredAt ? parseInt(m.deliveredAt, 10) : null);
  const deliveryStatus =
    deliveredProduct || downloadFile || m.deliveryStatus === 'delivered'
      ? 'delivered'
      : 'pending';

  const customerEmail = (
    m.accountEmail ||
    s.customer_details?.email ||
    s.customer_email ||
    m.clientEmail ||
    ''
  ).toLowerCase();

  return {
    id: s.id,
    date: s.created,
    customerEmail,
    productName: m.productName || 'Produit',
    tierName: m.tierName || '',
    priceRaw: m.priceRaw || '',
    amount: s.amount_total,
    currency: s.currency || 'eur',
    downloadFile,
    deliveredProduct: deliveredProduct || '',
    deliveredAt,
    deliveryStatus,
    // Infos Basic Fit si présentes
    clientPrenom: m.clientPrenom || '',
    clientNom: m.clientNom || '',
    clientDOB: m.clientDOB || '',
    clientEmail: m.clientEmail || '',
  };
}

export default async function handler(req, res) {
  const email = getEmailFromCookie(req.headers.cookie);

  // ── POST : Actions d'administration (Lister toutes les commandes / Livrer un produit sur une commande) ──
  if (req.method === 'POST') {
    const { action, adminKey, sessionId, deliveredProduct, deliveredFile } = req.body || {};

    if (!isAuthorizedAdmin(email, adminKey)) {
      return res.status(403).json({ error: 'Code administrateur invalide.' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré.' });
    }

    if (action === 'list_all') {
      try {
        const sessions = await stripe.checkout.sessions.list({ limit: 100 });
        const allOrders = sessions.data
          .filter((s) => s.payment_status === 'paid')
          .map(formatSessionOrder);
        return res.status(200).json({ ok: true, orders: allOrders });
      } catch (err) {
        console.error('[orders:list_all] Stripe error:', err.message);
        return res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
      }
    }

    if (action === 'deliver') {
      if (!sessionId || !String(sessionId).startsWith('cs_')) {
        return res.status(400).json({ error: 'Identifiant de commande (sessionId) invalide.' });
      }
      const productText = String(deliveredProduct || '').trim();
      const fileText = String(deliveredFile || '').trim();
      if (!productText && !fileText) {
        return res.status(400).json({ error: 'Entre le produit (clé, accès, lien ou texte) à envoyer au client.' });
      }

      const nowTs = Math.floor(Date.now() / 1000);
      localDeliveries.set(sessionId, {
        deliveredProduct: productText,
        deliveredFile: fileText || null,
        deliveredAt: nowTs,
      });

      try {
        const currentSession = await stripe.checkout.sessions.retrieve(sessionId);
        const existingMeta = currentSession.metadata || {};
        const part1 = productText.slice(0, 500);
        const part2 = productText.slice(500, 1000);

        const updatedMeta = {
          ...existingMeta,
          deliveryStatus: 'delivered',
          deliveredProduct: part1,
          deliveredProduct2: part2,
          deliveredAt: String(nowTs),
          ...(fileText ? { deliveredFile: fileText.slice(0, 500) } : {}),
        };

        const updatedSession = await stripe.checkout.sessions.update(sessionId, {
          metadata: updatedMeta,
        });

        return res.status(200).json({
          ok: true,
          order: formatSessionOrder(updatedSession),
        });
      } catch (err) {
        console.error('[orders:deliver] Stripe update warning:', err.message);
        // Même si Stripe refuse l'update sur une ancienne session, localDeliveries conserve la livraison en mémoire
        try {
          const fallbackSession = await stripe.checkout.sessions.retrieve(sessionId);
          return res.status(200).json({
            ok: true,
            order: formatSessionOrder(fallbackSession),
          });
        } catch (e2) {
          return res.status(500).json({ error: 'Impossible de mettre à jour cette commande : ' + err.message });
        }
      }
    }

    return res.status(400).json({ error: 'Action invalide.' });
  }

  // ── GET : Récupération des commandes du client connecté ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!email) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  if (!stripe) {
    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      orders: [],
    });
  }

  try {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
    });

    const target = email.toLowerCase().trim();
    const orders = sessions.data
      .filter((s) => {
        if (s.payment_status !== 'paid') return false;
        const mEmail = (s.metadata?.accountEmail || '').toLowerCase().trim();
        const cEmail = (s.customer_details?.email || s.customer_email || '').toLowerCase().trim();
        return mEmail === target || cEmail === target;
      })
      .map(formatSessionOrder);

    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      orders,
    });
  } catch (err) {
    console.error('[orders] Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
}
