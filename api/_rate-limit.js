import { createHash } from 'node:crypto';

import { authLimitConfig } from '../shared/auth-limits.js';
export { authLimitConfig };

// One atomic UPSERT coordinates limits across concurrent serverless instances.
export async function consumeAttempt(sql, identity, bucket, config = authLimitConfig()) {
  const key = createHash('sha256').update(`${bucket}:${identity}`).digest('hex');
  const [allowed] = await sql`
    INSERT INTO auth_attempts (key, attempts, window_started_at)
    VALUES (${key}, 1, NOW())
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_attempts.window_started_at <= NOW() - (${config.windowMs} * INTERVAL '1 millisecond') THEN 1 ELSE auth_attempts.attempts + 1 END,
      window_started_at = CASE WHEN auth_attempts.window_started_at <= NOW() - (${config.windowMs} * INTERVAL '1 millisecond') THEN NOW() ELSE auth_attempts.window_started_at END
    WHERE auth_attempts.window_started_at <= NOW() - (${config.windowMs} * INTERVAL '1 millisecond') OR auth_attempts.attempts < ${config.attempts}
    RETURNING attempts
  `;
  if (allowed) return { allowed: true };
  const [row] = await sql`SELECT window_started_at FROM auth_attempts WHERE key = ${key}`;
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((new Date(row.window_started_at).getTime() + config.windowMs - Date.now()) / 1000)) };
}

export async function limitAuth(sql, req, res, email, bucket) {
  const config = authLimitConfig();
  const result = await consumeAttempt(sql, email, bucket, config);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfter));
  res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(result.retryAfter / 60)} minute(s).`, retryAfter: result.retryAfter });
  return false;
}
