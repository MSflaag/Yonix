// api/account/download.js
// Génère une URL de téléchargement sécurisée et temporaire (10 min)
// Les fichiers sont servis depuis /public/files/ — Vercel les sert en statique
// Env: AUTH_SECRET, SITE_URL, DOWNLOAD_SECRET

import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'changeme-32-chars-secret-key-here';
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'download-secret-key-here';
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Whitelist des fichiers téléchargeables (nom de fichier uniquement, pas de path traversal)
const ALLOWED_FILES = new Set([
  // Jailbreaks — ajoute tes vrais noms de fichiers ici
  'jailbreak-gemini.txt',
  'jailbreak-chatgpt.txt',
  'jailbreak-claude.txt',
  'jailbreak-grok.txt',
  'jailbreak-deepseek.txt',
  'jailbreak-kimi.txt',
  'jailbreak-qwen.txt',
  'jailbreak-glm.txt',
  'jailbreak-arena.txt',
  'jailbreak-bundle.zip',
  // Cheats — loaders
  'valorant-emu-loader.zip',
  'valorant-private-loader.zip',
  'cs2-loader.zip',
  'spoofer-temp.zip',
  'spoofer-perm.zip',
]);

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
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    return email;
  } catch {
    return null;
  }
}

function generateSignedUrl(filename, email) {
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${filename}|${email}|${expires}`;
  const sig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payload).digest('hex');
  const params = new URLSearchParams({ file: filename, email, expires: String(expires), sig });
  return `${SITE_URL}/api/account/serve?${params}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = getEmailFromCookie(req.headers.cookie);
  if (!email) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  const { file } = req.query || {};
  if (!file || !ALLOWED_FILES.has(file)) {
    return res.status(400).json({ error: 'Fichier non autorisé.' });
  }

  const url = generateSignedUrl(file, email);
  return res.status(200).json({ url });
}
