import { db, ensureSchema } from './_db.js';
import { requireAdmin } from './_auth.js';
import { log, logError } from './_log.js';
import { sendMarketingEmail } from './_email.js';

export default async function handler(req, res) {
  try {
    return await marketingHandler(req, res);
  } catch (err) {
    logError('marketing_handler_error', err, { method: req.method });
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

async function marketingHandler(req, res) {
  const sql = db();
  await ensureSchema(sql);

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') return res.status(405).end();

  const userEmails = Array.isArray(req.body?.userEmails) ? req.body.userEmails : [];
  const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();

  if (userEmails.length === 0) return res.status(400).json({ error: 'Select at least one recipient' });
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    return res.status(503).json({ error: 'Email service is not configured — set GMAIL_USER/GMAIL_APP_PASSWORD' });
  }

  const users = await sql`SELECT email, name FROM users WHERE email = ANY(${userEmails})`;
  // Cropped thumbnail only (never the full original) — keeps the campaign email light.
  const products = productIds.length
    ? await sql`SELECT id, name, price_paise, thumb_url AS image_url FROM products WHERE id = ANY(${productIds}::bigint[])`
    : [];

  let sent = 0;
  let failed = 0;
  for (const user of users) {
    try {
      const { sent: didSend } = await sendMarketingEmail(user.email, {
        name: user.name,
        subject,
        message,
        products,
      });
      if (didSend) sent++;
    } catch (err) {
      failed++;
      logError('marketing_email_failed', err, { to: user.email });
    }
  }

  log('marketing_campaign_sent', { by: admin.email, recipients: users.length, sent, failed, products: products.length });
  return res.json({ sent, failed, total: users.length });
}
