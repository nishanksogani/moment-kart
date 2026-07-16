import { db, ensureSchema } from './_db.js';
import { requireAdmin } from './_auth.js';
import { log, logError } from './_log.js';

export default async function handler(req, res) {
  try {
    return await productsHandler(req, res);
  } catch (err) {
    logError('products_handler_error', err, { method: req.method });
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

// Event tags ("birthday", "rakhi", …) — lowercase, deduped, max 12 per product.
const normalizeTags = (tags) =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12)
    : [];

// Up to 3 photos; the first is the cover shown on cards. Each photo is stored as
// { thumb, full } — thumb is a fixed-size crop (fast-loading cards/lists), full is
// the whole original (product page/lightbox). Legacy products saved before crop
// support have a plain string per photo; normalized to the same { thumb, full } shape,
// with `image_url` as a last-resort single-photo fallback for older rows still.
const normalizeImages = (p) => {
  const raw = Array.isArray(p.images) ? p.images.slice(0, 3) : [];
  const images = raw
    .map((img) => {
      if (typeof img === 'string') return img ? { thumb: img, full: img } : null;
      if (img && typeof img === 'object') {
        const thumb = img.thumb || img.full;
        const full = img.full || img.thumb;
        return thumb ? { thumb, full } : null;
      }
      return null;
    })
    .filter(Boolean);
  if (images.length > 0) return images;
  return p.image_url ? [{ thumb: p.image_url, full: p.image_url }] : [];
};

// Optional size/variant options, e.g. "8x10" vs "12x16" at different prices.
// Up to 10 per product; blank labels dropped, duplicate labels deduped (last wins).
const MAX_DIMENSIONS = 10;
const normalizeDimensions = (p) => {
  if (!Array.isArray(p.dimensions)) return [];
  const byLabel = new Map();
  for (const d of p.dimensions) {
    const label = String(d?.label || '').trim();
    const price = Number(d?.price_paise);
    if (!label || !Number.isInteger(price) || price <= 0) continue;
    byLabel.set(label, { label, price_paise: price });
  }
  return [...byLabel.values()].slice(0, MAX_DIMENSIONS);
};

async function productsHandler(req, res) {
  const sql = db();
  await ensureSchema(sql);

  if (req.method === 'GET') {
    // Public: the shop needs the catalog without login.
    const rows = await sql`
      SELECT id, name, description, price_paise, image_url, images, customizable, custom_label, in_stock, tags, featured, dimensions, created_at, thumb_url
      FROM products ORDER BY sort_order ASC NULLS LAST, created_at DESC
    `;
    return res.json(rows.map((r) => ({ ...r, images: normalizeImages(r) })));
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'POST') {
    const p = req.body || {};
    if (!p.name || !Number.isInteger(p.price_paise) || p.price_paise <= 0) {
      return res.status(400).json({ error: 'Name and a positive price are required' });
    }
    const images = normalizeImages(p);
    const dimensions = normalizeDimensions(p);
    const pricePaise = dimensions.length > 0 ? Math.min(...dimensions.map((d) => d.price_paise)) : p.price_paise;
    const [created] = await sql`
      INSERT INTO products (name, description, price_paise, image_url, images, customizable, custom_label, in_stock, tags, featured, dimensions, sort_order, thumb_url)
      VALUES (${p.name}, ${p.description || ''}, ${pricePaise}, ${images[0]?.thumb || ''}, ${JSON.stringify(images)},
              ${!!p.customizable}, ${p.custom_label || 'Your message'}, ${p.in_stock !== false},
              ${JSON.stringify(normalizeTags(p.tags))}, ${!!p.featured}, ${JSON.stringify(dimensions)},
              (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products), ${p.thumb_url || ''})
      RETURNING id
    `;
    log('product_created', { productId: created.id, name: p.name, by: admin.email });
    return res.status(201).json({ id: created.id });
  }

  if (req.method === 'PUT') {
    const p = req.body || {};
    if (!p.id) return res.status(400).json({ error: 'Product id required' });
    if (!p.name || !Number.isInteger(p.price_paise) || p.price_paise <= 0) {
      return res.status(400).json({ error: 'Name and a positive price are required' });
    }
    const images = normalizeImages(p);
    const dimensions = normalizeDimensions(p);
    const pricePaise = dimensions.length > 0 ? Math.min(...dimensions.map((d) => d.price_paise)) : p.price_paise;
    await sql`
      UPDATE products SET
        name = ${p.name}, description = ${p.description || ''}, price_paise = ${pricePaise},
        image_url = ${images[0]?.thumb || ''}, images = ${JSON.stringify(images)}, customizable = ${!!p.customizable},
        custom_label = ${p.custom_label || 'Your message'}, in_stock = ${p.in_stock !== false},
        tags = ${JSON.stringify(normalizeTags(p.tags))}, featured = ${!!p.featured}, dimensions = ${JSON.stringify(dimensions)},
        thumb_url = ${p.thumb_url || ''}
      WHERE id = ${p.id}
    `;
    log('product_updated', { productId: p.id, name: p.name, inStock: p.in_stock !== false, by: admin.email });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Product id required' });
    await sql`DELETE FROM products WHERE id = ${id}`;
    log('product_deleted', { productId: id, by: admin.email });
    return res.json({ ok: true });
  }

  // Re-rank the shop grid: body.order is the full list of product ids in the
  // desired display order (top to bottom).
  if (req.method === 'PATCH') {
    const ids = Array.isArray(req.body?.order) ? req.body.order.map(String).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Product order required' });
    await sql`
      UPDATE products SET sort_order = t.rn
      FROM unnest(${ids}::bigint[]) WITH ORDINALITY AS t(id, rn)
      WHERE products.id = t.id
    `;
    log('products_reordered', { count: ids.length, by: admin.email });
    return res.json({ ok: true });
  }

  res.status(405).end();
}
