const Stripe = require('stripe');

// Prix correspondant à chaque tier par produit
// Remplace les price IDs si tu veux utiliser des Prix Stripe pré-créés
// Sinon, on crée le prix dynamiquement via priceRaw

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productName, tierName, priceRaw } = req.body || {};
  if (!productName || !tierName || !priceRaw) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  // Convertit "24,99€" → 2499 centimes
  const amount = Math.round(
    parseFloat(priceRaw.replace(/[^\d,]/g, '').replace(',', '.')) * 100
  );
  if (!amount || amount < 50) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

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
      success_url: `${process.env.SITE_URL || req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL || req.headers.origin}/#boutique`,
      metadata: { productName, tierName }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Erreur Stripe', details: err.message });
  }
};
