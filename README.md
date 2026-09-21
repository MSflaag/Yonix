# Yonix – boutique en ligne

Site statique (HTML, CSS, JS) avec un paiement sécurisé Stripe, prêt à déployer sur Vercel.

```
index.html            la page
assets/config.js      produits, prix, réglages  ← le fichier à modifier
assets/style.css      le design
assets/app.js         animations, panier
api/checkout.js       crée la page de paiement Stripe (côté serveur)
favicon.svg           l'icône de l'onglet
cgv.html, mentions-legales.html   modèles à compléter
```

## 1. Mettre le site en ligne (10 minutes)

1. Crée un compte gratuit sur **github.com**, puis un dépôt vide nommé `yonix`.
   Envoie-y tous les fichiers de ce dossier (bouton *Add file > Upload files*).
2. Crée un compte gratuit sur **vercel.com** (connexion avec GitHub).
3. Clique sur **Add New > Project**, choisis le dépôt `yonix`, puis **Deploy**.
   Ne change aucun réglage : Vercel détecte tout seul.

Ton site est en ligne sur une adresse `yonix-xxxx.vercel.app`.

*Alternative sans GitHub :* installe Node.js, ouvre un terminal dans ce dossier, puis lance
`npx vercel` et suis les questions.

## 2. Activer le paiement (Stripe)

1. Crée un compte sur **stripe.com**. Reste en **mode test** au début.
2. Dans Stripe : *Développeurs > Clés API*. Copie la **clé secrète** (`sk_test_…`).
3. Dans Vercel : *Settings > Environment Variables*, ajoute
   `STRIPE_SECRET_KEY` avec cette clé. Puis *Deployments > … > Redeploy*.
4. Teste une commande avec la carte `4242 4242 4242 4242`, une date future et un code au hasard.
5. Quand tout marche, active ton compte Stripe (informations légales et bancaires), remplace la
   clé par la clé **live** (`sk_live_…`) dans Vercel et redéploie.

Tu vois les commandes, les adresses de livraison et les paiements dans le tableau de bord Stripe.
Dans *Paramètres > E-mails clients*, active les reçus automatiques.

Les prix sont relus côté serveur dans `assets/config.js` : un visiteur ne peut pas les modifier.

## 3. Ajouter ton nom de domaine

Achète un domaine (chez OVH, Namecheap, Gandi…), puis dans Vercel :
*Settings > Domains > Add* et suis les instructions.

## 4. Personnaliser

- **Produits et prix** : `assets/config.js`. Un produit = un bloc avec `id`, `name`, `price`…
- **Vraies photos** : mets tes images dans `assets/products/` et ajoute
  `img: '/assets/products/mon-produit.jpg'` au produit (elles remplacent le dessin).
  Des photos carrées sur fond transparent (PNG/WebP) rendent mieux.
- **Livraison** : `freeShippingFrom` et `shippingCost` dans `config.js`,
  pays livrés dans `api/checkout.js` (liste `COUNTRIES`).
- **E-mail de contact** : `contactEmail` dans `config.js`.

## 5. Avant d'ouvrir au public

- Complète `mentions-legales.html` et `cgv.html` (les champs surlignés) et fais-les relire si besoin.
- Vérifie que les textes du site (délais, retours, garantie) correspondent à ce que tu offres vraiment.
- Selon ton statut (micro-entreprise, société…), renseigne la TVA, le SIRET et les informations de facturation dans Stripe.
- Tu gères toi-même le stock, l'expédition et le service client : ce site encaisse les paiements, il ne gère pas les stocks.

## Tester en local (facultatif)

```
npm install
npx vercel dev
```
Crée d'abord un fichier `.env.local` à partir de `.env.example`.
