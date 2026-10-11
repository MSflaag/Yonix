// api/account/orders.js
// GET  → Retourne le profil complet, les cartes bancaires, et les commandes + produits livrés de l'utilisateur connecté
// POST → Actions Utilisateur (profil, photo, sécurité 06, cartes bancaires, mot de passe) + Actions Admin (livraison directe)

import Stripe from 'stripe';
import crypto from 'crypto';
import { findUserAccount, saveUserAccount, hashPassword, getAuthenticatedEmail } from '../auth/send-link.js';
import { sendOwnerDM } from '../notify.js';

const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const ADMIN_SECRET = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'yonix-admin-2026';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const isRealStripeKey =
  Boolean(stripeKey) &&
  (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('sk_test_')) &&
  !stripeKey.includes('...');

const stripe = isRealStripeKey
  ? new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  : null;

// Caches en mémoire (en complément des metadata Stripe Customers & Checkout Sessions)
const localOrders = globalThis.__yonixOrders || (globalThis.__yonixOrders = new Map());
const localDeliveries = globalThis.__yonixDeliveries || (globalThis.__yonixDeliveries = new Map());
const localProfiles = globalThis.__yonixProfiles || (globalThis.__yonixProfiles = new Map());
const phoneCodes = globalThis.__yonixPhoneCodes || (globalThis.__yonixPhoneCodes = new Map());
const liveReviews = globalThis.__yonixReviews || (globalThis.__yonixReviews = []);

function getSiteOrigin(req) {
  if (process.env.SITE_URL && !process.env.SITE_URL.includes('your-project.vercel.app')) {
    return process.env.SITE_URL.replace(/\/$/, '');
  }
  const proto = req?.headers?.['x-forwarded-proto'] || (req?.socket?.encrypted ? 'https' : 'http');
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function resolveProductLogoPath(serviceIdOrName, fallbackPath) {
  if (fallbackPath && String(fallbackPath).startsWith('/logos/')) return fallbackPath;
  const q = String(serviceIdOrName || '').toLowerCase();
  if (q.includes('basic') || q.includes('fit')) return '/logos/basicfit.png';
  if (q.includes('photoshop') || q.includes('adobe')) return '/logos/adobe.png';
  if (q.includes('tacos')) return '/logos/otacos.png';
  if (q.includes('spotify')) return '/logos/spotify.png';
  if (q.includes('netflix')) return '/logos/netflix.png';
  if (q.includes('crunchyroll')) return '/logos/crunchyroll.png';
  if (q.includes('canva')) return '/logos/canva.png';
  if (q.includes('disney')) return '/logos/disneyplus.png';
  if (q.includes('nitro') || q.includes('discord')) return '/logos/nitro_boost.png';
  if (q.includes('cs2') || q.includes('counter')) return '/logos/csgo.png';
  if (q.includes('valorant') || q.includes('val-')) return '/logos/valorant.png';
  if (q.includes('spoofer') || q.includes('hwid')) return '/logos/spoofer.png';
  if (q.includes('antigravity') && q.includes('claude')) return '/logos/claude_antigravity.png';
  if (q.includes('antigravity') && q.includes('gemini')) return '/logos/gemini_antigravity.png';
  if (q.includes('claude')) return '/logos/claude.png';
  if (q.includes('gemini')) return '/logos/gemini.png';
  if (q.includes('chatgpt') || q.includes('gpt')) return '/logos/chatgpt.png';
  if (q.includes('grok')) return '/logos/grok.png';
  if (q.includes('deepseek')) return '/logos/deepseek.png';
  if (q.includes('kimi')) return '/logos/kimi.png';
  if (q.includes('qwen')) return '/logos/qwen.png';
  if (q.includes('glm')) return '/logos/glm.png';
  if (q.includes('arena')) return '/logos/arena.png';
  return '/logos/Yonix.png';
}

export function buildProductDeliveryEmail({
  origin,
  customerEmail,
  serviceId,
  serviceName,
  serviceCategory,
  serviceImage,
  customMessage,
  deliveredProduct,
  deliveredFile,
  sessionId,
}) {
  const site = (origin || SITE_URL).replace(/\/$/, '');
  const logoRel = resolveProductLogoPath(serviceId || serviceName, serviceImage);
  const absProductImg = logoRel.startsWith('http') ? logoRel : `${site}${logoRel}`;
  const absYonixLogo = `${site}/logos/Yonix.png`;
  const reviewUrl = `${site}/avis?review=1&product=${encodeURIComponent(serviceName || 'Produit YONIX')}&serviceId=${encodeURIComponent(serviceId || '')}&email=${encodeURIComponent(customerEmail || '')}`;
  const storeUrl = `${site}/boutique`;
  const profileUrl = `${site}/profile`;
  const defaultMsg = `Ton compte / service ${serviceName || 'YONIX'} est activé ! N'hésite pas à repasser commande ou à nous laisser un petit avis juste ici.`;
  const msgText = (customMessage || defaultMsg).trim();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ta commande ${escapeHtml(serviceName)} — YONIX</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0E17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#F8FAFC;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0A0E17;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#111623;border:1px solid #1E2738;border-radius:20px;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0F172A 0%,#1E3A8A 60%,#4E7CFF 100%);padding:26px 28px;text-align:center;">
              <img src="${escapeHtml(absYonixLogo)}" alt="YONIX" width="52" height="52" style="display:block;margin:0 auto 10px;border-radius:12px;border:2px solid rgba(255,255,255,0.2);">
              <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#FFFFFF;">YONIX</div>
              <div style="font-size:13px;color:#BFDBFE;margin-top:4px;font-weight:600;">Livraison &amp; Activation officielle de ta commande</div>
            </td>
          </tr>

          <!-- Product Visual Showcase Card -->
          <tr>
            <td style="padding:28px 28px 10px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#161E31;border:1px solid rgba(78,124,255,0.38);border-radius:16px;padding:22px;text-align:center;">
                <tr>
                  <td align="center">
                    <div style="display:inline-block;padding:4px 12px;border-radius:999px;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.4);color:#4ADE80;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:14px;">
                      ✓ ${escapeHtml(serviceCategory || 'Service Activé')} · Livré
                    </div>
                    <div style="margin:6px auto 14px;width:96px;height:96px;border-radius:20px;background:#0D1322;border:1px solid #263147;padding:12px;display:flex;align-items:center;justify-content:center;">
                      <img src="${escapeHtml(absProductImg)}" alt="${escapeHtml(serviceName)}" width="92" height="92" style="display:block;margin:0 auto;max-width:92px;max-height:92px;object-fit:contain;border-radius:12px;">
                    </div>
                    <div style="font-size:20px;font-weight:800;color:#FFFFFF;margin-bottom:4px;">${escapeHtml(serviceName || 'Produit YONIX')}</div>
                    ${customerEmail ? `<div style="font-size:12.5px;color:#94A3B8;">Client : <strong style="color:#E2E8F0;">${escapeHtml(customerEmail)}</strong></div>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Personal Message from Admin -->
          <tr>
            <td style="padding:14px 28px 8px;">
              <div style="background:rgba(78,124,255,0.1);border-left:4px solid #4E7CFF;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.6;color:#F1F5F9;font-weight:500;">
                ${escapeHtml(msgText).replace(/\n/g, '<br>')}
              </div>
            </td>
          </tr>

          <!-- Delivered Credentials / Access Box -->
          ${deliveredProduct ? `
          <tr>
            <td style="padding:14px 28px 8px;">
              <div style="font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#60A5FA;margin-bottom:8px;">
                Tes accès / Ton produit livré :
              </div>
              <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px;line-height:1.55;color:#F8FAFC;background:#0A0E17;padding:15px 16px;border-radius:12px;border:1px solid #263147;">${escapeHtml(deliveredProduct)}</pre>
            </td>
          </tr>` : ''}

          <!-- CTA Buttons: Leave a Live Review + Reorder -->
          <tr>
            <td style="padding:22px 28px 26px;text-align:center;">
              <div style="margin-bottom:12px;">
                <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#4E7CFF;color:#FFFFFF;font-weight:800;font-size:14.5px;text-decoration:none;padding:14px 26px;border-radius:12px;box-shadow:0 8px 20px rgba(78,124,255,0.35);">
                  ★ Laisser un petit avis en direct juste ici
                </a>
              </div>
              <div>
                <a href="${escapeHtml(storeUrl)}" style="display:inline-block;background:#1E293B;color:#E2E8F0;border:1px solid #334155;font-weight:700;font-size:13.5px;text-decoration:none;padding:11px 22px;border-radius:10px;margin:4px;">
                  Repasser commande sur YONIX
                </a>
                <a href="${escapeHtml(profileUrl)}" style="display:inline-block;background:#1E293B;color:#93C5FD;border:1px solid #334155;font-weight:700;font-size:13.5px;text-decoration:none;padding:11px 22px;border-radius:10px;margin:4px;">
                  Voir sur mon compte
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0B0F1A;border-top:1px solid #1E2738;padding:18px 28px;text-align:center;font-size:12px;color:#64748B;">
              © 2026 YONIX · Livraison instantanée &amp; Support Discord 24/7${sessionId ? ` · Réf: ${escapeHtml(String(sessionId).slice(-10))}` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmailViaResend({ to, subject, html }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || apiKey === 're_...' || !apiKey.startsWith('re_')) {
    return { sent: false, reason: 'RESEND_API_KEY non configurée (aperçu direct généré)' };
  }
  const from = (process.env.RESEND_FROM || 'Yonix <onboarding@resend.dev>').trim();
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.warn('[orders:email] Resend API warning:', errText);
      return { sent: false, reason: `Resend (${resp.status})` };
    }
    const data = await resp.json();
    return { sent: true, id: data.id };
  } catch (err) {
    console.warn('[orders:email] Resend network error:', err.message);
    return { sent: false, reason: err.message };
  }
}

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

function normalizeFrenchPhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  let clean = digits;
  if (clean.startsWith('+33')) {
    clean = '0' + clean.slice(3);
  } else if (clean.startsWith('0033')) {
    clean = '0' + clean.slice(4);
  } else if (clean.startsWith('33') && clean.length === 11) {
    clean = '0' + clean.slice(2);
  }
  if (!/^0[67]\d{8}$/.test(clean)) {
    return null;
  }
  const formatted = clean.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  return { raw: clean, formatted, e164: '+33' + clean.slice(1) };
}

async function getOrCreateProfileData(email) {
  const key = email.toLowerCase().trim();
  const mem = localProfiles.get(key) || {};
  let stripeCust = null;

  if (stripe) {
    try {
      const acct = await findUserAccount(key);
      stripeCust = acct?.customer || null;
    } catch (err) {
      console.warn('[profile] Stripe customer read warning:', err.message);
    }
  }

  const m = stripeCust?.metadata || {};

  // Reconstruct avatar from Stripe metadata chunks if not in memory
  let metaAvatar = '';
  for (let i = 0; i < 8; i++) {
    if (m[`avatar_${i}`]) metaAvatar += m[`avatar_${i}`];
  }

  let savedCards = [];
  if (Array.isArray(mem.cards)) {
    savedCards = mem.cards;
  } else if (m.savedCardsJson) {
    try {
      savedCards = JSON.parse(m.savedCardsJson);
    } catch {
      savedCards = [];
    }
  }

  // Fetch attached Stripe PaymentMethods (if any) and merge
  if (stripe && stripeCust?.id) {
    try {
      const pms = await stripe.paymentMethods.list({
        customer: stripeCust.id,
        type: 'card',
      });
      for (const pm of pms.data) {
        if (pm.card && !savedCards.some(c => c.id === pm.id || (c.last4 === pm.card.last4 && c.brand === (pm.card.brand || '').toUpperCase()))) {
          const expMonth = String(pm.card.exp_month || 1).padStart(2, '0');
          const expYear = String(pm.card.exp_year || 28).slice(-2);
          savedCards.unshift({
            id: pm.id,
            brand: (pm.card.brand || 'CARD').toUpperCase(),
            last4: pm.card.last4,
            exp: `${expMonth}/${expYear}`,
            name: pm.billing_details?.name || stripeCust.name || email.split('@')[0].toUpperCase(),
            isDefault: savedCards.length === 0,
            source: 'stripe',
          });
        }
      }
    } catch (pmErr) {
      console.warn('[profile] Stripe PM list warning:', pmErr.message);
    }
  }

  const defaultName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const profile = {
    displayName: mem.displayName !== undefined ? mem.displayName : (m.displayName || stripeCust?.name || defaultName),
    discordTag: mem.discordTag !== undefined ? mem.discordTag : (m.discordTag || ''),
    bio: mem.bio !== undefined ? mem.bio : (m.bio || 'Membre vérifié YONIX'),
    avatarUrl: mem.avatarUrl !== undefined ? mem.avatarUrl : (metaAvatar || ''),
    phone: mem.phone !== undefined ? mem.phone : (m.phone || stripeCust?.phone || ''),
    phoneVerified: mem.phoneVerified !== undefined ? mem.phoneVerified : (m.phoneVerified === 'true'),
    twoFactorPhone: mem.twoFactorPhone !== undefined ? mem.twoFactorPhone : (m.twoFactorPhone === 'true'),
    updatedAt: mem.updatedAt || m.updatedAt || null,
  };

  return { profile, cards: savedCards, stripeCust };
}

async function persistProfileData(email, profile, cards, stripeCust = null) {
  const key = email.toLowerCase().trim();
  const updatedAt = new Date().toISOString();
  const nextProfile = { ...profile, updatedAt };
  localProfiles.set(key, { ...nextProfile, cards });

  if (stripe) {
    try {
      let cust = stripeCust;
      if (!cust) {
        const acct = await findUserAccount(key);
        cust = acct?.customer || null;
      }

      // Split avatarUrl into ≤490-char metadata chunks if small enough (up to 3900 chars)
      const avatarChunks = {};
      const avStr = String(nextProfile.avatarUrl || '');
      if (avStr.length <= 3900) {
        for (let i = 0; i < 8; i++) {
          avatarChunks[`avatar_${i}`] = avStr.slice(i * 490, (i + 1) * 490) || '';
        }
      }

      const cardsJson = JSON.stringify((cards || []).slice(0, 5)).slice(0, 490);

      const metaUpdate = {
        ...(cust?.metadata || {}),
        displayName: String(nextProfile.displayName || '').slice(0, 120),
        discordTag: String(nextProfile.discordTag || '').slice(0, 100),
        bio: String(nextProfile.bio || '').slice(0, 250),
        phone: String(nextProfile.phone || '').slice(0, 40),
        phoneVerified: nextProfile.phoneVerified ? 'true' : 'false',
        twoFactorPhone: nextProfile.twoFactorPhone ? 'true' : 'false',
        savedCardsJson: cardsJson,
        updatedAt,
        ...avatarChunks,
      };

      if (cust?.id) {
        await stripe.customers.update(cust.id, {
          name: String(nextProfile.displayName || '').slice(0, 120) || undefined,
          phone: String(nextProfile.phone || '').slice(0, 20) || undefined,
          metadata: metaUpdate,
        });
      } else {
        await stripe.customers.create({
          email: key,
          name: String(nextProfile.displayName || '').slice(0, 120) || undefined,
          phone: String(nextProfile.phone || '').slice(0, 20) || undefined,
          metadata: metaUpdate,
        });
      }
    } catch (err) {
      console.warn('[profile] Stripe persist warning:', err.message);
    }
  }

  return { profile: nextProfile, cards };
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
  const serviceId = local.serviceId || m.serviceId || m.productId || '';
  const serviceName = local.serviceName || m.serviceName || m.productName || 'Produit';
  const serviceCategory = local.serviceCategory || m.serviceCategory || 'Service';
  const serviceImage =
    local.serviceImage ||
    m.serviceImage ||
    resolveProductLogoPath(serviceId || serviceName || m.productName, '');
  const customMessage =
    local.customMessage !== undefined
      ? local.customMessage
      : (m.customMessage || '');

  const deliveryStatus =
    deliveredProduct || downloadFile || customMessage || m.deliveryStatus === 'delivered'
      ? 'delivered'
      : 'pending';

  const customerEmail = (
    local.customerEmail ||
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
    productName: m.productName || serviceName || 'Produit',
    tierName: m.tierName || '',
    priceRaw: m.priceRaw || '',
    amount: s.amount_total,
    currency: s.currency || 'eur',
    downloadFile,
    deliveredProduct: deliveredProduct || '',
    deliveredAt,
    deliveryStatus,
    serviceId,
    serviceName,
    serviceCategory,
    serviceImage,
    customMessage,
    clientPrenom: m.clientPrenom || '',
    clientNom: m.clientNom || '',
    clientDOB: m.clientDOB || '',
    clientEmail: m.clientEmail || '',
  };
}

export default async function handler(req, res) {
  const email = getAuthenticatedEmail(req);

  // ── GET public : Liste des avis clients en direct (?action=reviews) ──
  if (req.method === 'GET' && req.query?.action === 'reviews') {
    return res.status(200).json({
      ok: true,
      reviews: liveReviews.slice(0, 100),
    });
  }

  // ── POST : Actions Publiques (Avis en direct), Utilisateur & Administration ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action, adminKey } = body;

    // 0. Action publique / client : Ajouter un avis en direct
    if (action === 'add_review') {
      const rawName = String(body.name || email?.split('@')[0] || 'Client Vérifié').trim().slice(0, 40);
      const rawMsg = String(body.msg || '').trim().slice(0, 500);
      const rawProduct = String(body.product || 'Basic Fit Ultimate').trim().slice(0, 80);
      const rawServiceId = String(body.serviceId || '').trim().slice(0, 50);
      const rawTag = String(body.tag || '').trim();
      const rawStars = Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5));
      const rawProofImg = body.proofImg && String(body.proofImg).startsWith('data:image/')
        ? String(body.proofImg).slice(0, 350000)
        : '';
      const productImg = resolveProductLogoPath(rawServiceId || rawProduct, body.productImg);

      if (!rawMsg || rawMsg.length < 2) {
        return res.status(400).json({ error: 'Écris un court message pour publier ton avis.' });
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const initials = rawName
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase() || 'YX';

      const newReview = {
        id: 'rv_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        name: rawName,
        date: dateStr,
        msg: rawMsg,
        product: rawProduct,
        serviceId: rawServiceId,
        productImg,
        tag: rawTag || (rawProduct.toLowerCase().includes('basic') ? 'green' : rawProduct.toLowerCase().includes('jailbreak') ? 'jb' : 'purple'),
        stars: rawStars,
        av: initials,
        proof: `Avis vérifié en direct · ${rawProduct}`,
        proofImg: rawProofImg,
        createdAt: Date.now(),
      };

      liveReviews.unshift(newReview);
      if (liveReviews.length > 100) liveReviews.length = 100;

      sendOwnerDM(
        `⭐ **NOUVEL AVIS CLIENT EN DIRECT — YONIX**\n` +
        `👤 **Pseudo :** ${rawName}\n` +
        `📦 **Service / Produit :** ${rawProduct}\n` +
        `🌟 **Note :** ${'★'.repeat(rawStars)} (${rawStars}/5)\n` +
        `💬 **Avis :** ${rawMsg}`
      ).catch(() => {});

      return res.status(200).json({
        ok: true,
        review: newReview,
        reviews: liveReviews.slice(0, 100),
      });
    }

    // 1. Actions d'administration (list_all, deliver, send_service_email, delete_review)
    if (
      action === 'list_all' ||
      action === 'deliver' ||
      action === 'send_service_email' ||
      action === 'delete_review'
    ) {
      if (!isAuthorizedAdmin(email, adminKey)) {
        return res.status(403).json({ error: 'Code administrateur invalide.' });
      }

      if (action === 'delete_review') {
        const { reviewId } = body;
        const idx = liveReviews.findIndex((r) => r.id === reviewId);
        if (idx !== -1) liveReviews.splice(idx, 1);
        return res.status(200).json({ ok: true, reviews: liveReviews.slice(0, 100) });
      }

      if (action === 'list_all') {
        const directList = Array.from(localOrders.values())
          .filter((s) => s.payment_status === 'paid')
          .map(formatSessionOrder);

        if (!stripe) {
          directList.sort((a, b) => (b.date || 0) - (a.date || 0));
          return res.status(200).json({ ok: true, orders: directList, reviews: liveReviews.slice(0, 50) });
        }

        try {
          const sessions = await stripe.checkout.sessions.list({ limit: 100 });
          const stripeOrders = sessions.data
            .filter((s) => s.payment_status === 'paid')
            .map(formatSessionOrder);
          const seenIds = new Set(stripeOrders.map((o) => o.id));
          const merged = [
            ...directList.filter((o) => !seenIds.has(o.id)),
            ...stripeOrders,
          ].sort((a, b) => (b.date || 0) - (a.date || 0));
          return res.status(200).json({ ok: true, orders: merged, reviews: liveReviews.slice(0, 50) });
        } catch (err) {
          console.error('[orders:list_all] Stripe error:', err.message);
          return res.status(200).json({ ok: true, orders: directList, reviews: liveReviews.slice(0, 50) });
        }
      }

      if (action === 'send_service_email') {
        const targetEmail = String(body.customerEmail || '').trim().toLowerCase();
        const serviceId = String(body.serviceId || 'basic-fit').trim();
        const serviceName = String(body.serviceName || 'Basic Fit Ultimate').trim();
        const serviceCategory = String(body.serviceCategory || 'Services Premium').trim();
        const serviceImage = resolveProductLogoPath(serviceId || serviceName, body.serviceImage);
        const customMessage = String(
          body.customMessage ||
          `Ton compte ${serviceName} est activé ! N'hésite pas à repasser commande ou à nous laisser un petit avis juste ici.`
        ).trim();
        const deliveredProduct = String(body.deliveredProduct || '').trim();
        const deliveredFile = String(body.deliveredFile || '').trim();

        if (!targetEmail || !targetEmail.includes('@')) {
          return res.status(400).json({ error: 'Indique une adresse email client valide.' });
        }

        const origin = getSiteOrigin(req);
        const emailSubject = `✅ Ton service ${serviceName} est activé — YONIX`;
        const emailHtml = buildProductDeliveryEmail({
          origin,
          customerEmail: targetEmail,
          serviceId,
          serviceName,
          serviceCategory,
          serviceImage,
          customMessage,
          deliveredProduct,
          deliveredFile,
          sessionId: body.sessionId || '',
        });

        const emailResult = await sendEmailViaResend({
          to: targetEmail,
          subject: emailSubject,
          html: emailHtml,
        });

        // Crée également une commande livrée sur le profil du client si aucune sessionId n'était fournie
        const sid = body.sessionId && String(body.sessionId).startsWith('cs_')
          ? String(body.sessionId)
          : `cs_live_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const nowTs = Math.floor(Date.now() / 1000);

        localDeliveries.set(sid, {
          customerEmail: targetEmail,
          serviceId,
          serviceName,
          serviceCategory,
          serviceImage,
          customMessage,
          deliveredProduct,
          deliveredFile: deliveredFile || null,
          deliveredAt: nowTs,
        });

        if (!localOrders.has(sid)) {
          localOrders.set(sid, {
            id: sid,
            created: nowTs,
            payment_status: 'paid',
            amount_total: 0,
            currency: 'eur',
            customer_email: targetEmail,
            customer_details: { email: targetEmail },
            metadata: {
              accountEmail: targetEmail,
              productName: serviceName,
              tierName: serviceCategory,
              priceRaw: 'Activé',
              serviceId,
              serviceName,
              serviceCategory,
              serviceImage,
              customMessage: customMessage.slice(0, 490),
              deliveredProduct: deliveredProduct.slice(0, 490),
              deliveryStatus: 'delivered',
              deliveredAt: String(nowTs),
            },
          });
        }

        return res.status(200).json({
          ok: true,
          emailSent: emailResult.sent,
          emailReason: emailResult.reason || null,
          emailSubject,
          emailTo: targetEmail,
          emailHtml,
          order: formatSessionOrder(localOrders.get(sid)),
        });
      }

      if (action === 'deliver') {
        const {
          sessionId,
          deliveredProduct,
          deliveredFile,
          serviceId: rawServiceId,
          serviceName: rawServiceName,
          serviceCategory: rawServiceCategory,
          serviceImage: rawServiceImage,
          customMessage: rawCustomMessage,
          customerEmail: rawCustomerEmail,
          sendEmail = true,
        } = body;

        if (!sessionId || !String(sessionId).startsWith('cs_')) {
          return res.status(400).json({ error: 'Identifiant de commande (sessionId) invalide.' });
        }
        const productText = String(deliveredProduct || '').trim();
        const fileText = String(deliveredFile || '').trim();
        const customMessage = String(rawCustomMessage || '').trim();
        if (!productText && !fileText && !customMessage) {
          return res.status(400).json({ error: 'Entre le message ou le produit (clé, accès, lien) à envoyer au client.' });
        }

        const directOrd = localOrders.get(sessionId);
        const fallbackProdName = directOrd?.metadata?.productName || 'Service YONIX';
        const serviceName = String(rawServiceName || fallbackProdName).trim();
        const serviceId = String(rawServiceId || serviceName).trim();
        const serviceCategory = String(rawServiceCategory || 'Service Activé').trim();
        const serviceImage = resolveProductLogoPath(serviceId || serviceName, rawServiceImage);
        const targetEmail = String(
          rawCustomerEmail ||
          directOrd?.metadata?.accountEmail ||
          directOrd?.customer_email ||
          ''
        ).trim().toLowerCase();

        const nowTs = Math.floor(Date.now() / 1000);
        localDeliveries.set(sessionId, {
          customerEmail: targetEmail,
          serviceId,
          serviceName,
          serviceCategory,
          serviceImage,
          customMessage,
          deliveredProduct: productText,
          deliveredFile: fileText || null,
          deliveredAt: nowTs,
        });

        const origin = getSiteOrigin(req);
        const emailSubject = `✅ Ton service ${serviceName} est activé — YONIX`;
        const emailHtml = buildProductDeliveryEmail({
          origin,
          customerEmail: targetEmail,
          serviceId,
          serviceName,
          serviceCategory,
          serviceImage,
          customMessage:
            customMessage ||
            `Ton compte ${serviceName} est activé ! N'hésite pas à repasser commande ou à nous laisser un petit avis juste ici.`,
          deliveredProduct: productText,
          deliveredFile: fileText,
          sessionId,
        });

        let emailResult = { sent: false, reason: 'Email non demandé' };
        if (sendEmail && targetEmail && targetEmail.includes('@')) {
          emailResult = await sendEmailViaResend({
            to: targetEmail,
            subject: emailSubject,
            html: emailHtml,
          });
        }

        if (directOrd) {
          directOrd.metadata = {
            ...(directOrd.metadata || {}),
            deliveryStatus: 'delivered',
            serviceId: serviceId.slice(0, 100),
            serviceName: serviceName.slice(0, 150),
            serviceCategory: serviceCategory.slice(0, 100),
            serviceImage: serviceImage.slice(0, 200),
            customMessage: customMessage.slice(0, 490),
            deliveredProduct: productText.slice(0, 490),
            deliveredProduct2: productText.slice(490, 980),
            deliveredAt: String(nowTs),
            ...(fileText ? { deliveredFile: fileText.slice(0, 490) } : {}),
          };
          localOrders.set(sessionId, directOrd);
          return res.status(200).json({
            ok: true,
            order: formatSessionOrder(directOrd),
            emailSent: emailResult.sent,
            emailReason: emailResult.reason || null,
            emailSubject,
            emailTo: targetEmail,
            emailHtml,
          });
        }

        if (!stripe) {
          return res.status(200).json({
            ok: true,
            order: {
              id: sessionId,
              customerEmail: targetEmail,
              productName: serviceName,
              serviceId,
              serviceName,
              serviceCategory,
              serviceImage,
              customMessage,
              deliveredProduct: productText,
              downloadFile: fileText || null,
              deliveryStatus: 'delivered',
              deliveredAt: nowTs,
            },
            emailSent: emailResult.sent,
            emailReason: emailResult.reason || null,
            emailSubject,
            emailTo: targetEmail,
            emailHtml,
          });
        }

        try {
          const currentSession = await stripe.checkout.sessions.retrieve(sessionId);
          const existingMeta = currentSession.metadata || {};
          const resolvedEmail =
            targetEmail ||
            (
              existingMeta.accountEmail ||
              currentSession.customer_details?.email ||
              currentSession.customer_email ||
              existingMeta.clientEmail ||
              ''
            ).toLowerCase();

          if (sendEmail && !emailResult.sent && resolvedEmail && resolvedEmail.includes('@') && !targetEmail) {
            emailResult = await sendEmailViaResend({
              to: resolvedEmail,
              subject: emailSubject,
              html: emailHtml,
            });
          }

          const part1 = productText.slice(0, 490);
          const part2 = productText.slice(490, 980);

          const updatedMeta = {
            ...existingMeta,
            deliveryStatus: 'delivered',
            serviceId: serviceId.slice(0, 100),
            serviceName: serviceName.slice(0, 150),
            serviceCategory: serviceCategory.slice(0, 100),
            serviceImage: serviceImage.slice(0, 200),
            customMessage: customMessage.slice(0, 490),
            deliveredProduct: part1,
            deliveredProduct2: part2,
            deliveredAt: String(nowTs),
            ...(fileText ? { deliveredFile: fileText.slice(0, 490) } : {}),
          };

          const updatedSession = await stripe.checkout.sessions.update(sessionId, {
            metadata: updatedMeta,
          });

          return res.status(200).json({
            ok: true,
            order: formatSessionOrder(updatedSession),
            emailSent: emailResult.sent,
            emailReason: emailResult.reason || null,
            emailSubject,
            emailTo: resolvedEmail,
            emailHtml,
          });
        } catch (err) {
          try {
            const fallbackSession = await stripe.checkout.sessions.retrieve(sessionId);
            return res.status(200).json({
              ok: true,
              order: formatSessionOrder(fallbackSession),
              emailSent: emailResult.sent,
              emailReason: emailResult.reason || null,
              emailSubject,
              emailTo: targetEmail,
              emailHtml,
            });
          } catch {
            return res.status(500).json({ error: 'Impossible de mettre à jour cette commande : ' + err.message });
          }
        }
      }
    }

    // 2. Actions Utilisateur (connexion requise)
    if (!email) {
      return res.status(401).json({ error: 'Tu dois être connecté pour modifier ton profil.' });
    }

    const { profile, cards, stripeCust } = await getOrCreateProfileData(email);

    // ── Action : Modifier le profil (nom, pseudo Discord, bio, photo de profil) ──
    if (action === 'update_profile') {
      const displayName = body.displayName !== undefined ? String(body.displayName).trim().slice(0, 60) : profile.displayName;
      const discordTag = body.discordTag !== undefined ? String(body.discordTag).trim().slice(0, 60) : profile.discordTag;
      const bio = body.bio !== undefined ? String(body.bio).trim().slice(0, 160) : profile.bio;
      const avatarUrl = body.avatarUrl !== undefined ? String(body.avatarUrl).trim() : profile.avatarUrl;

      if (!displayName) {
        return res.status(400).json({ error: 'Le nom ou pseudo du profil ne peut pas être vide.' });
      }

      const saved = await persistProfileData(
        email,
        { ...profile, displayName, discordTag, bio, avatarUrl },
        cards,
        stripeCust
      );

      return res.status(200).json({ ok: true, profile: saved.profile });
    }

    // ── Action : Envoyer un code de sécurité sur le 06 / 07 ──
    if (action === 'send_phone_code') {
      const parsed = normalizeFrenchPhone(body.phone);
      if (!parsed) {
        return res.status(400).json({
          error: 'Entre un numéro mobile valide commençant par 06 ou 07 (10 chiffres, ex: 06 12 34 56 78).',
        });
      }

      const code = String(crypto.randomInt(100000, 999999));
      phoneCodes.set(email.toLowerCase(), {
        phone: parsed.formatted,
        e164: parsed.e164,
        code,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      // Notification optionnelle Discord
      sendOwnerDM(`🔐 **Vérification Sécurité 06 YONIX**\nCompte : \`${email}\`\nNuméro : \`${parsed.formatted}\`\nCode généré : **${code}**`).catch(() => {});

      return res.status(200).json({
        ok: true,
        formattedPhone: parsed.formatted,
        verificationCode: code,
        message: `Code de sécurité généré pour le ${parsed.formatted}.`,
      });
    }

    // ── Action : Vérifier le code 06 et activer la double sécurité ──
    if (action === 'verify_phone_code') {
      const pending = phoneCodes.get(email.toLowerCase());
      const submittedCode = String(body.code || '').replace(/\s/g, '');

      if (!pending || Date.now() > pending.expiresAt) {
        return res.status(400).json({ error: 'Le code a expiré. Demande un nouveau code.' });
      }
      if (submittedCode !== pending.code) {
        return res.status(400).json({ error: 'Code de vérification incorrect.' });
      }

      phoneCodes.delete(email.toLowerCase());
      const saved = await persistProfileData(
        email,
        {
          ...profile,
          phone: pending.formatted,
          phoneVerified: true,
          twoFactorPhone: true,
        },
        cards,
        stripeCust
      );

      return res.status(200).json({
        ok: true,
        profile: saved.profile,
        message: 'Numéro 06 vérifié et sécurité renforcée activée !',
      });
    }

    // ── Action : Activer / Désactiver la double sécurité 06 ──
    if (action === 'toggle_2fa_phone') {
      if (!profile.phone || !profile.phoneVerified) {
        return res.status(400).json({ error: 'Vérifie d\'abord ton numéro 06 avant d\'activer cette option.' });
      }
      const nextState = body.enabled !== undefined ? Boolean(body.enabled) : !profile.twoFactorPhone;
      const saved = await persistProfileData(
        email,
        { ...profile, twoFactorPhone: nextState },
        cards,
        stripeCust
      );
      return res.status(200).json({ ok: true, profile: saved.profile });
    }

    // ── Action : Supprimer le numéro 06 ──
    if (action === 'remove_phone') {
      const saved = await persistProfileData(
        email,
        { ...profile, phone: '', phoneVerified: false, twoFactorPhone: false },
        cards,
        stripeCust
      );
      return res.status(200).json({ ok: true, profile: saved.profile });
    }

    // ── Action : Modifier le mot de passe du compte ──
    if (action === 'change_password') {
      const { currentPassword, newPassword } = body;
      if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
      }

      const acct = await findUserAccount(email.toLowerCase());
      if (acct && acct.passwordHash && acct.passwordSalt && currentPassword) {
        const currentHash = hashPassword(currentPassword, acct.passwordSalt);
        const a = Buffer.from(currentHash, 'hex');
        const b = Buffer.from(acct.passwordHash, 'hex');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
        }
      }

      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = hashPassword(newPassword, newSalt);
      await saveUserAccount(email.toLowerCase(), newSalt, newHash, acct?.customer || stripeCust);

      return res.status(200).json({ ok: true, message: 'Mot de passe mis à jour avec succès.' });
    }

    // ── Action : Enregistrer une carte bancaire sur le compte ──
    if (action === 'save_card') {
      const rawNum = String(body.cardNumber || '').replace(/\D/g, '');
      const exp = String(body.exp || '').trim();
      const cvv = String(body.cvv || '').replace(/\D/g, '');
      const holderName = String(body.name || '').trim().toUpperCase();

      if (rawNum.length < 15 || rawNum.length > 19) {
        return res.status(400).json({ error: 'Numéro de carte bancaire invalide (15 à 16 chiffres requis).' });
      }
      const expMatch = exp.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
      if (!expMatch) {
        return res.status(400).json({ error: 'Date d\'expiration invalide (format MM/AA requis).' });
      }
      const expMonth = parseInt(expMatch[1], 10);
      const expYear = 2000 + parseInt(expMatch[2], 10);
      const now = new Date();
      if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
        return res.status(400).json({ error: 'Cette carte bancaire est expirée.' });
      }
      if (cvv.length < 3 || cvv.length > 4) {
        return res.status(400).json({ error: 'Code CVV invalide (3 ou 4 chiffres).' });
      }
      if (!holderName || holderName.length < 2) {
        return res.status(400).json({ error: 'Indique le nom figurant sur la carte bancaire.' });
      }

      const brand = rawNum.startsWith('4')
        ? 'VISA'
        : /^5[1-5]/.test(rawNum) || /^2[2-7]/.test(rawNum)
        ? 'MASTERCARD'
        : /^3[47]/.test(rawNum)
        ? 'AMEX'
        : 'CB';

      const last4 = rawNum.slice(-4);
      const cardId = 'card_' + crypto.randomBytes(6).toString('hex');

      const filtered = cards.filter(c => !(c.last4 === last4 && c.brand === brand));
      const newCard = {
        id: cardId,
        brand,
        last4,
        exp,
        name: holderName,
        isDefault: true,
        source: 'account',
      };

      const nextCards = [
        newCard,
        ...filtered.map(c => ({ ...c, isDefault: false })),
      ];

      const saved = await persistProfileData(email, profile, nextCards, stripeCust);
      return res.status(200).json({ ok: true, cards: saved.cards });
    }

    // ── Action : Définir une carte bancaire par défaut ──
    if (action === 'set_default_card') {
      const { cardId } = body;
      const nextCards = cards.map(c => ({
        ...c,
        isDefault: c.id === cardId,
      }));
      const saved = await persistProfileData(email, profile, nextCards, stripeCust);
      return res.status(200).json({ ok: true, cards: saved.cards });
    }

    // ── Action : Supprimer une carte bancaire ──
    if (action === 'delete_card') {
      const { cardId } = body;
      if (stripe && String(cardId || '').startsWith('pm_')) {
        try {
          await stripe.paymentMethods.detach(cardId);
        } catch (e) {
          console.warn('[profile] Stripe PM detach warning:', e.message);
        }
      }
      const nextCards = cards.filter(c => c.id !== cardId);
      if (nextCards.length > 0 && !nextCards.some(c => c.isDefault)) {
        nextCards[0].isDefault = true;
      }
      const saved = await persistProfileData(email, profile, nextCards, stripeCust);
      return res.status(200).json({ ok: true, cards: saved.cards });
    }

    // ── Action : Ouvrir une session Stripe Setup sécurisée (3D Secure) pour lier une carte ──
    if (action === 'create_setup_session') {
      if (!stripe) {
        return res.status(500).json({ error: 'Stripe n\'est pas configuré sur le serveur.' });
      }
      try {
        let custId = stripeCust?.id;
        if (!custId) {
          const created = await stripe.customers.create({
            email: email.toLowerCase(),
            name: profile.displayName || undefined,
            phone: profile.phone || undefined,
            metadata: { accountVerified: 'true' },
          });
          custId = created.id;
        }
        const setupSession = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'setup',
          customer: custId,
          success_url: `${SITE_URL}/profile?card_saved=1`,
          cancel_url: `${SITE_URL}/profile?tab=payment`,
        });
        return res.status(200).json({ ok: true, url: setupSession.url });
      } catch (err) {
        console.error('[orders:create_setup_session] Stripe error:', err.message);
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: 'Action invalide.' });
  }

  // ── GET : Récupération du profil, des cartes bancaires et des commandes du client connecté ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!email) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  const { profile, cards } = await getOrCreateProfileData(email);
  const target = email.toLowerCase().trim();

  const directUserOrders = Array.from(localOrders.values())
    .filter((s) => {
      if (s.payment_status !== 'paid') return false;
      const mEmail = (s.metadata?.accountEmail || '').toLowerCase().trim();
      const cEmail = (s.customer_details?.email || s.customer_email || '').toLowerCase().trim();
      return mEmail === target || cEmail === target;
    })
    .map(formatSessionOrder);

  if (!stripe) {
    directUserOrders.sort((a, b) => (b.date || 0) - (a.date || 0));
    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      profile,
      cards,
      orders: directUserOrders,
    });
  }

  try {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
    });

    const stripeOrders = sessions.data
      .filter((s) => {
        if (s.payment_status !== 'paid') return false;
        const mEmail = (s.metadata?.accountEmail || '').toLowerCase().trim();
        const cEmail = (s.customer_details?.email || s.customer_email || '').toLowerCase().trim();
        return mEmail === target || cEmail === target;
      })
      .map(formatSessionOrder);

    const seenIds = new Set(stripeOrders.map((o) => o.id));
    const orders = [
      ...directUserOrders.filter((o) => !seenIds.has(o.id)),
      ...stripeOrders,
    ].sort((a, b) => (b.date || 0) - (a.date || 0));

    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      profile,
      cards,
      orders,
    });
  } catch (err) {
    console.error('[orders] Stripe error:', err.message);
    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      profile,
      cards,
      orders: directUserOrders,
    });
  }
}
