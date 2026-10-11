// api/auth/send-link.js
// Authentification Email + Mot de passe (Inscription & Connexion)
// + Blocage strict des domaines non vérifiés / temp-mail
// Stockage persistant sur Stripe Customers metadata (+ fallback local signé)

import Stripe from 'stripe';
import crypto from 'crypto';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 jours en secondes

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

// Liste stricte des fournisseurs d'emails vérifiés et reconnus (bloque tous les temp-mails)
const VERIFIED_EMAIL_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'outlook.fr', 'outlook.be', 'outlook.ch',
  'hotmail.com', 'hotmail.fr', 'hotmail.be', 'hotmail.co.uk', 'hotmail.ch',
  'live.com', 'live.fr', 'live.be', 'msn.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Yahoo
  'yahoo.com', 'yahoo.fr', 'yahoo.co.uk', 'ymail.com',
  // Opérateurs & FAI vérifiés (France / Belgique / Suisse / Canada)
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr',
  'laposte.net', 'bbox.fr', 'bouygtel.fr', 'numericable.fr',
  'skynet.be', 'proximus.be', 'voo.be', 'bluewin.ch',
  'videotron.ca', 'bell.net', 'sympatico.ca',
  // Fournisseurs sécurisés vérifiés
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.fr', 'gmx.com', 'gmx.de', 'gmx.net',
  'aol.com', 'aol.fr', 'zoho.com', 'mail.com', 'fastmail.com'
]);

// Motifs de domaines jetables / temp-mail explicitement bannis
const BLOCKED_DOMAIN_PATTERNS = [
  'temp', 'trash', 'yopmail', 'guerrilla', 'mailinator', '10minute',
  'throwaway', 'sharklasers', 'getnada', 'maildrop', 'dispostable',
  'mohmal', 'fakeinbox', 'emailondeck', 'crazymailing', 'jetable',
  'burner', 'tempmail', 'mailnesia', 'mintemail', 'mytemp', 'spam4',
  'grr.la', 'pokemail', 'rcpt.at', 'kurzepost', 'objectmail', 'proxymail'
];

// Mémoire locale de secours si Stripe n'est pas configuré en dev local
const localUsers = globalThis.__yonixUsers || (globalThis.__yonixUsers = new Map());

export function validateVerifiedEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return { valid: false, error: 'Adresse email requise.' };
  }
  const email = rawEmail.toLowerCase().trim();
  const basicRegex = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
  const match = email.match(basicRegex);
  if (!match) {
    return { valid: false, error: 'Format d\'adresse email invalide.' };
  }
  const domain = match[1].toLowerCase();

  for (const pat of BLOCKED_DOMAIN_PATTERNS) {
    if (domain.includes(pat)) {
      return {
        valid: false,
        error: 'Les adresses email temporaires (temp-mail) sont strictement interdites.'
      };
    }
  }

  if (!VERIFIED_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: 'Domaine email non vérifié refusé. Utilise un fournisseur reconnu (Gmail, Outlook, Hotmail, iCloud, Yahoo, Orange, Free, SFR, La Poste, Proton…).'
    };
  }

  return { valid: true, email, domain };
}

export function hashPassword(password, salt) {
  return crypto
    .scryptSync(String(password), `${salt}:${AUTH_SECRET}`, 64)
    .toString('hex');
}

export function buildSessionToken(email) {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${email}|${expires}`;
  const hmac = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${hmac}`).toString('base64url');
}

export function getEmailFromCookie(cookieHeader) {
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

export async function findUserAccount(email) {
  if (stripe) {
    try {
      const list = await stripe.customers.list({ email, limit: 5 });
      const withPwd = list.data.find(c => c.metadata && c.metadata.passwordHash && c.metadata.passwordSalt);
      if (withPwd) {
        return {
          source: 'stripe',
          customer: withPwd,
          passwordHash: withPwd.metadata.passwordHash,
          passwordSalt: withPwd.metadata.passwordSalt
        };
      }
      if (list.data.length > 0) {
        return { source: 'stripe', customer: list.data[0], passwordHash: null, passwordSalt: null };
      }
    } catch (err) {
      console.error('[auth] Stripe customer lookup error:', err.message);
    }
  }
  const local = localUsers.get(email);
  if (local) {
    return { source: 'local', customer: null, passwordHash: local.passwordHash, passwordSalt: local.passwordSalt };
  }
  return null;
}

export async function saveUserAccount(email, passwordSalt, passwordHash, existingCustomer = null) {
  localUsers.set(email, { passwordSalt, passwordHash, createdAt: new Date().toISOString() });
  if (stripe) {
    try {
      if (existingCustomer) {
        await stripe.customers.update(existingCustomer.id, {
          metadata: {
            ...(existingCustomer.metadata || {}),
            passwordSalt,
            passwordHash,
            accountVerified: 'true',
            updatedAt: new Date().toISOString()
          }
        });
      } else {
        await stripe.customers.create({
          email,
          metadata: {
            passwordSalt,
            passwordHash,
            accountVerified: 'true',
            createdAt: new Date().toISOString()
          }
        });
      }
    } catch (err) {
      console.error('[auth] Stripe customer save error:', err.message);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email: rawEmail, password, action = 'login' } = req.body || {};

  // 1. Validation stricte de l'email et du domaine (anti temp-mail)
  const check = validateVerifiedEmail(rawEmail);
  if (!check.valid) {
    return res.status(400).json({ error: check.error });
  }
  const normalizedEmail = check.email;

  // 2. Validation du mot de passe
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Mot de passe trop long.' });
  }

  try {
    const existing = await findUserAccount(normalizedEmail);

    if (action === 'register' || action === 'signup') {
      if (existing && existing.passwordHash) {
        return res.status(400).json({
          error: 'Un compte existe déjà avec cette adresse email. Connecte-toi avec ton mot de passe.'
        });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      await saveUserAccount(normalizedEmail, salt, hash, existing?.customer || null);
    } else {
      // Connexion (login)
      if (!existing || !existing.passwordHash || !existing.passwordSalt) {
        return res.status(401).json({
          error: 'Aucun compte trouvé avec cet email. Crée d\'abord un compte avec mot de passe.'
        });
      }

      const computedHash = hashPassword(password, existing.passwordSalt);
      const a = Buffer.from(computedHash, 'hex');
      const b = Buffer.from(existing.passwordHash, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
      }
    }

    // 3. Création du cookie de session yonix_session
    const sessionToken = buildSessionToken(normalizedEmail);
    const isProd = process.env.NODE_ENV === 'production' || SITE_URL.startsWith('https');

    res.setHeader('Set-Cookie', [
      `yonix_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${isProd ? '; Secure' : ''}`
    ]);

    return res.status(200).json({
      ok: true,
      email: normalizedEmail
    });
  } catch (err) {
    console.error('[auth] Unhandled error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification.' });
  }
}
