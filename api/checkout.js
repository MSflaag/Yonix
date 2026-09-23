/**
 * Crée une session de paiement Stripe Checkout.
 * Les prix sont relus côté serveur depuis assets/config.js : le navigateur envoie
 * seulement des identifiants et des quantités, jamais de prix.
 */
const Stripe = require('stripe');
const { PRODUCTS, CONFIG } = require('../assets/config.js');

// Pays vers lesquels tu livres (codes ISO). Adapte cette liste.
const COUNTRIES = ['FR', 'BE', 'LU', 'CH', 'DE', 'ES', 'IT', 'NL', 'PT'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(503).json({ error: 'Paiement non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const raw = Array.isArray(body && body.items) ? body.items : [];

  // Regroupe par produit et valide chaque ligne
  const qtyById = new Map();
  for (const it of raw) {
    const p = PRODUCTS.find(x => x.id === it.id);
    const qty = Number(it.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      return res.status(400).json({ error: 'Panier invalide' });
    }
    qtyById.set(p.id, Math.min(20, (qtyById.get(p.id) || 0) + qty));
  }
  if (qtyById.size === 0) return res.status(400).json({ error: 'Panier vide' });

  let subtotal = 0;
  const line_items = [...qtyById].map(([id, quantity]) => {
    const p = PRODUCTS.find(x => x.id === id);
    const unit_amount = Math.round(p.price * 100);
    subtotal += unit_amount * quantity;
    return {
      quantity,
      price_data: { currency: 'eur', unit_amount, product_data: { name: p.name, description: p.sub } }
    };
  });

  const shipping = subtotal >= CONFIG.freeShippingFrom * 100 ? 0 : Math.round(CONFIG.shippingCost * 100);
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${req.headers.host}`;

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      line_items,
      shipping_address_collection: { allowed_countries: COUNTRIES },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: shipping, currency: 'eur' },
          display_name: shipping ? 'Livraison standard' : 'Livraison offerte',
          delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 4 } }
        }
      }],
      success_url: `${origin}/?commande=ok`,
      cancel_url: `${origin}/?commande=annulee`
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err && err.message);
    return res.status(500).json({ error: 'Impossible de créer le paiement' });
  }
};
