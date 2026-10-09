// api/account/serve.js
// Sert le fichier après vérification de la signature temporaire
// Env: DOWNLOAD_SECRET

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'download-secret-key-here';

// Les fichiers sont dans /public/files/ — chemin relatif à la racine du projet
const FILES_DIR = path.resolve(process.cwd(), 'public', 'files');

export default async function handler(req, res) {
  const { file, email, expires, sig } = req.query || {};

  if (!file || !email || !expires || !sig) {
    return res.status(400).send('Paramètres manquants.');
  }

  // Vérifier expiration
  if (Date.now() > parseInt(expires, 10)) {
    return res.status(410).send('Lien expiré. Retourne sur ton compte pour en générer un nouveau.');
  }

  // Vérifier signature
  const payload = `${file}|${email}|${expires}`;
  const expected = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(403).send('Signature invalide.');
  }

  // Sécurité : pas de path traversal
  const safeName = path.basename(file);
  const filePath = path.join(FILES_DIR, safeName);

  if (!filePath.startsWith(FILES_DIR)) {
    return res.status(403).send('Accès refusé.');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Fichier introuvable.');
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}
