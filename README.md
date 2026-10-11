# Yonix — Deploy v3

## Structure

```
├── api/
│   ├── checkout.js   — Stripe Checkout Session + Discord notify
│   ├── session.js    — Retrieve session status/metadata
│   └── notify.js     — Discord bot DM to owner on every order
├── public/
│   ├── index.html    — Main shop (single file, ~478KB)
│   ├── success.html  — Post-payment page (downloads / service info)
│   └── files/        — Put your jailbreak .zip files here
├── vercel.json
├── package.json
└── .env.example
```

## Setup

### 1. Vercel Environment Variables

In your Vercel project dashboard → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `SITE_URL` | `https://your-project.vercel.app` |
| `DISCORD_BOT_TOKEN` | Your bot token (see below) |
| `DISCORD_OWNER_ID` | Your Discord user ID |

### 2. Discord Bot Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a New Application → go to **Bot** tab
3. Click **Reset Token** → copy it → set as `DISCORD_BOT_TOKEN`
4. Under **Privileged Gateway Intents**, you don't need any for DMs
5. The bot does NOT need to be in your server — it sends DMs directly
6. Get your **own Discord user ID**: Settings → Advanced → Developer Mode ON → right-click your username → **Copy User ID** → set as `DISCORD_OWNER_ID`

### 3. Upload Jailbreak Files

Drop your 11 `.zip` files into `public/files/`. File names must match the product `file` field in index.html.

### 4. Deploy

```bash
npx vercel --prod
```

## How Notifications Work

Every completed Stripe payment triggers `api/notify.js` which:
1. Opens a DM channel with the owner (via Discord REST API)
2. Sends a formatted message with product name, tier, price, timestamp
3. For Basic Fit orders: includes prénom, nom, date de naissance, email
4. Pings the owner with `<@DISCORD_OWNER_ID>`

The notify call is fire-and-forget — it never blocks the Stripe redirect.
