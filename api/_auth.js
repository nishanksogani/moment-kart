import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'crypto';

// Set AUTH_SECRET env var in Vercel for production security.
export function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'development' && !process.env.VERCEL_ENV) return 'moment-kart-dev-secret-change-me';
  throw new Error('AUTH_SECRET must be configured');
}
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// The site has a single admin, defined by ADMIN_EMAIL + ADMIN_PASSWORD env vars.
export function isAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return !!adminEmail && String(email).toLowerCase() === adminEmail;
}

// The admin needs no signup or email verification — logging in with these
// credentials is what defines the account.
export function isBuiltInAdmin(email, password) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) return false;
  return String(email).toLowerCase() === adminEmail && password === adminPass;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createToken(user, ttlMs = TOKEN_TTL_MS) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: user.id,
      email: user.email,
      name: user.name,
      admin: isAdminEmail(user.email),
      exp: Date.now() + ttlMs,
    })
  ).toString('base64url');
  const sig = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// Returns the token payload ({ uid, email, name, admin }) or null after sending a 401.
export function requireAuth(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

export function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!user.admin) {
    res.status(403).json({ error: 'Admin only' });
    return null;
  }
  return user;
}
