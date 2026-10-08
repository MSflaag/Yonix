// api/notify.js — Discord bot DM to owner on every validated order
// Triggered by api/checkout.js after Stripe session creation
// Env vars required: DISCORD_BOT_TOKEN, DISCORD_OWNER_ID

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Open a DM channel with the owner and send a message
 */
async function sendOwnerDM(message) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const ownerId = process.env.DISCORD_OWNER_ID;

  if (!token || !ownerId) {
    console.error('[notify] Missing DISCORD_BOT_TOKEN or DISCORD_OWNER_ID');
    return { ok: false, error: 'Missing Discord env vars' };
  }

  // Step 1: Create or get existing DM channel with the owner
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: ownerId }),
  });

  if (!dmRes.ok) {
    const err = await dmRes.text();
    console.error('[notify] Failed to open DM channel:', err);
    return { ok: false, error: 'Cannot open DM channel' };
  }

  const dmChannel = await dmRes.json();

  // Step 2: Send the message
  const msgRes = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: message }),
  });

  if (!msgRes.ok) {
    const err = await msgRes.text();
    console.error('[notify] Failed to send DM:', err);
    return { ok: false, error: 'Cannot send DM message' };
  }

  return { ok: true };
}

/**
 * Build the notification message for an order
 */
function buildOrderMessage(data) {
  const {
    productName,
    tierName,
    priceRaw,
    sessionId,
    // Basic Fit client fields (optional)
    clientPrenom,
    clientNom,
    clientDOB,
    clientEmail,
  } = data;

  const ownerId = process.env.DISCORD_OWNER_ID;
  const ping = ownerId ? `<@${ownerId}>` : '@owner';

  const now = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  let msg = `${ping} 🛒 **COMMANDE FINALISÉE — YONIX**\n\n`;
  msg += `📦 **Produit :** ${productName}\n`;
  msg += `🏷️ **Formule :** ${tierName}\n`;
  msg += `💰 **Prix :** ${priceRaw}\n`;
  msg += `🕐 **Date :** ${now}\n`;

  if (sessionId) {
    msg += `🔗 **Session Stripe :** \`${sessionId}\`\n`;
  }

  // Basic Fit client data
  if (clientPrenom || clientNom || clientEmail || clientDOB) {
    msg += `\n👤 **Informations client (Basic Fit)**\n`;
    if (clientPrenom) msg += `  • Prénom : ${clientPrenom}\n`;
    if (clientNom)    msg += `  • Nom : ${clientNom}\n`;
    if (clientDOB)    msg += `  • Date de naissance : ${clientDOB}\n`;
    if (clientEmail)  msg += `  • Email : ${clientEmail}\n`;
    msg += `\n✅ Tu peux maintenant créer le compte Basic Fit.`;
  } else {
    msg += `\n✅ Envoie le produit au client via Discord/email.`;
  }

  return msg;
}

// Vercel serverless export
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const message = buildOrderMessage(req.body);
    const result = await sendOwnerDM(message);

    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// Also export helpers for internal use from checkout.js
export { sendOwnerDM, buildOrderMessage };
