import { db, ensureSchema } from './_db.js';
import { requireAuth, requireAdmin } from './_auth.js';
import { log, logError } from './_log.js';

export default async function handler(req, res) {
  try {
    return await reviewsHandler(req, res);
  } catch (err) {
    logError('reviews_handler_error', err, { method: req.method });
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

async function reviewsHandler(req, res) {
  const sql = db();
  await ensureSchema(sql);

  if (req.method === 'GET') {
    // Public: approved reviews for a product, or featured reviews for the home page.
    if (req.query.productId) {
      const rows = await sql`
        SELECT id, user_name, rating, text, created_at FROM reviews
        WHERE product_id = ${req.query.productId} AND status = 'approved'
        ORDER BY created_at DESC
      `;
      return res.json(rows);
    }
    if (req.query.scope === 'featured') {
      const rows = await sql`
        SELECT r.id, r.user_name, r.rating, r.text, r.product_id, p.name AS product_name FROM reviews r
        JOIN products p ON p.id = r.product_id
        WHERE r.status = 'approved' AND r.featured = TRUE
        ORDER BY r.created_at DESC LIMIT 6
      `;
      return res.json(rows);
    }
    if (req.query.scope === 'admin') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!user.admin) return res.status(403).json({ error: 'Admin only' });
      const status = req.query.status;
      const rows = status
        ? await sql`
            SELECT r.*, p.name AS product_name, p.thumb_url AS product_image FROM reviews r
            JOIN products p ON p.id = r.product_id
            WHERE r.status = ${status} ORDER BY r.created_at DESC`
        : await sql`
            SELECT r.*, p.name AS product_name, p.thumb_url AS product_image FROM reviews r
            JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC`;
      return res.json(rows);
    }
    return res.status(400).json({ error: 'productId or scope required' });
  }

  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.admin) return res.status(403).json({ error: 'The admin cannot review products' });
    const { productId, rating, text } = req.body || {};
    const stars = parseInt(rating, 10);
    if (!productId || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Product and a 1–5 star rating are required' });
    }
    const [product] = await sql`SELECT id FROM products WHERE id = ${productId}`;
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await sql`
      INSERT INTO reviews (product_id, user_id, user_name, rating, text)
      VALUES (${productId}, ${user.uid}, ${user.name}, ${stars}, ${String(text || '').slice(0, 1000)})
    `;
    log('review_submitted', { productId, userId: user.uid, rating: stars });
    return res.status(201).json({ message: 'Review submitted — it will appear once approved' });
  }

  if (req.method === 'PUT') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id, status, featured } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Review id required' });
    if (status !== undefined && !['pending', 'approved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (status !== undefined) await sql`UPDATE reviews SET status = ${status} WHERE id = ${id}`;
    if (featured !== undefined) await sql`UPDATE reviews SET featured = ${!!featured} WHERE id = ${id}`;
    log('review_moderated', { reviewId: id, status, featured, by: admin.email });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Review id required' });
    await sql`DELETE FROM reviews WHERE id = ${id}`;
    log('review_deleted', { reviewId: id, by: admin.email });
    return res.json({ ok: true });
  }

  res.status(405).end();
}
