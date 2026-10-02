import { db, ensureSchema } from './_db.js';
import { requireAuth, hashPassword, checkPassword } from './_auth.js';
import { logError } from './_log.js';

// The users.address JSONB column holds an array of addresses.
// Legacy rows may hold a single address object — normalize to an array on read.
function toAddressList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

export default async function handler(req, res) {
  try { return await profileHandler(req, res); }
  catch (error) { logError('profile_handler_error', error); return res.status(500).json({ error: 'Could not load or save your profile. Please try again.' }); }
}

async function profileHandler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const sql = db();
  await ensureSchema(sql);

  if (req.method === 'GET') {
    const [row] = await sql`SELECT email, name, address FROM users WHERE id = ${user.uid}`;
    if (!row) return res.status(404).json({ error: 'User not found' });
    return res.json({ email: row.email, name: row.name, addresses: toAddressList(row.address) });
  }

  if (req.method === 'PUT') {
    const { name, addresses } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    const list = Array.isArray(addresses) ? addresses.slice(0, 10) : [];
    await sql`
      UPDATE users SET name = ${String(name).trim()}, address = ${JSON.stringify(list)}
      WHERE id = ${user.uid}
    `;
    return res.json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const current_password = String(req.body?.current_password || '');
    const new_password = String(req.body?.new_password || '');
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const [row] = await sql`SELECT password_hash FROM users WHERE id = ${user.uid}`;
    if (!row || !checkPassword(current_password, row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await sql`UPDATE users SET password_hash = ${hashPassword(new_password)} WHERE id = ${user.uid}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
