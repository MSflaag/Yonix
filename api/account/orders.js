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
const stripe = stripeKey
  ? new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  : null;

// Caches en mémoire (en complément des metadata Stripe Customers & Checkout Sessions)
const localDeliveries = globalThis.__yonixDeliveries || (globalThis.__yonixDeliveries = new Map());
const localProfiles = globalThis.__yonixProfiles || (globalThis.__yonixProfiles = new Map());
const phoneCodes = globalThis.__yonixPhoneCodes || (globalThis.__yonixPhoneCodes = new Map());

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
    clientPrenom: m.clientPrenom || '',
    clientNom: m.clientNom || '',
    clientDOB: m.clientDOB || '',
    clientEmail: m.clientEmail || '',
  };
}

export default async function handler(req, res) {
  const email = getAuthenticatedEmail(req);

  // ── POST : Actions Utilisateur & Actions d'Administration ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action, adminKey } = body;

    // 1. Actions d'administration (list_all, deliver)
    if (action === 'list_all' || action === 'deliver') {
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
        const { sessionId, deliveredProduct, deliveredFile } = body;
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
          try {
            const fallbackSession = await stripe.checkout.sessions.retrieve(sessionId);
            return res.status(200).json({
              ok: true,
              order: formatSessionOrder(fallbackSession),
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

  if (!stripe) {
    return res.status(200).json({
      email,
      isAdmin: isAuthorizedAdmin(email, null),
      profile,
      cards,
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
      orders: [],
    });
  }
}
