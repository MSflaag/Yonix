# Yonix — Déploiement Vercel + Stripe

## Structure du projet

```
yonix/
├── public/
│   ├── index.html      ← Site principal
│   └── success.html    ← Page après paiement
├── api/
│   └── checkout.js     ← Serverless function Stripe
├── vercel.json
├── package.json
└── .env.example
```

---

## 1. Préparer Stripe 

1. Crée un compte sur **stripe.com**
2. Va dans **Développeurs → Clés API**
3. Copie ta **Clé secrète** (`sk_live_...` pour la prod, `sk_test_...` pour tester)

---

## 2. Déployer sur Vercel

### Option A — Interface web (recommandé)

1. Va sur **vercel.com** → "Add New Project"
2. Importe ton repo GitHub (push ce dossier sur GitHub d'abord)
   - Ou utilise **"Deploy from CLI"** ci-dessous
3. Dans les paramètres du projet → **Environment Variables** :
   ```
   STRIPE_SECRET_KEY = sk_live_XXXXXXXXX
   SITE_URL          = https://ton-domaine.vercel.app
   ```
4. Clique **Deploy** — c'est en ligne.

### Option B — CLI

```bash
# Installe Vercel CLI
npm i -g vercel

# Dans le dossier du projet
cd yonix
npm install
vercel

# Ajoute les variables d'env
vercel env add STRIPE_SECRET_KEY
vercel env add SITE_URL

# Redéploie avec les vars
vercel --prod
```

---

## 3. Domaine personnalisé (optionnel)

Dans le dashboard Vercel → ton projet → **Domains** → ajoute ton domaine.

---

## 4. Tester avant de mettre en prod

Utilise `sk_test_...` comme clé Stripe.  
Carte de test : `4242 4242 4242 4242` · date future · CVC `123`

Quand tout fonctionne → remplace par `sk_live_...` dans les env vars Vercel.
