// Data layer. In production every call hits the Vercel serverless APIs (Postgres).
// In local dev (`npm run dev`) everything is served from localStorage — no backend,
// no database needed to iterate on the UI.

export const IS_DEV = !import.meta.env.PROD;

export const AUTH_KEY = 'moment-kart-auth';

function authFetch(url, opts = {}) {
  const token = localStorage.getItem(AUTH_KEY) || '';
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  }).then((r) => {
    if (r.status === 401) {
      localStorage.removeItem(AUTH_KEY);
      window.location.hash = '#/auth';
      window.location.reload();
    }
    return r;
  });
}

async function toResult(resPromise) {
  try {
    const res = await resPromise;
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: 'Connection error — please try again' } };
  }
}

// ─── Local (dev) storage helpers ──────────────────────────────────────────────

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const USERS_KEY = 'mk-dev-users';
const PRODUCTS_KEY = 'mk-dev-products';
const ORDERS_KEY = 'mk-dev-orders';
const CODES_KEY = 'mk-dev-codes';
const REVIEWS_KEY = 'mk-dev-reviews';

// Fulfilled and cancelled are terminal states: no further transitions happen on their own,
// so they're the only statuses that can be deleted or carry a closing note.
export const TERMINAL_ORDER_STATUSES = ['fulfilled', 'cancelled'];

// Mirrors prod's numeric ids (Postgres BIGINT, returned as strings) — dev storage
// is a plain array, so the next id is just the current max + 1.
const nextId = (items) => String(items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1);
const todayStr = () => new Date().toISOString().slice(0, 10);

// Dev admin credentials come from .env.local (ADMIN_EMAIL / ADMIN_PASSWORD —
// the same names used in Vercel for production). Injected by vite.config.js in dev only.
export const DEV_ADMIN_EMAIL = (typeof __DEV_ADMIN_EMAIL__ !== 'undefined' ? __DEV_ADMIN_EMAIL__ : '').toLowerCase();
const DEV_ADMIN_PASSWORD = typeof __DEV_ADMIN_PASSWORD__ !== 'undefined' ? __DEV_ADMIN_PASSWORD__ : '';

function devIsAdmin(email) {
  return !!DEV_ADMIN_EMAIL && email.toLowerCase() === DEV_ADMIN_EMAIL;
}

function devToken(user) {
  const payload = btoa(
    JSON.stringify({
      uid: user.id,
      email: user.email,
      name: user.name,
      admin: devIsAdmin(user.email),
      exp: Date.now() + 90 * 24 * 60 * 60 * 1000,
    })
  ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.dev`;
}

function devCurrentUser() {
  try {
    const token = localStorage.getItem(AUTH_KEY);
    const [payload] = token.split('.');
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

// Dev emails go through the Vite dev server (/api/dev-email, see vite.config.js):
// it prints OTP codes to the `npm run dev` terminal + dev-emails.log, and sends
// the real email via Gmail SMTP when GMAIL_USER/GMAIL_APP_PASSWORD are set in .env.local.
function devSendEmail(payload) {
  return fetch('/api/dev-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// Verification codes are never shown in the UI — check the dev server terminal.
function issueDevCode(codes, email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes[email] = code;
  write(CODES_KEY, codes);
  devSendEmail({ kind: 'verification', to: email, code });
  return code;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function authAction(body) {
  if (!IS_DEV) return toResult(fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  const users = read(USERS_KEY, []);
  const codes = read(CODES_KEY, {});
  const email = String(body.email || '').trim().toLowerCase();
  const user = users.find((u) => u.email === email);

  if (body.action === 'signup') {
    if (user?.verified) return { ok: false, data: { error: 'Account already exists — please login' } };
    const next = users.filter((u) => u.email !== email);
    next.push({ id: user?.id || nextId(users), email, name: body.name, password: body.password, verified: false, address: null, created_at: new Date().toISOString() });
    write(USERS_KEY, next);
    issueDevCode(codes, email);
    return { ok: true, data: {} };
  }
  if (body.action === 'resend') {
    if (!user) return { ok: false, data: { error: 'No account found — please signup' } };
    issueDevCode(codes, email);
    return { ok: true, data: {} };
  }
  if (body.action === 'verify') {
    if (!user || codes[email] !== String(body.code)) return { ok: false, data: { error: 'Invalid verification code' } };
    user.verified = true;
    user.last_login = new Date().toISOString();
    write(USERS_KEY, users);
    delete codes[email];
    write(CODES_KEY, codes);
    return { ok: true, data: { token: devToken(user) } };
  }
  if (body.action === 'forgot') {
    if (!user) return { ok: true, data: { message: 'If an account exists, a reset code has been sent' } };
    issueDevCode(codes, email);
    return { ok: true, data: { message: 'If an account exists, a reset code has been sent' } };
  }
  if (body.action === 'reset') {
    if (String(body.password || '').length < 6) return { ok: false, data: { error: 'Password must be at least 6 characters' } };
    if (!user || codes[email] !== String(body.code)) return { ok: false, data: { error: 'Invalid reset code' } };
    user.password = body.password;
    user.verified = true;
    user.last_login = new Date().toISOString();
    write(USERS_KEY, users);
    delete codes[email];
    write(CODES_KEY, codes);
    return { ok: true, data: { token: devToken(user) } };
  }
  if (body.action === 'login') {
    // Built-in dev admin — no signup or verification needed locally.
    if (DEV_ADMIN_EMAIL && email === DEV_ADMIN_EMAIL && body.password === DEV_ADMIN_PASSWORD) {
      return { ok: true, data: { token: devToken({ id: 'dev-admin', email, name: 'Admin' }) } };
    }
    if (!user || user.password !== body.password) return { ok: false, data: { error: 'Invalid email or password' } };
    if (!user.verified) {
      issueDevCode(codes, email);
      return { ok: false, data: { error: 'Email not verified', needsVerification: true } };
    }
    user.last_login = new Date().toISOString();
    write(USERS_KEY, users);
    return { ok: true, data: { token: devToken(user) } };
  }
  return { ok: false, data: { error: 'Unknown action' } };
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function fetchProducts() {
  if (!IS_DEV) return fetch('/api/products').then((r) => r.json());
  return read(PRODUCTS_KEY, []);
}

export async function saveProduct(product, editingId) {
  if (!IS_DEV) {
    return toResult(authFetch('/api/products', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify({ 
          ...product, 
          id: editingId,
          legacy_id: product.legacy_id || uid(),  // ← Auto-generate if missing
        }),
    }));
  }
  const products = read(PRODUCTS_KEY, []);
  if (editingId) {
    const idx = products.findIndex((p) => p.id === editingId);
    if (idx >= 0) products[idx] = { ...products[idx], ...product, id: editingId };
  } else {
    products.push({ ...product, id: nextId(products) }); // new products default to the bottom of the shop order
  }
  write(PRODUCTS_KEY, products);
  return { ok: true, data: {} };
}

export async function deleteProduct(id) {
  if (!IS_DEV) return toResult(authFetch(`/api/products?id=${id}`, { method: 'DELETE' }));
  write(PRODUCTS_KEY, read(PRODUCTS_KEY, []).filter((p) => p.id !== id));
  return { ok: true, data: {} };
}

// Admin: re-rank the shop grid — ids is the full product list in the desired order.
export async function reorderProducts(ids) {
  if (!IS_DEV) return toResult(authFetch('/api/products', { method: 'PATCH', body: JSON.stringify({ order: ids }) }));
  const products = read(PRODUCTS_KEY, []);
  const byId = new Map(products.map((p) => [p.id, p]));
  const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const missing = products.filter((p) => !ids.includes(p.id));
  write(PRODUCTS_KEY, [...reordered, ...missing]);
  return { ok: true, data: {} };
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function fetchProfile() {
  if (!IS_DEV) {
    const res = await authFetch('/api/profile');
    return res.ok ? res.json() : null;
  }
  const me = devCurrentUser();
  const user = read(USERS_KEY, []).find((u) => u.email === me?.email);
  if (!user && me) return { email: me.email, name: me.name, addresses: read(`mk-dev-addr-${me.email}`, []) };
  return user ? { email: user.email, name: user.name, addresses: user.addresses || [] } : null;
}

export async function saveProfile({ name, addresses }) {
  if (!IS_DEV) return toResult(authFetch('/api/profile', { method: 'PUT', body: JSON.stringify({ name, addresses }) }));
  const me = devCurrentUser();
  const users = read(USERS_KEY, []);
  const user = users.find((u) => u.email === me?.email);
  if (!user) {
    // Built-in dev admin has no user record — keep its addresses separately.
    if (me) {
      write(`mk-dev-addr-${me.email}`, addresses || []);
      return { ok: true, data: {} };
    }
    return { ok: false, data: { error: 'User not found' } };
  }
  user.name = name;
  user.addresses = addresses || [];
  write(USERS_KEY, users);
  return { ok: true, data: {} };
}

export async function changePassword(current_password, new_password) {
  if (!IS_DEV) {
    return toResult(authFetch('/api/profile', { method: 'PATCH', body: JSON.stringify({ current_password, new_password }) }));
  }
  if (String(new_password || '').length < 6) {
    return { ok: false, data: { error: 'New password must be at least 6 characters' } };
  }
  const me = devCurrentUser();
  const users = read(USERS_KEY, []);
  const user = users.find((u) => u.email === me?.email);
  if (!user || user.password !== current_password) {
    return { ok: false, data: { error: 'Current password is incorrect' } };
  }
  user.password = new_password;
  write(USERS_KEY, users);
  return { ok: true, data: {} };
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function placeOrder({ items, address, upi_ref, transaction_date }) {
  if (!IS_DEV) return toResult(authFetch('/api/orders', { method: 'POST', body: JSON.stringify({ items, address, upi_ref, transaction_date }) }));

  const me = devCurrentUser();
  const products = read(PRODUCTS_KEY, []);
  let total = 0;
  const verifiedItems = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return { ok: false, data: { error: 'Product no longer available' } };
    if (!product.in_stock) return { ok: false, data: { error: `"${product.name}" is out of stock` } };

    let price_paise = product.price_paise;
    let dimension = null;
    const dims = Array.isArray(product.dimensions) ? product.dimensions : [];
    if (dims.length > 0) {
      dimension = dims.find((d) => d.label === item.dimension);
      if (!dimension) return { ok: false, data: { error: `Choose a size for "${product.name}"` } };
      price_paise = dimension.price_paise;
    }

    const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
    total += price_paise * qty;
    verifiedItems.push({ productId: product.id, name: product.name, price_paise, dimension: dimension?.label || null, qty, message: product.customizable ? String(item.message || '').slice(0, 200) : '' });
  }
  const orders = read(ORDERS_KEY, []);
  const orderNo = Math.max(1000, ...orders.map((o) => Number(o.order_no) || 0)) + 1;
  orders.unshift({
    id: nextId(orders), order_no: orderNo, user_email: me?.email, user_name: me?.name,
    items: verifiedItems, address, total_paise: total,
    upi_ref, status: 'pending', created_at: new Date().toISOString(),
    paid_at: transaction_date || todayStr(),
  });
  write(ORDERS_KEY, orders);

  // Save the shipping address into the profile if it's not already there.
  const profile = await fetchProfile();
  const saved = profile?.addresses || [];
  const key = (a) => `${a.line1}|${a.pincode}`.toLowerCase();
  if (!saved.some((a) => key(a) === key(address)) && saved.length < 10) {
    await saveProfile({ name: profile?.name || me?.name, addresses: [...saved, address] });
  }

  return { ok: true, data: {} };
}

export async function fetchMyOrders() {
  if (!IS_DEV) {
    const res = await authFetch('/api/orders');
    return res.ok ? res.json() : [];
  }
  const me = devCurrentUser();
  return read(ORDERS_KEY, []).filter((o) => o.user_email === me?.email);
}

export async function fetchAdminOrders(filter) {
  if (!IS_DEV) {
    const q = filter === 'all' ? '' : `&status=${filter}`;
    const res = await authFetch(`/api/orders?scope=admin${q}`);
    return res.ok ? res.json() : [];
  }
  const orders = read(ORDERS_KEY, []);
  return filter === 'all' ? orders : orders.filter((o) => o.status === filter);
}

// Customer resubmits payment on an order flagged "payment not received".
export async function resubmitPayment(id, upi_ref, transaction_date) {
  if (!IS_DEV) return toResult(authFetch('/api/orders', { method: 'PUT', body: JSON.stringify({ id, upi_ref, transaction_date }) }));
  if (String(upi_ref || '').trim().length < 6) {
    return { ok: false, data: { error: 'Valid UPI transaction reference is required' } };
  }
  const orders = read(ORDERS_KEY, []);
  const order = orders.find((o) => o.id === id);
  if (!order || order.status !== 'payment_issue') {
    return { ok: false, data: { error: 'This order is not awaiting payment confirmation' } };
  }
  order.upi_ref = String(upi_ref).trim();
  order.status = 'pending';
  order.paid_at = transaction_date || todayStr();
  write(ORDERS_KEY, orders);
  return { ok: true, data: {} };
}

export async function setOrderStatus(id, status, extra = {}) {
  if (!IS_DEV) return toResult(authFetch('/api/orders', { method: 'PUT', body: JSON.stringify({ id, status, ...extra }) }));
  if (status === 'shipped' && (!extra.courier || !String(extra.tracking_id || '').trim())) {
    return { ok: false, data: { error: 'Courier name and tracking ID are required to mark shipped' } };
  }
  const orders = read(ORDERS_KEY, []);
  const order = orders.find((o) => o.id === id);
  if (order) {
    order.status = status;
    if (status === 'shipped') {
      order.courier = extra.courier;
      order.tracking_id = extra.tracking_id;
      order.shipped_at = extra.shipped_date || todayStr();
      devSendEmail({
        kind: 'shipped',
        to: order.user_email,
        order: {
          order_no: order.order_no,
          name: order.user_name,
          items: order.items,
          courier: order.courier,
          tracking_id: order.tracking_id,
          address: order.address,
        },
      });
    } else if (TERMINAL_ORDER_STATUSES.includes(status)) {
      order.status_note = extra.note ? String(extra.note).trim().slice(0, 500) : null;
    }
  }
  write(ORDERS_KEY, orders);
  return { ok: true, data: {} };
}

// Admin: permanently delete orders (frees database space).
// Only fulfilled/cancelled orders can be deleted — active ones must run their course.
export async function deleteOrders(ids) {
  if (!IS_DEV) return toResult(authFetch('/api/orders', { method: 'DELETE', body: JSON.stringify({ ids }) }));
  const idSet = new Set(ids);
  const orders = read(ORDERS_KEY, []);
  const next = orders.filter((o) => !(idSet.has(o.id) && TERMINAL_ORDER_STATUSES.includes(o.status)));
  write(ORDERS_KEY, next);
  const deleted = orders.length - next.length;
  return { ok: true, data: { deleted, skipped: ids.length - deleted } };
}

// Admin: get a short-lived token to browse the shop as another user.
export async function impersonateUser(email) {
  if (!IS_DEV) {
    const { ok, data } = await toResult(authFetch('/api/users', { method: 'POST', body: JSON.stringify({ email }) }));
    return ok ? data.token : null;
  }
  const user = read(USERS_KEY, []).find((u) => u.email === String(email).toLowerCase());
  return user ? devToken(user) : null;
}

// Admin: list all registered users with their order activity.
export async function fetchAdminUsers() {
  if (!IS_DEV) {
    const res = await authFetch('/api/users');
    return res.ok ? res.json() : [];
  }
  const orders = read(ORDERS_KEY, []);
  const activity = (email) => {
    const mine = orders.filter((o) => o.user_email === email);
    return { order_count: mine.length, spent_paise: mine.reduce((s, o) => s + (o.total_paise || 0), 0) };
  };
  return read(USERS_KEY, []).map((u) => ({
    email: u.email, name: u.name, verified: !!u.verified,
    created_at: u.created_at || null, last_login: u.last_login || null, ...activity(u.email),
  }));
}

// Admin: send a marketing/offer email to selected users, featuring selected products.
export async function sendMarketingEmail({ userEmails, productIds, subject, message }) {
  if (!IS_DEV) {
    return toResult(authFetch('/api/marketing', {
      method: 'POST',
      body: JSON.stringify({ userEmails, productIds, subject, message }),
    }));
  }
  // Dev mode has no real SMTP — simulate success so the admin UI can be exercised locally.
  return { ok: true, data: { sent: userEmails.length, failed: 0, total: userEmails.length } };
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export async function fetchReviews(productId) {
  if (!IS_DEV) {
    const res = await fetch(`/api/reviews?productId=${productId}`);
    return res.ok ? res.json() : [];
  }
  return read(REVIEWS_KEY, []).filter((r) => r.product_id === productId && r.status === 'approved');
}

export async function fetchFeaturedReviews() {
  if (!IS_DEV) {
    const res = await fetch('/api/reviews?scope=featured');
    return res.ok ? res.json() : [];
  }
  const products = read(PRODUCTS_KEY, []);
  return read(REVIEWS_KEY, [])
    .filter((r) => r.status === 'approved' && r.featured)
    .map((r) => ({ ...r, product_name: products.find((p) => p.id === r.product_id)?.name || '' }))
    .slice(0, 6);
}

export async function submitReview({ productId, rating, text }) {
  if (!IS_DEV) return toResult(authFetch('/api/reviews', { method: 'POST', body: JSON.stringify({ productId, rating, text }) }));
  const me = devCurrentUser();
  if (!me) return { ok: false, data: { error: 'Please login to review' } };
  if (me.admin) return { ok: false, data: { error: 'The admin cannot review products' } };
  const reviews = read(REVIEWS_KEY, []);
  reviews.unshift({
    id: nextId(reviews), product_id: productId, user_id: me.uid, user_name: me.name,
    rating, text: String(text || '').slice(0, 1000),
    status: 'pending', featured: false, created_at: new Date().toISOString(),
  });
  write(REVIEWS_KEY, reviews);
  return { ok: true, data: { message: 'Review submitted — it will appear once approved' } };
}

export async function fetchAdminReviews(filter) {
  if (!IS_DEV) {
    const q = filter === 'all' ? '' : `&status=${filter}`;
    const res = await authFetch(`/api/reviews?scope=admin${q}`);
    return res.ok ? res.json() : [];
  }
  const products = read(PRODUCTS_KEY, []);
  const reviews = read(REVIEWS_KEY, []).map((r) => {
    const product = products.find((p) => p.id === r.product_id);
    return { ...r, product_name: product?.name || '', product_image: product?.image_url || '' };
  });
  return filter === 'all' ? reviews : reviews.filter((r) => r.status === filter);
}

export async function updateReview(id, patch) {
  if (!IS_DEV) return toResult(authFetch('/api/reviews', { method: 'PUT', body: JSON.stringify({ id, ...patch }) }));
  const reviews = read(REVIEWS_KEY, []);
  const review = reviews.find((r) => r.id === id);
  if (review) Object.assign(review, patch);
  write(REVIEWS_KEY, reviews);
  return { ok: true, data: {} };
}

export async function deleteReview(id) {
  if (!IS_DEV) return toResult(authFetch(`/api/reviews?id=${id}`, { method: 'DELETE' }));
  write(REVIEWS_KEY, read(REVIEWS_KEY, []).filter((r) => r.id !== id));
  return { ok: true, data: {} };
}
