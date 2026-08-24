// Dynamic sitemap — /sitemap.xml
// Lists the static routes plus every in-stock product page so search engines can
// index the full catalog without a rebuild when products change.
import { db, ensureSchema } from './_db.js';
import { logError } from './_log.js';

const SITE = process.env.SITE_URL || 'https://moment-kart.vercel.app';

const STATIC_ROUTES = ['/', '/shop', '/auth'];

function urlEntry(path, changefreq, priority) {
  return `  <url><loc>${SITE}/#${path}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export default async function handler(req, res) {
  try {
    const sql = db();
    await ensureSchema(sql);
    const products = await sql`
      SELECT id FROM products WHERE in_stock = TRUE ORDER BY sort_order ASC NULLS LAST, created_at DESC
    `;
    const urls = [
      ...STATIC_ROUTES.map((p) => urlEntry(p === '/' ? '/' : p, p === '/' ? 'weekly' : 'monthly', p === '/' ? '1.0' : '0.8')),
      ...products.map((p) => urlEntry(`/product/${p.id}`, 'weekly', '0.7')),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(xml);
  } catch (err) {
    logError('sitemap_error', err);
    return res.status(500).json({ error: 'Could not generate sitemap' });
  }
}
