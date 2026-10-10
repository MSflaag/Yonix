const fs = require('fs');
const path = require('path');

function fixSpace(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  content = content.replace(/à /g, ' ');
  
  // Restore specific known 'à ' texts
  content = content.replace(/Prêt  /g, 'Prêt à ');
  content = content.replace(/Boîte  /g, 'Boîte à ');
  content = content.replace(/Lié  /g, 'Lié à ');
  content = content.replace(/Mettre  /g, 'Mettre à ');
  content = content.replace(/accéder  /g, 'accéder à ');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js') || fullPath.endsWith('.json')) {
      fixSpace(fullPath);
    }
  }
}

walk(path.join(__dirname, 'public'));
walk(path.join(__dirname, 'api'));
