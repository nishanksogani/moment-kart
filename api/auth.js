import { randomInt } from 'crypto';
import { db, ensureSchema } from './_db.js';
import { hashPassword, checkPassword, createToken, isAdminEmail, isBuiltInAdmin } from './_auth.js';
import { sendVerificationEmail } from './_email.js';
import { log, logError } from './_log.js';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Verification codes are never returned to the client — they're emailed.
async function issueCode(sql, email) {
  const isProd = process.env.VERCEL_ENV === 'production';
  if (isProd && !(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    const err = new Error('Email service is not configured — signup is unavailable');
    err.statusCode = 503;
    throw err;
  }

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await sql`
    INSERT INTO verification_codes (email, code, expires_at)
    VALUES (${email}, ${code}, ${expiresAt})
    ON CONFLICT (email) DO UPDATE SET code = ${code}, expires_at = ${expiresAt}
  `;
  // Always log the code so it can be recovered from the function logs
  // (Vercel → Deployments → Logs) if the email doesn't arrive.
  const { sent } = await sendVerificationEmail(email, code);
  log('verification_code_issued', { email, code, emailed: sent });
}

export default async function handler(req, res) {
  try {
    return await authHandler(req, res);
  } catch (err) {
    logError('auth_handler_error', err, { action: req.body?.action });
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Something went wrong' });
  }
}

async function authHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const sql = db();
  await ensureSchema(sql);

  const { action } = req.body || {};
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

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
    const [row] = await sql`SELECT code, expires_at FROM verification_codes WHERE email = ${email}`;
    if (!row || row.code !== code) {
      log('verify_failed', { email, reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      log('verify_failed', { email, reason: 'expired' });
      return res.status(400).json({ error: 'Code expired — request a new one' });
    }
    await sql`UPDATE users SET verified = TRUE, last_login = NOW() WHERE email = ${email}`;
    await sql`DELETE FROM verification_codes WHERE email = ${email}`;
    const [user] = await sql`SELECT id, email, name FROM users WHERE email = ${email}`;
    log('verify_success', { email });
    return res.json({ token: createToken(user), admin: isAdminEmail(email) });
  }

  if (action === 'forgot') {
    const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
    log('forgot_password_requested', { email, accountExists: !!user });
    // Same response either way, so the API can't be used to probe which emails exist.
    if (!user) return res.json({ message: 'If an account exists, a reset code has been sent' });
    await issueCode(sql, email);
    return res.json({ message: 'If an account exists, a reset code has been sent' });
  }

  if (action === 'reset') {
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const [row] = await sql`SELECT code, expires_at FROM verification_codes WHERE email = ${email}`;
    if (!row || row.code !== code) {
      log('reset_failed', { email, reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid reset code' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      log('reset_failed', { email, reason: 'expired' });
      return res.status(400).json({ error: 'Code expired — request a new one' });
    }
    await sql`UPDATE users SET password_hash = ${hashPassword(password)}, verified = TRUE, last_login = NOW() WHERE email = ${email}`;
    await sql`DELETE FROM verification_codes WHERE email = ${email}`;
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
