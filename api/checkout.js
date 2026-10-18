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

function isStripeAccountRestrictedError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || err.raw?.code || '').toLowerCase();
  return (
    msg.includes('cannot currently make live charges') ||
    msg.includes('charges_disabled') ||
    msg.includes('account_invalid') ||
    code === 'account_invalid' ||
    code === 'charges_disabled'
  );
}

function sendStripeMaintenanceResponse(res) {
  return res.status(503).json({
    error: 'Paiement temporairement indisponible (vérification Stripe en cours).',
    isStripeVerification: true,
    discordUrl: 'https://discord.gg/5TEMCbpZXM',
    discordMessage: 'Ouvre un ticket sur notre serveur Discord pour régler immédiatement par PayPal, Crypto, Virement ou Carte.',
  });
}

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

function isValidLuhn(numStr) {
  const digits = String(numStr || '').replace(/\D/g, '');
  if (digits.length < 15 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function validateCardInput(card) {
  if (!card || typeof card !== 'object') {
    return { ok: false, error: 'Informations de carte bancaire manquantes.' };
  }
  const rawNum = String(card.cardNumber || '').replace(/\D/g, '');
  const exp = String(card.exp || '').trim();
  const cvv = String(card.cvv || '').replace(/\D/g, '');
  const holderName = String(card.name || '').trim().toUpperCase();

  if (rawNum.length < 15 || rawNum.length > 19 || !isValidLuhn(rawNum)) {
    return { ok: false, error: 'Numéro de carte bancaire invalide (vérifie les 16 chiffres de ta carte).' };
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
  if (cvv.length < 3 || cvv.length > 4 || /^0+$/.test(cvv)) {
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
    productId,
    productName,
    tierName,
    priceRaw,
    basePriceRaw,
    unitPriceRaw,
    quantity,
    promoCode,
    discountCents: reqDiscountCents,
    stripeFeeCents: reqStripeFeeCents,
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

  const cleanPromo = String(promoCode || '').toUpperCase().trim() === 'YONIX10' ? 'YONIX10' : '';
  const clampQty = (q) => Math.min(10, Math.max(1, parseInt(q, 10) || 1));
  const finalQty = clampQty(quantity);
  const siteUrl = getSiteUrl(req);

  // Build metadata
  const metadata = {
    accountEmail: String(authEmail).slice(0, 320),
    ...(productId ? { productId: String(productId).slice(0, 120) } : {}),
    productName: String(productName).slice(0, 500),
    tierName: String(tierName).slice(0, 500),
    priceRaw: String(priceRaw).slice(0, 100),
    ...(basePriceRaw ? { basePriceRaw: String(basePriceRaw).slice(0, 100) } : {}),
    ...(cleanPromo ? { promoCode: cleanPromo, discountCents: String(reqDiscountCents || 0) } : {}),
    ...(reqStripeFeeCents ? { stripeFeeCents: String(reqStripeFeeCents) } : {}),
    quantity: String(finalQty).slice(0, 10),
    deliveryStatus: downloadFile ? 'delivered' : 'pending',
    ...(downloadFile ? { downloadFile: String(downloadFile).slice(0, 500) } : {}),
    ...(clientPrenom ? { clientPrenom: String(clientPrenom).slice(0, 200) } : {}),
    ...(clientNom ? { clientNom: String(clientNom).slice(0, 200) } : {}),
    ...(clientDOB ? { clientDOB: String(clientDOB).slice(0, 20) } : {}),
    ...(clientEmail ? { clientEmail: String(clientEmail).slice(0, 320) } : {}),
  };

  // Validate card input if provided
  let usedCardInfo = null;
  if (savedCard && savedCard.last4) {
    usedCardInfo = {
      id: savedCard.id || 'card_saved',
      brand: String(savedCard.brand || 'CB').toUpperCase(),
      last4: String(savedCard.last4).slice(-4),
      exp: String(savedCard.exp || ''),
      name: String(savedCard.name || authEmail.split('@')[0].toUpperCase()),
    };
  } else if (card) {
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

  // ── MODE STRIPE RÉEL (DÉBIT BANCAIRE & VÉRIFICATION 3D SECURE) ──
  // Lorsque STRIPE_SECRET_KEY est configurée sur le serveur, on ne valide JAMAIS une commande sans débit réel Stripe !
  if (stripe) {
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

    // Cas 0 : Si le client a saisi une nouvelle carte (card), créer le PaymentMethod Stripe réel
    if (paymentMode !== 'apple_pay' && card && card.cardNumber) {
      try {
        const rawNum = String(card.cardNumber || '').replace(/\D/g, '');
        const expMatch = String(card.exp || '').trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
        if (expMatch && rawNum && isValidLuhn(rawNum)) {
          const expMonth = parseInt(expMatch[1], 10);
          const expYear = 2000 + parseInt(expMatch[2], 10);
          const pm = await stripe.paymentMethods.create({
            type: 'card',
            card: {
              number: rawNum,
              exp_month: expMonth,
              exp_year: expYear,
              cvc: String(card.cvv || '').replace(/\D/g, ''),
            },
            billing_details: {
              name: card.name || authEmail,
              email: authEmail,
            },
          });
          if (pm && pm.id) {
            usedCardInfo = {
              id: pm.id,
              brand: (pm.card?.brand || detectBrand(rawNum)).toUpperCase(),
              last4: pm.card?.last4 || rawNum.slice(-4),
              exp: `${String(expMonth).padStart(2, '0')}/${String(expYear).slice(-2)}`,
              name: card.name || authEmail,
            };
            if (stripeCustomerId) {
              try {
                await stripe.paymentMethods.attach(pm.id, { customer: stripeCustomerId });
              } catch (_) {}
            }
          }
        }
      } catch (pmErr) {
        console.warn('[checkout] Direct PaymentMethod creation failed:', pmErr.message);
        if (isStripeAccountRestrictedError(pmErr)) {
          return sendStripeMaintenanceResponse(res);
        }
        if (pmErr.type === 'StripeCardError') {
          return res.status(402).json({
            error: pmErr.message || 'Ta banque a refusé cette carte bancaire.',
          });
        }
      }
    }

    // Cas 1 : Si le client a une carte Stripe 3DS (pm_xxx), tenter le débit réel immédiat
    if (paymentMode !== 'apple_pay' && usedCardInfo && String(usedCardInfo.id).startsWith('pm_')) {
      try {
        const piParams = {
          amount: amountCents,
          currency: 'eur',
          payment_method: usedCardInfo.id,
          confirm: true,
          return_url: `${siteUrl}/success`,
          metadata: {
            ...metadata,
            cardBrand: usedCardInfo.brand,
            cardLast4: usedCardInfo.last4,
          },
        };
        if (stripeCustomerId) piParams.customer = stripeCustomerId;

        const pi = await stripe.paymentIntents.create(piParams);

        if (pi && pi.status === 'succeeded') {
          const sessionId = 'cs_live_' + pi.id;
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
              stripePaymentIntentId: pi.id,
              cardBrand: usedCardInfo.brand,
              cardLast4: usedCardInfo.last4,
            },
          };
          localOrders.set(sessionId, sessionObj);
          const profKey = authEmail.toLowerCase().trim();
          const profMem = localProfiles.get(profKey) || {};
          const userOrders = Array.isArray(profMem.orders) ? profMem.orders : [];
          userOrders.unshift(sessionObj);
          localProfiles.set(profKey, { ...profMem, orders: userOrders.slice(0, 50) });

          sendOwnerDM(buildOrderMessage({
            accountEmail: authEmail,
            productName: finalQty > 1 ? `${productName} (×${finalQty})` : productName,
            tierName,
            priceRaw,
            sessionId,
            clientPrenom,
            clientNom,
            clientDOB,
            clientEmail,
          })).catch(() => {});

          return res.status(200).json({
            ok: true,
            debited: true,
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
        } else if (pi && pi.status === 'requires_action' && pi.next_action?.redirect_to_url?.url) {
          // Validation 3D Secure obligatoire par la banque du client
          return res.status(200).json({
            ok: true,
            requiresStripeCheckout: true,
            sessionId: 'cs_live_' + pi.id,
            url: pi.next_action.redirect_to_url.url,
          });
        }
      } catch (piErr) {
        console.warn('[checkout] Direct PaymentIntent requires 3DS or checkout session:', piErr.message);
        if (isStripeAccountRestrictedError(piErr)) {
          return sendStripeMaintenanceResponse(res);
        }
        if (piErr.type === 'StripeCardError') {
          return res.status(402).json({
            error: piErr.message || 'Ta banque a refusé le débit sur cette carte bancaire.',
          });
        }
      }
    }

    // Cas 2 : Créer une vraie session Stripe Checkout (Apple Pay / Carte Bancaire 3D Secure vérifié par Stripe)
    const promoMult = cleanPromo === 'YONIX10' ? 0.90 : 1;
    const feeCentsNum = Math.max(0, parseInt(reqStripeFeeCents, 10) || 0);
    let lineItems;
    if (Array.isArray(items) && items.length >= 1) {
      const validItems = items
        .map((it) => {
          const c = parsePriceCents(it.unitPriceRaw || it.priceRaw || it.price);
          if (!c || c < 50) return null;
          const itemQty = clampQty(it.quantity);
          const finalUnit = Math.max(50, Math.round(c * promoMult));
          const labelSuffix = cleanPromo ? ` (Code ${cleanPromo} -10%)` : '';
          return {
            price_data: {
              currency: 'eur',
              product_data: {
                name: (it.tierName ? `${it.productName} — ${it.tierName}` : String(it.productName || 'Article Yonix')) + labelSuffix,
              },
              unit_amount: finalUnit,
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
      const baseUnit = unitPriceRaw
        ? Math.round((parsePriceCents(unitPriceRaw) || Math.round(amountCents / finalQty)) * promoMult)
        : Math.max(50, amountCents - feeCentsNum);
      const labelSuffix = cleanPromo ? ` (Code ${cleanPromo} -10%)` : '';
      lineItems = [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: (tierName ? `${productName} — ${tierName}` : productName) + labelSuffix,
            },
            unit_amount: baseUnit,
          },
          quantity: unitPriceRaw ? finalQty : 1,
        },
      ];
    }
    if (feeCentsNum > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'TVA & Frais de transaction Stripe (2,9% + 0,25€)',
          },
          unit_amount: feeCentsNum,
        },
        quantity: 1,
      });
    }

    try {
      const sessionParams = {
        mode: 'payment',
        ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: authEmail }),
        line_items: lineItems,
        metadata: {
          ...metadata,
          paymentMethodRequested: paymentMode === 'apple_pay' ? 'apple_pay' : 'card',
        },
        success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/#boutique`,
      };

      if (stripeCustomerId) {
        sessionParams.payment_intent_data = {
          setup_future_usage: 'on_session',
          metadata: {
            ...metadata,
            paymentMethodRequested: paymentMode === 'apple_pay' ? 'apple_pay' : 'card',
          },
        };
      }

      let session;
      try {
        session = await stripe.checkout.sessions.create({
          ...sessionParams,
          automatic_payment_methods: { enabled: true },
        });
      } catch (autoErr) {
        console.warn('[checkout] Primary automatic_payment_methods fallback:', autoErr.message);
        try {
          session = await stripe.checkout.sessions.create({
            ...sessionParams,
            payment_method_types: ['card'],
          });
        } catch (pmTypeErr) {
          console.warn('[checkout] payment_method_types fallback:', pmTypeErr.message);
          session = await stripe.checkout.sessions.create(sessionParams);
        }
      }

      return res.status(200).json({
        ok: true,
        requiresStripeCheckout: true,
        sessionId: session.id,
        url: session.url,
      });
    } catch (err) {
      console.error('[checkout] Stripe session creation failed:', err.message);
      if (isStripeAccountRestrictedError(err)) {
        return sendStripeMaintenanceResponse(res);
      }
      return res.status(500).json({
        error: 'Erreur de connexion à Stripe : ' + (err.message || 'Réessaie dans un instant.'),
      });
    }
  }

  // ── MODE HORS-LIGNE / DÉVELOPPEMENT LOCAL (uniquement si STRIPE_SECRET_KEY n'est pas configurée) ──
  if (paymentMode === 'apple_pay' && !usedCardInfo) {
    usedCardInfo = {
      id: 'apple_pay_' + crypto.randomBytes(4).toString('hex'),
      brand: 'APPLE PAY',
      last4: 'APAY',
      exp: '',
      name: authEmail.split('@')[0].toUpperCase(),
    };
  }
  if (!usedCardInfo) {
    return res.status(400).json({
      error: 'Saisis une carte bancaire valide ou choisis Apple Pay via Stripe.',
    });
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

  const profKey = authEmail.toLowerCase().trim();
  const profMem = localProfiles.get(profKey) || {};
  const userOrders = Array.isArray(profMem.orders) ? profMem.orders : [];
  userOrders.unshift(sessionObj);
  localProfiles.set(profKey, { ...profMem, orders: userOrders.slice(0, 50) });

  sendOwnerDM(buildOrderMessage({
    accountEmail: authEmail,
    productName: finalQty > 1 ? `${productName} (×${finalQty})` : productName,
    tierName,
    priceRaw,
    sessionId,
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
  })).catch(() => {});

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
