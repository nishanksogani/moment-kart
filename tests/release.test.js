import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authLimitConfig, consumeAttempt } from '../api/_rate-limit.js';
import { priceCart, signQuote, verifyQuote } from '../api/_pricing.js';
import { createToken, authSecret } from '../api/_auth.js';
import { authHandler } from '../api/auth.js';
import { ordersHandler } from '../api/orders.js';
import { productsHandler } from '../api/products.js';
import { currentRoute, interceptLink } from '../src/routing.js';

process.env.AUTH_SECRET = 'test-only-secret-not-for-deployment';
const product = { id: '1', name: 'Keepsake', price_paise: 25000, in_stock: true, customizable: true, dimensions: [] };
const user = { id: '7', email: 'customer@example.test', name: 'Customer' };
const authorization = `Bearer ${createToken(user)}`;
const response = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, end() { return this; } });

// SQL adapter exercises handler boundaries. Real Postgres concurrency/migrations
// must also be exercised in staging before deployment.
function limitDatabase(now = () => Date.now()) {
  const rows = new Map();
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('INSERT INTO auth_attempts')) {
      assert.match(query, /ON CONFLICT/);
      assert.match(query, /WHERE.*window_started_at/s);
      const [key, windowMs, , , max] = values;
      const row = rows.get(key) || { attempts: 0, window_started_at: now() };
      if (row.window_started_at <= now() - windowMs) { row.attempts = 0; row.window_started_at = now(); }
      if (row.attempts >= max) return [];
      row.attempts++; rows.set(key, row);
      return [{ attempts: row.attempts }];
    }
    if (query.includes('SELECT window_started_at')) return [rows.get(values[0])];
    return [];
  };
  return sql;
}

test('authentication limits default to 3 attempts in 10 minutes and accept valid overrides', () => {
  assert.deepEqual(authLimitConfig({}), { attempts: 3, windowMs: 600000 });
  assert.deepEqual(authLimitConfig({ AUTH_MAX_ATTEMPTS: '5', AUTH_WINDOW_MINUTES: '2' }), { attempts: 5, windowMs: 120000 });
  assert.deepEqual(authLimitConfig({ AUTH_MAX_ATTEMPTS: '0', AUTH_WINDOW_MINUTES: 'NaN' }), { attempts: 3, windowMs: 600000 });
});

test('only 3 attempts are admitted, buckets are independent, window resets at its boundary', async () => {
  let now = Date.now(); const sql = limitDatabase(() => now);
  const config = authLimitConfig({});
  const results = await Promise.all(Array.from({ length: 4 }, () => consumeAttempt(sql, 'customer@example.test', 'login', config)));
  assert.deepEqual(results.map(result => result.allowed), [true, true, true, false]);
  assert.ok(results[3].retryAfter > 0);
  assert.equal((await consumeAttempt(sql, 'customer@example.test', 'otp-check', config)).allowed, true);
  now += 600000;
  assert.equal((await consumeAttempt(sql, 'customer@example.test', 'login', config)).allowed, true);
});

test('login endpoint refuses attempt four with HTTP 429 and Retry-After', async () => {
  const sql = limitDatabase();
  for (let n = 0; n < 4; n++) {
    const res = response();
    await authHandler({ method: 'POST', body: { action: 'login', email: 'nobody@example.test', password: 'incorrect' } }, res, sql);
    assert.equal(res.code, n < 3 ? 401 : 429);
    if (n === 3) assert.ok(Number(res.headers['Retry-After']) > 0);
  }
});

test('OTP verification and reset share their attempt bucket; resending does not replenish it', async () => {
  const sql = limitDatabase();
  for (const action of ['verify', 'reset', 'verify', 'resend', 'reset']) {
    const res = response();
    await authHandler({ method: 'POST', body: { action, email: 'otp@example.test', code: '000000', password: 'new-password' } }, res, sql);
    assert.equal(res.code, action === 'resend' ? 404 : action === 'reset' && res.body.retryAfter ? 429 : 400);
  }
});

test('verification codes are purpose-bound and consumed only once', async () => {
  const limited = limitDatabase();
  let available = true;
  const hash = createHmac('sha256', process.env.AUTH_SECRET).update('verify@example.test:verify:123456').digest('hex');
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('auth_attempts')) return limited(strings, ...values);
    if (query.includes('DELETE FROM verification_codes')) {
      if (available && query.includes("purpose = 'verify'") && values[1] === hash) { available = false; return [{ email: values[0] }]; }
      return [];
    }
    if (query.includes('SELECT id, email, name')) return [{ ...user, email: 'verify@example.test' }];
    return [];
  };
  const wrongPurpose = response();
  await authHandler({ method: 'POST', body: { action: 'reset', email: 'verify@example.test', code: '123456', password: 'new-password' } }, wrongPurpose, sql);
  assert.equal(wrongPurpose.code, 400); assert.equal(available, true);
  const first = response(), repeat = response();
  await authHandler({ method: 'POST', body: { action: 'verify', email: 'verify@example.test', code: '123456' } }, first, sql);
  await authHandler({ method: 'POST', body: { action: 'verify', email: 'verify@example.test', code: '123456' } }, repeat, sql);
  assert.ok(first.body.token); assert.equal(repeat.code, 400);
});

test('OTP requests share a sending limit across forgot and resend', async () => {
  const sql = limitDatabase();
  for (let n = 0; n < 3; n++) {
    const res = response();
    await authHandler({ method: 'POST', body: { action: 'forgot', email: 'send@example.test' } }, res, sql);
    assert.equal(res.code, 200);
  }
  const blocked = response();
  await authHandler({ method: 'POST', body: { action: 'resend', email: 'send@example.test' } }, blocked, sql);
  assert.equal(blocked.code, 429);
});

test('current catalog prices override cached/client prices', () => {
  const priced = priceCart([{ productId: '1', qty: 2, price_paise: 1, message: 'A name' }], [product]);
  assert.equal(priced.total_paise, 50000); assert.equal(priced.items[0].price_paise, 25000);
});

test('variant pricing and stock are validated', () => {
  const variant = { ...product, dimensions: [{ label: 'Large', price_paise: 60000 }] };
  assert.equal(priceCart([{ productId: '1', qty: 1, dimension: 'Large' }], [variant]).total_paise, 60000);
  assert.throws(() => priceCart([{ productId: '1', qty: 1 }], [variant]), /size/);
  assert.throws(() => priceCart([{ productId: '1', qty: 1 }], [{ ...product, in_stock: false }]), /stock/);
  assert.throws(() => priceCart([{ productId: '99', qty: 1 }], [product]), /available/);
});

test('invalid quantities and oversized carts fail rather than silently changing amounts', () => {
  for (const qty of [0, -1, 21, 1.5, '2', NaN]) assert.throws(() => priceCart([{ productId: '1', qty }], [product]), /Quantity/);
  assert.throws(() => priceCart([], [product]), /Cart/);
  assert.throws(() => priceCart(Array.from({ length: 51 }, () => ({ productId: '1', qty: 1 })), [product]), /Cart/);
});

test('quotes reject changed prices, signatures, expiry and another customer', () => {
  const quote = signQuote(priceCart([{ productId: '1', qty: 1 }], [product]), '7', 'shop@upi');
  assert.equal(verifyQuote(quote.quote_token, '7').total_paise, 25000);
  assert.equal(verifyQuote(quote.quote_token, '8'), null);
  assert.equal(verifyQuote(quote.quote_token, '7', quote.expires_at), null);
  const [payload, sig] = quote.quote_token.split('.');
  const changed = JSON.parse(Buffer.from(payload, 'base64url')); changed.total_paise = 1;
  assert.equal(verifyQuote(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${sig}`, '7'), null);
  assert.equal(verifyQuote(`${payload}.invalid`, '7'), null);
});

test('checkout endpoint obtains current prices and disables payment without a payee', async () => {
  const sql = async () => [product];
  process.env.ADMIN_UPI_ID = 'shop@upi';
  const res = response();
  await ordersHandler({ method: 'POST', headers: { authorization }, body: { action: 'quote', items: [{ productId: '1', qty: 2, price_paise: 1 }] } }, res, sql);
  assert.equal(res.body.total_paise, 50000); assert.equal(res.body.upi_id, 'shop@upi');
  assert.ok(res.body.quote_token);
  delete process.env.ADMIN_UPI_ID;
  const unavailable = response();
  await ordersHandler({ method: 'POST', headers: { authorization }, body: { action: 'quote', items: [{ productId: '1', qty: 1 }] } }, unavailable, sql);
  assert.equal(unavailable.code, 503);
});

test('order creation honours the quoted amount and retries reuse the same order even after profile failure', async () => {
  const quote = signQuote(priceCart([{ productId: '1', qty: 1 }], [product]), '7', 'shop@upi');
  const saved = new Map();
  const sql = async (strings, ...values) => {
    if (strings.join('').includes('INSERT INTO orders')) {
      assert.equal(values[3], 25000);
      assert.match(strings.join(''), /ON CONFLICT \(checkout_key\)/);
      if (!saved.has(values[6])) saved.set(values[6], { id: '5', order_no: '1005' });
      return [saved.get(values[6])];
    }
    throw new Error('Profile saving is unavailable');
  };
  const req = { method: 'POST', headers: { authorization }, body: { quote_token: quote.quote_token, items: [{ price_paise: 1 }], address: { line1: '123 Street', city: 'Mumbai', pincode: '400001' }, upi_ref: '123456789012' } };
  const first = response(), repeat = response();
  await ordersHandler(req, first, sql); await ordersHandler(req, repeat, sql);
  assert.equal(first.code, 201); assert.equal(repeat.body.id, first.body.id); assert.equal(saved.size, 1);
});

test('public catalog excludes embedded images, detail uses image URLs, admin catalog requires authentication', async () => {
  const res = response();
  await productsHandler({ method: 'GET', query: {} }, res, async strings => {
    assert.doesNotMatch(strings.join(''), /image_url|\bimages\b/);
    return [{ ...product, has_thumb: true, created_at: '2026-10-03' }];
  });
  assert.match(res.body[0].thumb_url, /^\/api\/products\?/);
  assert.doesNotMatch(JSON.stringify(res.body), /data:image/);
  const detail = response();
  await productsHandler({ method: 'GET', query: { id: '1' } }, detail, async () => [{ ...product, thumb_url: 'data:image/jpeg;base64,YQ==', images: [{ full: 'data:image/jpeg;base64,YQ==', thumb: 'data:image/jpeg;base64,YQ==' }] }]);
  assert.doesNotMatch(JSON.stringify(detail.body), /data:image/);
  const admin = response();
  await productsHandler({ method: 'GET', query: { scope: 'admin' }, headers: {} }, admin, async () => { throw new Error('must not query'); });
  assert.equal(admin.code, 401);
});

test('image endpoint delivers cached binary data and rejects unsafe content types', async () => {
  const req = { method: 'GET', query: { id: '1', image: '0' } };
  const res = response();
  await productsHandler(req, res, async () => [{ ...product, images: ['data:image/jpeg;base64,YQ=='] }]);
  assert.equal(res.headers['Content-Type'], 'image/jpeg'); assert.ok(Buffer.isBuffer(res.body));
  const unsafe = response();
  await productsHandler(req, unsafe, async () => [{ ...product, images: ['data:image/svg+xml;base64,YQ=='] }]);
  assert.equal(unsafe.code, 404);
});

test('legacy hash links become clean paths and modified clicks retain browser behaviour', () => {
  const original = global.window;
  let pushed = '';
  global.window = { location: { hash: '#/product/9', pathname: '/', href: 'https://shop.example/', origin: 'https://shop.example' }, history: { replaceState(_, __, path) { this.path = path; window.location.pathname = path; window.location.hash = ''; }, pushState(_, __, path) { pushed = path; } }, dispatchEvent() {} };
  assert.equal(currentRoute(), '/product/9');
  const link = { href: 'https://shop.example/shipping', target: '', hasAttribute: () => false };
  let prevented = false;
  interceptLink({ target: { closest: () => link }, button: 0, ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(pushed, '');
  global.window = original;
});

test('production signing refuses the known development fallback', () => {
  const secret = process.env.AUTH_SECRET; delete process.env.AUTH_SECRET;
  const mode = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  assert.throws(authSecret, /AUTH_SECRET/);
  process.env.AUTH_SECRET = secret;
  if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
});
