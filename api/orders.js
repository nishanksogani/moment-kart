import { db, ensureSchema } from './_db.js';
import { requireAuth, requireAdmin } from './_auth.js';
import { log, logError } from './_log.js';
import { sendShippedEmail } from './_email.js';
import { priceCart, signQuote, verifyQuote } from './_pricing.js';

export default async function handler(req, res) {
  try {
    return await ordersHandler(req, res);
  } catch (err) {
    logError('orders_handler_error', err, { method: req.method });
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayStr());
// Fulfilled and cancelled are terminal states: no further transitions happen on their own,
// so they're the only statuses an admin can delete or attach a closing note to.
const TERMINAL_STATUSES = ['fulfilled', 'cancelled'];

export async function ordersHandler(req, res, sqlOverride) {
  const sql = sqlOverride || db();
  if (!sqlOverride) await ensureSchema(sql);

  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (req.query.scope === 'admin') {
      if (!user.admin) return res.status(403).json({ error: 'Admin only' });
      const status = req.query.status;
      const rows = status
        ? await sql`
            SELECT o.*, u.email AS user_email, u.name AS user_name FROM orders o
            JOIN users u ON u.id = o.user_id
            WHERE o.status = ${status} ORDER BY o.created_at DESC`
        : await sql`
            SELECT o.*, u.email AS user_email, u.name AS user_name FROM orders o
            JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`;
      return res.json(rows);
    }
    const rows = await sql`SELECT * FROM orders WHERE user_id = ${user.uid} ORDER BY created_at DESC`;
    return res.json(rows);
  }

  if (req.method === 'DELETE') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!user.admin) return res.status(403).json({ error: 'Admin only' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No order ids given' });
    // Only terminal-state orders may be deleted — active orders must run their course.
    const deleted = await sql`DELETE FROM orders WHERE id = ANY(${ids}::bigint[]) AND status = ANY(${TERMINAL_STATUSES}::text[]) RETURNING id`;
    log('orders_deleted', { count: deleted.length, requested: ids.length, by: user.email });
    return res.json({ deleted: deleted.length, skipped: ids.length - deleted.length });
  }

  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    if (req.body?.action === 'quote') {
      const upiId = (process.env.ADMIN_UPI_ID || '').trim();
      if (!upiId) return res.status(503).json({ error: 'Payments are temporarily unavailable. Please contact the shop.' });
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) return res.status(400).json({ error: 'Cart must contain between 1 and 50 items' });
      const ids = items.map(i => String(i?.productId || ''));
      if (ids.some(id => !/^\d+$/.test(id))) return res.status(400).json({ error: 'Invalid product in cart' });
      const products = await sql`SELECT id, name, price_paise, in_stock, customizable, dimensions FROM products WHERE id = ANY(${ids}::bigint[])`;
      try {
        res.setHeader('Cache-Control', 'no-store');
        return res.json(signQuote(priceCart(items, products), user.uid, upiId));
      } catch (error) { return res.status(400).json({ error: error.message }); }
    }

    const { address, upi_ref, transaction_date, quote_token } = req.body || {};
    const quote = verifyQuote(quote_token, user.uid);
    if (!quote) return res.status(409).json({ error: 'Your payment quote has expired or is invalid. Refresh prices before paying. If you already paid, contact support with your UTR.' });
    if (!address?.line1 || !address?.city || !address?.pincode) {
      return res.status(400).json({ error: 'Shipping address is incomplete' });
    }
    if (!upi_ref || String(upi_ref).trim().length < 6) {
      return res.status(400).json({ error: 'Valid UPI transaction reference is required' });
    }

    // Honour the signed, server-priced amount displayed in the payment QR.
    const total = quote.total_paise;
    const verifiedItems = quote.items;

    const [created] = await sql`
      INSERT INTO orders (user_id, items, address, total_paise, upi_ref, paid_at, checkout_key)
      VALUES (${user.uid}, ${JSON.stringify(verifiedItems)}, ${JSON.stringify(address)},
              ${total}, ${String(upi_ref).trim()}, ${validDate(transaction_date)}, ${quote.checkout_key})
      ON CONFLICT (checkout_key) DO UPDATE SET checkout_key = EXCLUDED.checkout_key
      RETURNING id, order_no
    `;
    const id = created.id;

    // A profile failure must not turn a successfully persisted payment/order into a retry.
    try {
    const [row] = await sql`SELECT address FROM users WHERE id = ${user.uid}`;
    const saved = Array.isArray(row?.address) ? row.address : row?.address ? [row.address] : [];
    const key = (a) => `${a.line1}|${a.pincode}`.toLowerCase();
    if (!saved.some((a) => key(a) === key(address)) && saved.length < 10) {
      saved.push(address);
      await sql`UPDATE users SET address = ${JSON.stringify(saved)} WHERE id = ${user.uid}`;
    }
    } catch (error) { logError('order_address_save_failed', error, { orderId: id }); }

    log('order_placed', { orderId: id, orderNo: Number(created.order_no), userId: user.uid, totalPaise: total, itemCount: verifiedItems.length });
    return res.status(201).json({ id, order_no: Number(created.order_no), total_paise: total });
  }

  if (req.method === 'PUT') {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id, status, courier, tracking_id, upi_ref, transaction_date, note } = req.body || {};

    // Customer path: resubmit payment on their own flagged order.
    if (upi_ref !== undefined && !status) {
      if (!id || String(upi_ref).trim().length < 6) {
        return res.status(400).json({ error: 'Valid UPI transaction reference is required' });
      }
      const [order] = await sql`SELECT user_id, status FROM orders WHERE id = ${id}`;
      if (!order || order.user_id !== user.uid) return res.status(404).json({ error: 'Order not found' });
      if (order.status !== 'payment_issue') {
        return res.status(400).json({ error: 'This order is not awaiting payment confirmation' });
      }
      await sql`
        UPDATE orders SET upi_ref = ${String(upi_ref).trim()}, status = 'pending', paid_at = ${validDate(transaction_date)}
        WHERE id = ${id}
      `;
      log('payment_resubmitted', { orderId: id, userId: user.uid });
      return res.json({ ok: true });
    }

    // Admin path: status transitions.
    if (!user.admin) return res.status(403).json({ error: 'Admin only' });
    if (!id || !['pending', 'payment_issue', 'shipped', 'fulfilled', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Order id and a valid status are required' });
    }
    if (status === 'shipped' && (!courier || !String(tracking_id || '').trim())) {
      return res.status(400).json({ error: 'Courier name and tracking ID are required to mark shipped' });
    }
    if (status === 'shipped') {
      await sql`
        UPDATE orders SET status = 'shipped',
          courier = ${String(courier).trim()}, tracking_id = ${String(tracking_id).trim()}, shipped_at = ${validDate(req.body?.shipped_date)}
        WHERE id = ${id}
      `;
      // Notify the customer. Email failure must not fail the status change.
      try {
        const [row] = await sql`
          SELECT o.order_no, o.items, o.address, o.courier, o.tracking_id, u.email, u.name
          FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ${id}
        `;
        if (row) {
          // Order items only store productId — look up current images for the email.
          // Cropped thumbnail only (never the full original) — keeps the email light.
          const productIds = (row.items || []).map((i) => i.productId).filter(Boolean);
          const products = productIds.length
            ? await sql`SELECT id, thumb_url AS image_url FROM products WHERE id = ANY(${productIds}::bigint[])`
            : [];
          const imageById = Object.fromEntries(products.map((p) => [p.id, p.image_url]));
          const items = (row.items || []).map((i) => ({ ...i, image_url: imageById[i.productId] || '' }));

          await sendShippedEmail(row.email, {
            order_no: row.order_no,
            name: row.name,
            items,
            courier: row.courier,
            tracking_id: row.tracking_id,
            address: row.address,
          });
          log('shipped_email_sent', { orderId: id, to: row.email });
        }
      } catch (err) {
        logError('shipped_email_failed', err, { orderId: id });
      }
    } else if (TERMINAL_STATUSES.includes(status)) {
      // Closing note is optional and only tracked for the states an order won't move past on its own.
      await sql`UPDATE orders SET status = ${status}, status_note = ${note ? String(note).trim().slice(0, 500) : null} WHERE id = ${id}`;
    } else {
      await sql`UPDATE orders SET status = ${status} WHERE id = ${id}`;
    }
    log('order_status_changed', { orderId: id, status, by: user.email });
    return res.json({ ok: true });
  }

  res.status(405).end();
}
