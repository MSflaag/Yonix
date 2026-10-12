// api/account/download.js
// Génère une URL de téléchargement sécurisée et temporaire (10 min)
// Les fichiers sont servis depuis /public/files/ — Vercel les sert en statique
// Env: AUTH_SECRET, SITE_URL, DOWNLOAD_SECRET

import crypto from 'crypto';
import { getAuthenticatedEmail } from '../auth/send-link.js';

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

  const email = getAuthenticatedEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  const { file } = req.query || {};
  if (file === 'cs2-loader.zip') {
    return res.status(200).json({
      url: 'https://drive.proton.me/urls/367277226R#i9SCrjcTxvvb',
      external: true,
      fileKey: 'YONIX-123',
    });
  }
  if (!file || !ALLOWED_FILES.has(file)) {
    return res.status(400).json({ error: 'Fichier non autorisé.' });
  }

  const url = generateSignedUrl(file, email);
  return res.status(200).json({ url });
}
