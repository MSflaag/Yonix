const Stripe = require('stripe');

// Helper : lit et parse le body JSON brut (Vercel ne le fait pas automatiquement)
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      // Déjà parsé (environnement local / Express)
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Corps de requête invalide', details: e.message });
  }

  const { productName, tierName, priceRaw } = body;

  if (!productName || !tierName || !priceRaw) {
    return res.status(400).json({
      error: 'Paramètres manquants',
      received: { productName, tierName, priceRaw }
    });
  }

  // Convertit "24,99€" ou "24.99€" → 2499 centimes
  const cleaned = priceRaw.replace(/[^\d,.]/g, '').replace(',', '.');
  const amount  = Math.round(parseFloat(cleaned) * 100);

  if (!amount || isNaN(amount) || amount < 50) {
    return res.status(400).json({ error: 'Montant invalide', priceRaw, cleaned, amount });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY manquant dans les variables Vercel' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

  const origin = process.env.SITE_URL
    || (req.headers.origin || `https://${req.headers.host}`);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      locale: 'fr',
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amount,
          product_data: {
            name: `${productName} — ${tierName}`,
            description: 'Yonix Software · Livraison clé par Discord après paiement'
          }
        },
        quantity: 1
      }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/#boutique`,
      metadata:    { productName, tierName }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur Stripe', details: err.message });
  }
};
