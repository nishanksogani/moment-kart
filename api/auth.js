import { randomInt, createHmac } from 'crypto';
import { db, ensureSchema } from './_db.js';
import { hashPassword, checkPassword, createToken, isAdminEmail, isBuiltInAdmin, authSecret } from './_auth.js';
import { limitAuth } from './_rate-limit.js';
import { sendVerificationEmail } from './_email.js';
import { log, logError } from './_log.js';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Verification codes are never returned to the client — they're emailed.
const codeHash = (email, purpose, code) => createHmac('sha256', authSecret()).update(`${email}:${purpose}:${code}`).digest('hex');

async function issueCode(sql, email, purpose = 'verify') {
  const isProd = process.env.VERCEL_ENV === 'production';
  if (isProd && !(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    const err = new Error('Email service is not configured — signup is unavailable');
    err.statusCode = 503;
    throw err;
  }

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await sql`
    INSERT INTO verification_codes (email, code, expires_at, purpose)
    VALUES (${email}, ${codeHash(email, purpose, code)}, ${expiresAt}, ${purpose})
    ON CONFLICT (email) DO UPDATE SET code = ${codeHash(email, purpose, code)}, expires_at = ${expiresAt}, purpose = ${purpose}
  `;
  const { sent } = await sendVerificationEmail(email, code);
  log('verification_code_issued', { email, purpose, emailed: sent });
}

export default async function handler(req, res) {
  try {
    return await authHandler(req, res);
  } catch (err) {
    logError('auth_handler_error', err, { action: req.body?.action });
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Something went wrong' });
  }
}

export async function authHandler(req, res, sqlOverride) {
  if (req.method !== 'POST') return res.status(405).end();
  const sql = sqlOverride || db();
  if (!sqlOverride) await ensureSchema(sql);

  const { action } = req.body || {};
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (!['signup', 'resend', 'verify', 'forgot', 'reset', 'login'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
  const bucket = action === 'login' ? 'login' : ['verify', 'reset'].includes(action) ? 'otp-check' : 'otp-send';
  if (!await limitAuth(sql, req, res, email, bucket)) return;

  if (action === 'signup') {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const [existing] = await sql`SELECT verified FROM users WHERE email = ${email}`;
    if (existing?.verified) return res.status(409).json({ error: 'Account already exists — please login' });

    const passwordHash = hashPassword(password);
    if (existing) {
      await sql`UPDATE users SET name = ${name}, password_hash = ${passwordHash} WHERE email = ${email}`;
    } else {
      await sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name}, ${passwordHash})`;
    }
    await issueCode(sql, email);
    log('signup', { email });
    return res.json({ message: 'Verification code sent to your email' });
  }

  if (action === 'resend') {
    const [user] = await sql`SELECT verified FROM users WHERE email = ${email}`;
    if (!user) return res.status(404).json({ error: 'No account found — please signup' });
    if (user.verified) return res.status(400).json({ error: 'Account already verified — please login' });
    await issueCode(sql, email);
    log('resend_code', { email });
    return res.json({ message: 'Verification code resent' });
  }

  if (action === 'verify') {
    const code = String(req.body?.code || '').trim();
    const [row] = await sql`DELETE FROM verification_codes WHERE email = ${email} AND purpose = 'verify' AND code = ${codeHash(email, 'verify', code)} AND expires_at > NOW() RETURNING email`;
    if (!row) {
      log('verify_failed', { email, reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    await sql`UPDATE users SET verified = TRUE, last_login = NOW() WHERE email = ${email}`;
    const [user] = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
    log('verify_success', { email });
    return res.json({ token: createToken(user), admin: isAdminEmail(email) });
  }

  if (action === 'forgot') {
    const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
    log('forgot_password_requested', { email, accountExists: !!user });
    // Same response either way, so the API can't be used to probe which emails exist.
    if (!user) return res.json({ message: 'If an account exists, a reset code has been sent' });
    await issueCode(sql, email, 'reset');
    return res.json({ message: 'If an account exists, a reset code has been sent' });
  }

  if (action === 'reset') {
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const [row] = await sql`DELETE FROM verification_codes WHERE email = ${email} AND purpose = 'reset' AND code = ${codeHash(email, 'reset', code)} AND expires_at > NOW() RETURNING email`;
    if (!row) {
      log('reset_failed', { email, reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }
    await sql`UPDATE users SET password_hash = ${hashPassword(password)}, verified = TRUE, last_login = NOW() WHERE email = ${email}`;
    const [user] = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
    log('password_reset', { email });
    return res.json({ token: createToken(user), admin: isAdminEmail(email) });
  }

  if (action === 'login') {
    const password = String(req.body?.password || '');

    // Built-in admin (ADMIN_EMAIL/ADMIN_PASSWORD env vars): exists by default,
    // auto-provisioned in the users table on first login so orders/profile work.
    if (isBuiltInAdmin(email, password)) {
      let [admin] = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
      if (!admin) {
        const [created] = await sql`
          INSERT INTO users (email, name, password_hash, verified, last_login)
          VALUES (${email}, ${'Admin'}, ${hashPassword(password)}, TRUE, NOW())
          RETURNING id
        `;
        admin = { id: created.id, email, name: 'Admin' };
      } else {
        await sql`UPDATE users SET verified = TRUE, last_login = NOW() WHERE id = ${admin.id}`;
      }
      log('admin_login', { email });
      return res.json({ token: createToken(admin), admin: true });
    }

    const [user] = await sql`SELECT id, email, name, password_hash, verified FROM users WHERE email = ${email}`;
    if (!user || !checkPassword(password, user.password_hash)) {
      log('login_failed', { email, reason: !user ? 'no_account' : 'bad_password' });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.verified) {
      if (!await limitAuth(sql, req, res, email, 'otp-send')) return;
      await issueCode(sql, email);
      log('login_blocked_unverified', { email });
      return res.status(403).json({ error: 'Email not verified', needsVerification: true });
    }
    await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;
    log('login_success', { email });
    return res.json({ token: createToken(user), admin: isAdminEmail(email) });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
