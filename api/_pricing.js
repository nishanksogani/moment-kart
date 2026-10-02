import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { authSecret } from './_auth.js';

export { priceCart } from '../shared/pricing.js';

const signature = payload => createHmac('sha256', authSecret()).update(`checkout-quote:${payload}`).digest();
export function signQuote(priced, uid, upiId) {
  const quote = { ...priced, uid: String(uid), upi_id: upiId, checkout_key: randomUUID(), expires_at: Date.now() + 30 * 60_000 };
  const payload = Buffer.from(JSON.stringify(quote)).toString('base64url');
  return { ...quote, quote_token: `${payload}.${signature(payload).toString('base64url')}` };
}

export function verifyQuote(token, uid, now = Date.now()) {
  try {
    const [payload, sig, extra] = String(token).split('.');
    if (!payload || !sig || extra) return null;
    const candidate = Buffer.from(sig, 'base64url');
    const expected = signature(payload);
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;
    const quote = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return quote.uid === String(uid) && quote.expires_at > now ? quote : null;
  } catch { return null; }
}
