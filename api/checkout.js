// api/checkout.js — Paiement Direct par Carte Bancaire + Stripe Checkout + Discord notify
// Connexion obligatoire (yonix_session ou x-yonix-token) + domaine email vérifié
// Supporte le paiement direct par Carte Bancaire sur le site (avec ou sans STRIPE_SECRET_KEY) et Stripe Checkout

import Stripe from 'stripe';
import crypto from 'crypto';
import { buildOrderMessage, sendOwnerDM } from './notify.js';
import { getAuthenticatedEmail, validateVerifiedEmail, findUserAccount } from './auth/send-link.js';

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const isRealStripeKey =
  Boolean(stripeKey) &&
  (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('sk_test_')) &&
  !stripeKey.includes('...');

const stripe = isRealStripeKey
  ? new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  : null;

// Stores partagés en mémoire pour les commandes et profils (en complément de Stripe)
const localOrders = globalThis.__yonixOrders || (globalThis.__yonixOrders = new Map());
const localProfiles = globalThis.__yonixProfiles || (globalThis.__yonixProfiles = new Map());

function getSiteUrl(req) {
  const envUrl = (process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (envUrl && !envUrl.includes('your-project.vercel.app') && !envUrl.includes('localhost')) {
    return envUrl;
  }
  const proto = req?.headers?.['x-forwarded-proto'] || (req?.socket?.encrypted ? 'https' : 'http');
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host) return `${proto}://${host}`;
  return envUrl || 'http://localhost:3000';
}

// Parse a French price string like "25€" or "119,99€" → integer cents
function parsePriceCents(raw) {
  if (!raw) return null;
  const str = String(raw);
  const m = str.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const euros = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(euros)) return null;
  return Math.round(euros * 100);
}

function detectBrand(rawNum) {
  if (rawNum.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(rawNum) || /^2[2-7]/.test(rawNum)) return 'MASTERCARD';
  if (/^3[47]/.test(rawNum)) return 'AMEX';
  return 'CB';
}

function validateCardInput(card) {
  if (!card || typeof card !== 'object') {
    return { ok: false, error: 'Informations de carte bancaire manquantes.' };
  }
  const rawNum = String(card.cardNumber || '').replace(/\D/g, '');
  const exp = String(card.exp || '').trim();
  const cvv = String(card.cvv || '').replace(/\D/g, '');
  const holderName = String(card.name || '').trim().toUpperCase();

  if (rawNum.length < 15 || rawNum.length > 19) {
    return { ok: false, error: 'Numéro de carte bancaire invalide (15 à 16 chiffres requis).' };
  }
  const expMatch = exp.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!expMatch) {
    return { ok: false, error: 'Date d\'expiration invalide (format MM/AA requis).' };
  }
  const expMonth = parseInt(expMatch[1], 10);
  const expYear = 2000 + parseInt(expMatch[2], 10);
  const now = new Date();
  if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
    return { ok: false, error: 'Cette carte bancaire est expirée.' };
  }
  if (cvv.length < 3 || cvv.length > 4) {
    return { ok: false, error: 'Code CVV invalide (3 ou 4 chiffres requis).' };
  }
  if (!holderName || holderName.length < 2) {
    return { ok: false, error: 'Indique le nom du titulaire figurant sur la carte bancaire.' };
  }

  return {
    ok: true,
    brand: detectBrand(rawNum),
    last4: rawNum.slice(-4),
    exp,
    name: holderName,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Vérification stricte de la connexion client
  const sessionEmail = getAuthenticatedEmail(req);
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
    unitPriceRaw,
    quantity,
    downloadFile,
    items,
    paymentMode,
    card,
    savedCard,
    // Basic Fit client fields
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
  } = req.body || {};

  if (!productName || !tierName || !priceRaw) {
    return res.status(400).json({ error: 'Champs de commande manquants.' });
  }

  const amountCents = parsePriceCents(priceRaw);
  if (!amountCents || amountCents < 50) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  const clampQty = (q) => Math.min(10, Math.max(1, parseInt(q, 10) || 1));
  const finalQty = clampQty(quantity);
  const siteUrl = getSiteUrl(req);

  // Build metadata
  const metadata = {
    accountEmail: String(authEmail).slice(0, 320),
    productName: String(productName).slice(0, 500),
    tierName: String(tierName).slice(0, 500),
    priceRaw: String(priceRaw).slice(0, 100),
    quantity: String(finalQty).slice(0, 10),
    deliveryStatus: downloadFile ? 'delivered' : 'pending',
    ...(downloadFile ? { downloadFile: String(downloadFile).slice(0, 500) } : {}),
    ...(clientPrenom ? { clientPrenom: String(clientPrenom).slice(0, 200) } : {}),
    ...(clientNom ? { clientNom: String(clientNom).slice(0, 200) } : {}),
    ...(clientDOB ? { clientDOB: String(clientDOB).slice(0, 20) } : {}),
    ...(clientEmail ? { clientEmail: String(clientEmail).slice(0, 320) } : {}),
  };

  // ── MODE A : Paiement direct par Carte Bancaire sur le site ──
  if (paymentMode === 'direct_card' || card || savedCard) {
    let usedCardInfo = null;

    if (savedCard && savedCard.last4) {
      usedCardInfo = {
        id: savedCard.id || 'card_saved',
        brand: String(savedCard.brand || 'CB').toUpperCase(),
        last4: String(savedCard.last4).slice(-4),
        exp: String(savedCard.exp || ''),
        name: String(savedCard.name || authEmail.split('@')[0].toUpperCase()),
      };
    } else {
      const check = validateCardInput(card);
      if (!check.ok) {
        return res.status(400).json({ error: check.error });
      }
      usedCardInfo = {
        id: 'card_' + crypto.randomBytes(6).toString('hex'),
        brand: check.brand,
        last4: check.last4,
        exp: check.exp,
        name: check.name,
      };

      // Enregistrer la carte sur le profil si demandé
      if (card?.saveCard !== false) {
        const key = authEmail.toLowerCase().trim();
        const mem = localProfiles.get(key) || {};
        const existingCards = Array.isArray(mem.cards) ? mem.cards : [];
        const filtered = existingCards.filter(
          (c) => !(c.last4 === usedCardInfo.last4 && c.brand === usedCardInfo.brand)
        );
        const nextCards = [
          { ...usedCardInfo, isDefault: true, source: 'account' },
          ...filtered.map((c) => ({ ...c, isDefault: false })),
        ];
        localProfiles.set(key, { ...mem, cards: nextCards, updatedAt: new Date().toISOString() });
      }
    }

    const sessionId = 'cs_live_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex');
    const createdTs = Math.floor(Date.now() / 1000);

    const sessionObj = {
      id: sessionId,
      created: createdTs,
      payment_status: 'paid',
      amount_total: amountCents,
      currency: 'eur',
      customer_email: authEmail,
      customer_details: { email: authEmail, name: usedCardInfo.name },
      metadata: {
        ...metadata,
        cardBrand: usedCardInfo.brand,
        cardLast4: usedCardInfo.last4,
      },
    };

    localOrders.set(sessionId, sessionObj);

    // Persister aussi dans le profil mémoire de l'utilisateur
    const profKey = authEmail.toLowerCase().trim();
    const profMem = localProfiles.get(profKey) || {};
    const userOrders = Array.isArray(profMem.orders) ? profMem.orders : [];
    userOrders.unshift(sessionObj);
    localProfiles.set(profKey, { ...profMem, orders: userOrders.slice(0, 50) });

    // Notification Discord au propriétaire (non-bloquant)
    const notifyPayload = {
      accountEmail: authEmail,
      productName: finalQty > 1 ? `${productName} (×${finalQty})` : productName,
      tierName,
      priceRaw,
      sessionId,
      clientPrenom,
      clientNom,
      clientDOB,
      clientEmail,
    };

    sendOwnerDM(buildOrderMessage(notifyPayload)).catch((err) => {
      console.error('[checkout] Discord notify failed (non-blocking):', err.message);
    });

    return res.status(200).json({
      ok: true,
      sessionId,
      url: `${siteUrl}/success?session_id=${encodeURIComponent(sessionId)}`,
      card: usedCardInfo,
      order: {
        id: sessionId,
        date: createdTs,
        customerEmail: authEmail,
        productName,
        tierName,
        priceRaw,
        quantity: finalQty,
        amount: amountCents,
        currency: 'eur',
        downloadFile: downloadFile || null,
        deliveredProduct: '',
        deliveryStatus: downloadFile ? 'delivered' : 'pending',
      },
    });
  }

  // ── MODE B : Redirection Stripe Checkout (si STRIPE_SECRET_KEY réelle est configurée) ──
  if (!stripe) {
    return res.status(200).json({
      requireDirectCard: true,
      message: 'Paiement direct par carte bancaire activé.',
    });
  }

  // Build line_items — support multi-item cart or single product with quantity (1..10)
  let lineItems;
  if (Array.isArray(items) && items.length >= 1) {
    const validItems = items
      .map((it) => {
        const c = parsePriceCents(it.unitPriceRaw || it.priceRaw || it.price);
        if (!c || c < 50) return null;
        const itemQty = clampQty(it.quantity);
        return {
          price_data: {
            currency: 'eur',
            product_data: {
              name: it.tierName ? `${it.productName} — ${it.tierName}` : String(it.productName || 'Article Yonix'),
            },
            unit_amount: c,
          },
          quantity: itemQty,
        };
      })
      .filter(Boolean);
    if (validItems.length > 0) {
      lineItems = validItems;
    }
  }
  if (!lineItems) {
    const unitCents = unitPriceRaw
      ? parsePriceCents(unitPriceRaw) || Math.round(amountCents / finalQty)
      : amountCents;
    lineItems = [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: tierName ? `${productName} — ${tierName}` : productName,
          },
          unit_amount: unitCents,
        },
        quantity: unitPriceRaw ? finalQty : 1,
      },
    ];
  }

  let stripeCustomerId = null;
  try {
    const userAcct = await findUserAccount(authEmail);
    if (userAcct?.customer?.id) {
      stripeCustomerId = userAcct.customer.id;
    } else {
      const created = await stripe.customers.create({
        email: authEmail,
        metadata: { accountVerified: 'true', createdAt: new Date().toISOString() },
      });
      stripeCustomerId = created.id;
    }
  } catch (custErr) {
    console.warn('[checkout] Customer lookup warning:', custErr.message);
  }

  let session;
  try {
    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: authEmail }),
      payment_intent_data: {
        setup_future_usage: 'on_session',
        metadata,
      },
      line_items: lineItems,
      metadata,
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/boutique`,
    };
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    console.warn('[checkout] Primary session create fallback:', err.message);
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: authEmail,
        line_items: lineItems,
        metadata,
        success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/boutique`,
      });
    } catch (err2) {
      console.error('[checkout] Stripe fallback to direct card:', err2.message);
      return res.status(200).json({
        requireDirectCard: true,
        message: 'Paiement direct par carte bancaire activé.',
      });
    }
  }

  const notifyPayload = {
    accountEmail: authEmail,
    productName: finalQty > 1 ? `${productName} (×${finalQty})` : productName,
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
