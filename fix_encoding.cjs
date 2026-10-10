const fs = require('fs');
const path = require('path');

const replacements = [
  { bad: /GǸnǸrales/g, good: 'Générales' },
  { bad: /tǸlǸchargǸ/g, good: 'téléchargé' },
  { bad: /tǸlǸchargement/g, good: 'téléchargement' },
  { bad: /Ǹ/g, good: 'é' },
  { bad: /o"/g, good: '✓' },
  { bad: /\?"/g, good: '—' },
  { bad: /ǩ/g, good: 'î' },
  { bad: /YήY/g, good: '🇫🇷' },
  { bad: /YΪY/g, good: '🇬🇧' },
  { bad: /requǦtes/g, good: 'requêtes' },
  { bad: /RǸessaie/g, good: 'Réessaie' },
  { bad: /0,00 \'/g, good: '0,00 €' },
  { bad: / /g, good: 'à ' },
  { bad: /dǸconnexion/g, good: 'déconnexion' },
  { bad: /rǸseau/g, good: 'réseau' },
  { bad: /vǸrifiǸ/g, good: 'vérifié' },
  { bad: /expǸditeur/g, good: 'expéditeur' },
  { bad: /GǸnre/g, good: 'Génère' },
  { bad: /accǸder/g, good: 'accéder' },
  { bad: /chargement\?/g, good: 'chargement…' },
  { bad: /boǩte/g, good: 'boîte' },
  { bad: /\?/g, good: '…' }
];

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  for (const rep of replacements) {
    content = content.replace(rep.bad, rep.good);
  }
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed', filePath);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js') || fullPath.endsWith('.json')) {
      fixFile(fullPath);
    }
  }
}

walk(path.join(__dirname, 'public'));
walk(path.join(__dirname, 'api'));
