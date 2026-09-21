/* ==== CONFIGURATION DE LA BOUTIQUE : modifie ce fichier pour changer produits, prix et réglages ==== */
const CONFIG = {
  freeShippingFrom: 60,   // livraison offerte à partir de (€)
  shippingCost: 4.9,      // frais de port sinon (€)
  contactEmail: '',       // ex. 'contact@yonix.fr' : lien Contact + repli « Commander par e-mail »
  checkoutApi: '/api/checkout', // paiement Stripe via Vercel (voir README). Mets '' pour le désactiver
  checkoutUrl: ''         // alternative : un lien de paiement externe (Stripe Payment Link, etc.)
};

/* Pour de vraies photos : ajoute  img:'/assets/products/pulse.jpg'  à un produit (le dessin svg est alors ignoré). */
const PRODUCTS = [
  { id:'pulse', name:'Yonix Pulse', sub:'Écouteurs sans fil', cat:'Audio', price:79.9, old:99.9, badge:'-20%',
    desc:'Des écouteurs légers au son précis, avec un étui de charge qui tient dans la poche.',
    feat:['Jusqu\'à 30 h d\'autonomie avec l\'étui','Bluetooth 5.3, connexion instantanée','Résistants aux éclaboussures'],
    svg:`<svg viewBox="0 0 200 200"><ellipse cx="100" cy="178" rx="64" ry="9" fill="url(#gShadow)"/>
      <rect x="69" y="66" width="8" height="40" rx="4" fill="url(#gBlue)"/><circle cx="73" cy="64" r="15" fill="url(#gBlue)"/>
      <rect x="123" y="66" width="8" height="40" rx="4" fill="url(#gBlue)"/><circle cx="127" cy="64" r="15" fill="url(#gBlue)"/>
      <rect x="50" y="96" width="100" height="72" rx="30" fill="url(#gBody)" stroke="#4aa8ff" stroke-opacity=".55" stroke-width="1.5"/>
      <path d="M50 128V126A30 30 0 0 1 80 96H120A30 30 0 0 1 150 126V128Z" fill="url(#gBlue)"/>
      <circle cx="100" cy="150" r="7" fill="#4aa8ff" filter="url(#fGlow)"/><circle cx="100" cy="150" r="3" fill="#dff0ff"/></svg>` },
  { id:'halo', name:'Yonix Halo', sub:'Casque à réduction de bruit', cat:'Audio', price:149, badge:'Nouveau',
    desc:'Un casque enveloppant pour se couper du monde, avec une réduction de bruit active et un confort longue durée.',
    feat:['Réduction de bruit active','Jusqu\'à 40 h d\'écoute','Coussinets à mousse à mémoire de forme'],
    svg:`<svg viewBox="0 0 200 200"><ellipse cx="100" cy="176" rx="64" ry="9" fill="url(#gShadow)"/>
      <path d="M44 120C44 40 156 40 156 120" fill="none" stroke="url(#gBlue)" stroke-width="12" stroke-linecap="round"/>
      <rect x="30" y="102" width="38" height="66" rx="18" fill="url(#gBody)" stroke="#4aa8ff" stroke-opacity=".6" stroke-width="1.5"/>
      <rect x="37" y="111" width="24" height="48" rx="12" fill="url(#gBlue)" opacity=".9"/>
      <rect x="132" y="102" width="38" height="66" rx="18" fill="url(#gBody)" stroke="#4aa8ff" stroke-opacity=".6" stroke-width="1.5"/>
      <rect x="139" y="111" width="24" height="48" rx="12" fill="url(#gBlue)" opacity=".9"/>
      <ellipse cx="46" cy="122" rx="4" ry="10" fill="#fff" opacity=".35"/></svg>` },
  { id:'sphere', name:'Yonix Sphere', sub:'Enceinte Bluetooth 360°', cat:'Audio', price:89,
    desc:'Une enceinte sphérique qui diffuse le son dans toute la pièce, avec un anneau lumineux qui bat au rythme de la musique.',
    feat:['Son 360°','Anneau lumineux animé','Jusqu\'à 12 h d\'autonomie'],
    svg:`<svg viewBox="0 0 200 200"><ellipse cx="100" cy="176" rx="56" ry="8" fill="url(#gShadow)"/>
      <circle cx="100" cy="98" r="60" fill="url(#gSphere)"/>
      <circle cx="100" cy="98" r="44" fill="none" stroke="#9fd8ff" stroke-opacity=".28"/><circle cx="100" cy="98" r="28" fill="none" stroke="#9fd8ff" stroke-opacity=".28"/><circle cx="100" cy="98" r="12" fill="none" stroke="#9fd8ff" stroke-opacity=".3"/>
      <ellipse cx="100" cy="108" rx="60" ry="15" fill="none" stroke="#4aa8ff" stroke-width="5" filter="url(#fGlow)"/>
      <ellipse cx="100" cy="108" rx="60" ry="15" fill="none" stroke="#dff0ff" stroke-width="2"/>
      <ellipse cx="78" cy="62" rx="16" ry="9" fill="#fff" opacity=".4" transform="rotate(-30 78 62)"/></svg>` },
  { id:'orbit', name:'Yonix Orbit', sub:'Montre connectée', cat:'Montres', price:119, old:149, badge:'-20%',
    desc:'Une montre connectée fine et lumineuse : notifications, sport et sommeil, sur un écran net en toute lumière.',
    feat:['Écran lumineux always-on','Suivi sportif et sommeil','Étanche jusqu\'à 50 m'],
    svg:`<svg viewBox="0 0 200 200"><ellipse cx="100" cy="184" rx="52" ry="7" fill="url(#gShadow)"/>
      <rect x="72" y="8" width="56" height="60" rx="12" fill="url(#gBody)"/><rect x="72" y="132" width="56" height="60" rx="12" fill="url(#gBody)"/>
      <rect x="50" y="48" width="100" height="104" rx="30" fill="url(#gBody)" stroke="#4aa8ff" stroke-opacity=".65" stroke-width="2"/>
      <rect x="148" y="86" width="7" height="20" rx="3.5" fill="#4aa8ff"/>
      <rect x="59" y="57" width="82" height="86" rx="23" fill="#031233"/>
      <circle cx="100" cy="100" r="27" fill="none" stroke="#4aa8ff" stroke-width="7" stroke-dasharray="118 52" stroke-linecap="round" transform="rotate(-90 100 100)" filter="url(#fGlow)"/>
      <circle cx="100" cy="100" r="27" fill="none" stroke="url(#gBlue)" stroke-width="5" stroke-dasharray="118 52" stroke-linecap="round" transform="rotate(-90 100 100)"/>
      <text x="100" y="106" text-anchor="middle" font-size="16" font-weight="700" fill="#fff" font-family="Sora,sans-serif">10:09</text></svg>` },
  { id:'aura', name:'Yonix Aura', sub:'Lampe d\'ambiance connectée', cat:'Maison', price:49.9,
    desc:'Une lampe qui change de teinte à la demande pour créer l\'ambiance du moment, du bleu profond au blanc chaud.',
    feat:['16 millions de couleurs','Pilotage depuis le téléphone','Minuteur et mode veilleuse'],
    svg:`<svg viewBox="0 0 200 200"><path d="M66 96L134 96L166 176H34Z" fill="url(#gCone)"/>
      <ellipse cx="100" cy="176" rx="40" ry="8" fill="url(#gShadow)"/>
      <ellipse cx="100" cy="170" rx="32" ry="8" fill="url(#gBody)"/>
      <rect x="96" y="92" width="8" height="78" rx="4" fill="url(#gBody)"/>
      <ellipse cx="100" cy="98" rx="46" ry="14" fill="url(#gGlow)"/>
      <path d="M62 94L82 38H118L138 94Z" fill="url(#gBlue)"/><path d="M62 94L82 38H92L74 94Z" fill="#fff" opacity=".3"/></svg>` },
  { id:'volt', name:'Yonix Volt', sub:'Batterie externe 20 000 mAh', cat:'Accessoires', price:39.9,
    desc:'Une batterie compacte qui recharge ton téléphone plusieurs fois, avec témoin lumineux de niveau.',
    feat:['20 000 mAh','Charge rapide USB-C','Témoin lumineux de niveau'],
    svg:`<svg viewBox="0 0 200 200"><ellipse cx="100" cy="182" rx="46" ry="7" fill="url(#gShadow)"/>
      <rect x="58" y="24" width="84" height="150" rx="24" fill="url(#gBody)" stroke="#4aa8ff" stroke-opacity=".6" stroke-width="2"/>
      <rect x="76" y="44" width="48" height="6" rx="3" fill="#4aa8ff"/><rect x="76" y="56" width="48" height="6" rx="3" fill="#4aa8ff" opacity=".7"/><rect x="76" y="68" width="48" height="6" rx="3" fill="#4aa8ff" opacity=".4"/>
      <path d="M108 86L82 122H99L93 154L122 114H104Z" fill="#4aa8ff" filter="url(#fGlow)"/><path d="M108 86L82 122H99L93 154L122 114H104Z" fill="url(#gBlue)"/>
      <rect x="90" y="164" width="20" height="5" rx="2.5" fill="#031233"/></svg>` }
];

/* Partagé avec le serveur (api/checkout.js) : les prix vérifiés côté serveur viennent d'ici. */
if (typeof module !== 'undefined' && module.exports) module.exports = { CONFIG, PRODUCTS };
