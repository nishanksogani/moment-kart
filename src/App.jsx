import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import {
  AUTH_KEY, authAction, fetchProducts, saveProduct, deleteProduct, reorderProducts,
  fetchProfile, saveProfile, changePassword, placeOrder as apiPlaceOrder,
  fetchMyOrders, fetchAdminOrders, setOrderStatus as apiSetOrderStatus, resubmitPayment,
  deleteOrders, TERMINAL_ORDER_STATUSES,
  fetchReviews, fetchFeaturedReviews, submitReview, fetchAdminReviews, updateReview, deleteReview,
  fetchAdminUsers, impersonateUser, sendMarketingEmail,
} from './api.js';

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────

const CART_KEY = 'moment-kart-cart';
const UPI_ID = (typeof __UPI_ID__ !== 'undefined' && __UPI_ID__) || 'momentkart@upi';

const buildUpiLink = (totalPaise) =>
  `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(APP_NAME)}&am=${(totalPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`${APP_NAME} order`)}`;
// Shop display name, configurable via APP_NAME in .env.local (dev) / Vercel env vars (prod).
const APP_NAME = (typeof __APP_NAME__ !== 'undefined' && __APP_NAME__) || 'Moment Kart';
const [BRAND_FIRST, ...BRAND_REST_WORDS] = APP_NAME.split(' ');
const BRAND_REST = BRAND_REST_WORDS.join(' ');
const BRAND_INITIALS = APP_NAME.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// Thumbnail for an order's first line item. `products` is the live catalog, so a
// product removed after the order was placed shows "Deleted" instead of a blank/generic tile.
function OrderThumb({ item, products }) {
  if (!item) return null;
  const product = products.find((p) => p.id === item.productId);
  if (product?.thumb_url) {
    return <img src={product.thumb_url} alt="" className="admin-order-photo" />;
  }
  if (!product) {
    return (
      <div className="admin-order-photo img-placeholder" style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--slate)' }}>
        Deleted
      </div>
    );
  }
  return <div className="admin-order-photo img-placeholder">{BRAND_INITIALS}</div>;
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function getSession() {
  try {
    const token = localStorage.getItem(AUTH_KEY);
    if (!token) return null;
    const [payload] = token.split('.');
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.exp || data.exp < Date.now()) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return { token, name: data.name, email: data.email, admin: !!data.admin };
  } catch {
    localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

// ─── CART (localStorage) ──────────────────────────────────────────────────────

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

// ─── PAGINATION ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 10;

function usePager(items, pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const slice = items.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return { page: safePage, setPage, pageCount, slice };
}

function Pager({ page, pageCount, setPage, label }) {
  if (pageCount <= 1) return null;
  return (
    <div className="shop-pager">
      <button type="button" className="btn btn-sm btn-ghost" disabled={page <= 0} onClick={() => setPage(page - 1)}>
        ← Previous
      </button>
      <span>Page {page + 1} of {pageCount}{label ? ` · ${label}` : ''}</span>
      <button type="button" className="btn btn-sm btn-ghost" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
        Next →
      </button>
    </div>
  );
}

function Spinner({ inline, small }) {
  return (
    <div className={inline ? 'spinner-wrap spinner-inline' : 'spinner-wrap'}>
      <div className={small ? 'spinner spinner-sm' : 'spinner'} role="status" aria-label="Loading" />
    </div>
  );
}

// ─── ROUTING ──────────────────────────────────────────────────────────────────

function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const go = (path) => (window.location.hash = '#' + path);

// ─── WAVES (landing decoration) ───────────────────────────────────────────────

function waveDataUri(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 140" preserveAspectRatio="none"><path d="M0,70 C200,140 400,0 600,70 C800,140 1000,0 1200,70 L1200,140 L0,140 Z" fill="${color}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function Waves() {
  return (
    <div className="waves">
      <div className="wave wave-1" style={{ backgroundImage: waveDataUri('#3e7d8f') }} />
      <div className="wave wave-2" style={{ backgroundImage: waveDataUri('#e8eef0') }} />
      <div className="wave wave-3" style={{ backgroundImage: waveDataUri('#f7f5f0') }} />
    </div>
  );
}

function Bubbles() {
  const bubbles = [
    { left: '8%', size: 22, dur: 11, delay: 0 },
    { left: '20%', size: 14, dur: 9, delay: 2 },
    { left: '35%', size: 30, dur: 13, delay: 1 },
    { left: '52%', size: 12, dur: 8, delay: 4 },
    { left: '68%', size: 26, dur: 12, delay: 0.5 },
    { left: '82%', size: 16, dur: 10, delay: 3 },
    { left: '93%', size: 20, dur: 14, delay: 1.5 },
  ];
  return bubbles.map((b, i) => (
    <span
      key={i}
      className="bubble"
      style={{
        left: b.left,
        width: b.size,
        height: b.size,
        animationDuration: `${b.dur}s`,
        animationDelay: `${b.delay}s`,
      }}
    />
  ));
}

// ─── REVIEWS ──────────────────────────────────────────────────────────────────

function Stars({ value, onChange }) {
  return (
    <span className={onChange ? 'stars stars-input' : 'stars'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={n <= value ? 'star filled' : 'star'}
          onClick={onChange ? () => onChange(n) : undefined}
          role={onChange ? 'button' : undefined}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function ProductReviews({ productId, session }) {
  const [reviews, setReviews] = useState(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchReviews(productId).then(setReviews).catch(() => setReviews([]));
  }, [productId]);

  async function submit(e) {
    e.preventDefault();
    if (!rating) {
      setNote('Please pick a star rating');
      return;
    }
    setBusy(true);
    const { ok, data } = await submitReview({ productId, rating, text });
    setBusy(false);
    if (ok) {
      setRating(0);
      setText('');
      setNote('Thank you — your review will appear once approved.');
    } else {
      setNote(data.error || 'Could not submit review');
    }
  }

  const { page, setPage, pageCount, slice } = usePager(reviews || [], 5);

  return (
    <div className="reviews-panel">
      {reviews === null ? (
        <Spinner inline small />
      ) : reviews.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--slate)', fontStyle: 'italic' }}>No reviews yet.</p>
      ) : (
        <>
        {slice.map((r) => (
          <div key={r.id} className="review">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Stars value={r.rating} />
              <span style={{ fontSize: 12, color: 'var(--slate)' }}>{r.user_name}</span>
            </div>
            {r.text && <p style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{r.text}</p>}
          </div>
        ))}
        <Pager page={page} pageCount={pageCount} setPage={setPage} />
        </>
      )}
      {session?.admin ? null : session ? (
        <form onSubmit={submit} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Stars value={rating} onChange={setRating} />
            <span style={{ fontSize: 12, color: 'var(--slate)' }}>Rate this product</span>
          </div>
          <textarea
            className="review-input"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            rows={2}
            placeholder="Share your experience (optional)"
          />
          {note && <p style={{ fontSize: 12, color: 'var(--ocean)', margin: '4px 0' }}>{note}</p>}
          <button className="btn btn-sm btn-ghost" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
        </form>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--slate)', marginTop: 8 }}>
          <a href="#/auth" style={{ color: 'var(--ocean)' }}>Login</a> to write a review.
        </p>
      )}
    </div>
  );
}

// ─── CAROUSEL ─────────────────────────────────────────────────────────────────

// Any image dropped into src/assets/carousel/ is picked up automatically at build time.
const carouselImages = Object.entries(
  import.meta.glob('./assets/carousel/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' })
)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, url]) => url);

function Carousel() {
  const [index, setIndex] = useState(0);
  const count = carouselImages.length;

  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(timer);
  }, [count]);

  if (count === 0) return null;

  return (
    <div className="page" style={{ paddingBottom: 48 }}>
      <h2 style={{ textAlign: 'center' }}>Signature Pieces</h2>
      <div className="carousel">
        {carouselImages.map((src, i) => (
          <img key={src} src={src} alt="" className={i === index ? 'slide active' : 'slide'} />
        ))}
        {count > 1 && (
          <>
            <button className="carousel-arrow prev" onClick={() => setIndex((index - 1 + count) % count)} aria-label="Previous">‹</button>
            <button className="carousel-arrow next" onClick={() => setIndex((index + 1) % count)} aria-label="Next">›</button>
            <div className="carousel-dots">
              {carouselImages.map((_, i) => (
                <button key={i} className={i === index ? 'dot active' : 'dot'} onClick={() => setIndex(i)} aria-label={`Slide ${i + 1}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── AUTH PAGE ────────────────────────────────────────────────────────────────

function AuthPage({ onLogin }) {
  const [mode, setMode] = useState('login'); // login | signup | verify
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function call(body) {
    setError('');
    setLoading(true);
    const result = await authAction(body);
    setLoading(false);
    return result;
  }

  async function handleSignup(e) {
    e.preventDefault();
    const r = await call({ action: 'signup', email, name, password });
    if (!r) return;
    if (r.ok) {
      setInfo('Verification code sent to your email');
      setMode('verify');
    } else setError(r.data.error || 'Signup failed');
  }

  async function handleLogin(e) {
    e.preventDefault();
    const r = await call({ action: 'login', email, password });
    if (!r) return;
    if (r.ok) {
      localStorage.setItem(AUTH_KEY, r.data.token);
      onLogin();
    } else if (r.data.needsVerification) {
      setInfo('Verification code sent to your email');
      setMode('verify');
    } else setError(r.data.error || 'Login failed');
  }

  async function handleVerify(e) {
    e.preventDefault();
    const r = await call({ action: 'verify', email, code });
    if (!r) return;
    if (r.ok) {
      localStorage.setItem(AUTH_KEY, r.data.token);
      onLogin();
    } else setError(r.data.error || 'Verification failed');
  }

  async function handleResend() {
    const r = await call({ action: 'resend', email });
    if (r?.ok) setInfo('Verification code resent');
    else if (r) setError(r.data.error || 'Could not resend code');
  }

  async function handleForgot(e) {
    e.preventDefault();
    const r = await call({ action: 'forgot', email });
    if (!r) return;
    if (r.ok) {
      setInfo('If an account exists, a reset code has been sent');
      setMode('reset');
    } else setError(r.data.error || 'Could not send reset code');
  }

  async function handleReset(e) {
    e.preventDefault();
    const r = await call({ action: 'reset', email, code, password });
    if (!r) return;
    if (r.ok) {
      localStorage.setItem(AUTH_KEY, r.data.token);
      onLogin();
    } else setError(r.data.error || 'Could not reset password');
  }

  return (
    <div className="auth-wrap card">
      <h1 style={{ textAlign: 'center', color: 'var(--deep)', marginBottom: 6 }}>{APP_NAME}</h1>
      <p style={{ textAlign: 'center', color: 'var(--slate)', marginBottom: 20, fontSize: 14 }}>
        Souvenirs that flow with your memories
      </p>
      {mode !== 'verify' && mode !== 'forgot' && mode !== 'reset' && (
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>
            Login
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>
            Sign Up
          </button>
        </div>
      )}

      {mode === 'signup' && (
        <form onSubmit={handleSignup}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="At least 6 characters" />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Sending code…' : 'Create account'}
          </button>
        </form>
      )}

      {mode === 'login' && (
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Logging in…' : 'Login'}
          </button>
          <button
            type="button"
            className="link-btn"
            style={{ margin: '14px auto 0', display: 'block' }}
            onClick={() => { setError(''); setInfo(''); setMode('forgot'); }}
          >
            Forgot password?
          </button>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgot}>
          <p style={{ marginBottom: 12, color: 'var(--slate)', fontSize: 14 }}>
            Enter your email and we'll send you a reset code.
          </p>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoFocus />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Sending code…' : 'Send reset code'}
          </button>
          <button type="button" className="link-btn" style={{ margin: '14px auto 0', display: 'block' }} onClick={() => { setError(''); setMode('login'); }}>
            Back to login
          </button>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={handleReset}>
          <p style={{ marginBottom: 12, color: 'var(--slate)', fontSize: 14 }}>
            Enter the 6-digit code sent to <strong>{email}</strong> and your new password.
          </p>
          {info && <p className="success">{info}</p>}
          <div className="field">
            <label>Reset code</label>
            <input
              className="otp-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              inputMode="numeric"
              placeholder="••••••"
              autoFocus
            />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="At least 6 characters" />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={loading || code.length !== 6}>
            {loading ? 'Resetting…' : 'Reset password & login'}
          </button>
          <button type="button" className="link-btn" style={{ margin: '14px auto 0', display: 'block' }} onClick={handleForgot} disabled={loading}>
            Resend code
          </button>
        </form>
      )}

      {mode === 'verify' && (
        <form onSubmit={handleVerify}>
          <p style={{ marginBottom: 12, color: 'var(--slate)', fontSize: 14 }}>
            Enter the 6-digit code sent to <strong>{email}</strong>
          </p>
          {info && <p className="success">{info}</p>}
          <div className="field">
            <input
              className="otp-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              inputMode="numeric"
              placeholder="••••••"
              autoFocus
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={loading || code.length !== 6}>
            {loading ? 'Verifying…' : 'Verify & continue'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={handleResend} disabled={loading}>
            Resend code
          </button>
        </form>
      )}
    </div>
  );
}

// ─── LANDING ──────────────────────────────────────────────────────────────────

function Landing({ products, loading }) {
  // Only admin-curated products show here; cap to the top few if many are marked.
  const featured = products.filter((p) => p.in_stock && p.featured).slice(0, 3);
  const [quotes, setQuotes] = useState([]);
  useEffect(() => {
    fetchFeaturedReviews().then(setQuotes).catch(() => {});
  }, []);
  return (
    <>
      <section className="hero">
        <Bubbles />
        <h1>{APP_NAME}</h1>
        <div className="rule" />
        <p>
          Souvenirs that flow with your memories — personalised keepsakes,
          delivered like a gentle tide to your doorstep.
        </p>
        <button className="btn" onClick={() => go('/shop')}>
          Explore the Collection
        </button>
        <Waves />
      </section>
      <Carousel />
      {loading ? (
        <div className="page">
          <h2 style={{ textAlign: 'center' }}>Featured Keepsakes</h2>
          <Spinner />
        </div>
      ) : featured.length > 0 && (
        <div className="page">
          <h2 style={{ textAlign: 'center' }}>Featured Keepsakes</h2>
          <div className="grid" style={{ marginTop: 20 }}>
            {featured.map((p, i) => (
              <div key={p.id} className="ripple-float" style={{ animationDelay: `${i * 0.7}s` }}>
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </div>
      )}
      {quotes.length > 0 && (
        <div className="page" style={{ paddingTop: 0 }}>
          <h2 style={{ textAlign: 'center' }}>Words from Our Customers</h2>
          <div className="quotes">
            {quotes.map((q) => (
              <figure key={q.id} className="quote card">
                <Stars value={q.rating} />
                <blockquote>“{q.text}”</blockquote>
                <figcaption>
                  — {q.user_name}
                  {q.product_name && (
                    <span> · {q.product_id ? <a href={`#/product/${q.product_id}`}>{q.product_name}</a> : q.product_name}</span>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── SHOP ─────────────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd }) {
  const [added, setAdded] = useState(false);
  const hasDimensions = (product.dimensions || []).length > 0;

  function add() {
    onAdd(product, '');
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div className="card product-card">
      <a href={`#/product/${product.id}`} className="product-thumb" aria-label={`View ${product.name}`}>
        {product.thumb_url ? (
          <img src={product.thumb_url} alt={product.name} />
        ) : (
          <div className="img-placeholder no-image">No Image</div>
        )}
        <span className="product-thumb-hint">🔍 View details</span>
      </a>
      <div className="body">
        <strong>{product.name}</strong>
        {product.description && <span className="desc">{product.description}</span>}
        <a href={`#/product/${product.id}`} className="link-btn" style={{ alignSelf: 'flex-start' }}>
          See details &amp; reviews →
        </a>
        {(product.tags || []).length > 0 && (
          <span className="product-tags">
            {product.tags.map((t) => <span key={t} className="ptag">{t}</span>)}
          </span>
        )}
        {hasDimensions && (
          <span className="size-chips">
            {product.dimensions.slice(0, 4).map((d) => <span key={d.label} className="size-chip">{d.label}</span>)}
            {product.dimensions.length > 4 && <span className="size-chip">+{product.dimensions.length - 4} more</span>}
          </span>
        )}
        <span className="price" style={{ marginTop: 'auto' }}>
          {hasDimensions && 'From '}{rupees(product.price_paise)}
        </span>
        {!product.in_stock && <span className="badge badge-oos">Out of stock</span>}
        {onAdd && product.in_stock && (
          hasDimensions ? (
            <a href={`#/product/${product.id}`} className="btn btn-sm">Choose size</a>
          ) : (
            <button className="btn btn-sm" onClick={add}>
              {added ? 'Added ✓' : 'Add to Cart'}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ─── PRODUCT DETAILS ────────────────────────────────────────────────────────

function ProductDetails({ id, products, onAdd, session }) {
  const product = products.find((p) => p.id === id);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState('');
  const [added, setAdded] = useState(false);
  const [dimIdx, setDimIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => { setActive(0); setDimIdx(0); setLightboxOpen(false); }, [id]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightboxOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  if (!product) {
    return (
      <div className="page">
        {products.length === 0 ? (
          <Spinner />
        ) : (
          <p className="empty">That product isn't available anymore. <a href="#/shop" style={{ color: 'var(--ocean)', fontWeight: 700 }}>Browse the collection →</a></p>
        )}
      </div>
    );
  }

  const images = (product.images && product.images.length ? product.images : (product.image_url ? [product.image_url] : [])).map(toPhoto);
  const dimensions = product.dimensions || [];
  const selectedDimension = dimensions[dimIdx] || null;
  const displayPrice = selectedDimension ? selectedDimension.price_paise : product.price_paise;

  function add() {
    onAdd(product, message, selectedDimension);
    setMessage('');
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div className="page" style={{ maxWidth: 1140 }}>
      <a href="#/shop" className="link-btn">← Back to shop</a>
      <div className="product-details">
        <div className="pd-gallery">
          {images.length > 0 ? (
            <div className="pd-photo-wrap pd-zoomable" onClick={() => setLightboxOpen(true)}>
              <img src={images[active].full} alt={`${product.name} photo ${active + 1}`} className="pd-photo" />
              <span className="pd-zoom-hint">🔍 Click to enlarge</span>
              {images.length > 1 && (
                <>
                  <button type="button" className="carousel-arrow prev" onClick={(e) => { e.stopPropagation(); setActive((active - 1 + images.length) % images.length); }} aria-label="Previous photo">‹</button>
                  <button type="button" className="carousel-arrow next" onClick={(e) => { e.stopPropagation(); setActive((active + 1) % images.length); }} aria-label="Next photo">›</button>
                  <div className="carousel-dots">
                    {images.map((_, i) => (
                      <button type="button" key={i} className={i === active ? 'dot active' : 'dot'} onClick={(e) => { e.stopPropagation(); setActive(i); }} aria-label={`Photo ${i + 1}`} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="img-placeholder pd-main-img">{BRAND_INITIALS}</div>
          )}
        </div>
        {lightboxOpen && images.length > 0 && (
          <div className="lightbox-backdrop" onClick={() => setLightboxOpen(false)}>
            <button type="button" className="lightbox-close" onClick={() => setLightboxOpen(false)} aria-label="Close">×</button>
            <img src={images[active].full} alt={`${product.name} photo ${active + 1}`} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
            {images.length > 1 && (
              <>
                <button type="button" className="carousel-arrow prev" onClick={(e) => { e.stopPropagation(); setActive((active - 1 + images.length) % images.length); }} aria-label="Previous photo">‹</button>
                <button type="button" className="carousel-arrow next" onClick={(e) => { e.stopPropagation(); setActive((active + 1) % images.length); }} aria-label="Next photo">›</button>
              </>
            )}
          </div>
        )}
        <div className="pd-info">
          <h1>{product.name}</h1>
          <span className="price" style={{ fontSize: 20 }}>{rupees(displayPrice)}</span>
          {!product.in_stock && <span className="badge badge-oos">Out of stock</span>}
          {product.description && <p className="pd-desc">{product.description}</p>}
          {(product.tags || []).length > 0 && (
            <span className="product-tags">
              {product.tags.map((t) => <span key={t} className="ptag">{t}</span>)}
            </span>
          )}
          {dimensions.length > 0 && (
            <div className="field">
              <label>Size</label>
              <div className="tag-row">
                {dimensions.map((d, i) => (
                  <button
                    type="button"
                    key={d.label}
                    className={i === dimIdx ? 'tag-chip active' : 'tag-chip'}
                    onClick={() => setDimIdx(i)}
                  >
                    {d.label} — {rupees(d.price_paise)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {onAdd && product.in_stock && (
            <>
              {product.customizable && (
                <div className="field">
                  <label>{product.custom_label || 'Your message'}</label>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                    placeholder="e.g. Happy Birthday Asha!"
                  />
                </div>
              )}
              <button className="btn" onClick={add}>
                {added ? 'Added ✓' : 'Add to Cart'}
              </button>
            </>
          )}
        </div>
      </div>
      <h2>Reviews</h2>
      <div className="card">
        <ProductReviews productId={product.id} session={session} />
      </div>
    </div>
  );
}

const SHOP_PAGE_SIZE = 12;

function Shop({ products, loading, onAdd }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');

  const allTags = [...new Set(products.flatMap((p) => p.tags || []))].sort();
  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (tag && !(p.tags || []).includes(tag)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.includes(q))
    );
  });

  const { page: safePage, setPage, pageCount, slice: pageSlice } = usePager(filtered, SHOP_PAGE_SIZE);

  return (
    <div className="page">
      <h1>The Collection</h1>
      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <p className="empty">No products yet — check back soon.</p>
      ) : (
        <>
          <div className="shop-toolbar">
            <input
              type="search"
              className="shop-search"
              placeholder="Search by name, event or description…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            />
            {allTags.length > 0 && (
              <div className="tag-row">
                <button type="button" className={tag === '' ? 'tag-chip active' : 'tag-chip'}
                  onClick={() => { setTag(''); setPage(0); }}>
                  All
                </button>
                {allTags.map((t) => (
                  <button key={t} type="button" className={tag === t ? 'tag-chip active' : 'tag-chip'}
                    onClick={() => { setTag(tag === t ? '' : t); setPage(0); }}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {filtered.length === 0 ? (
            <p className="empty">Nothing matches — try another event or search term.</p>
          ) : (
            <div className="grid">
              {pageSlice.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={onAdd} />
              ))}
            </div>
          )}
          <Pager page={safePage} pageCount={pageCount} setPage={setPage} label={`${filtered.length} products`} />
        </>
      )}
    </div>
  );
}

// ─── CART ─────────────────────────────────────────────────────────────────────

function Cart({ cart, setCart, session }) {
  const total = cart.reduce((sum, item) => sum + item.price_paise * item.qty, 0);

  function setQty(idx, qty) {
    const next = [...cart];
    if (qty <= 0) next.splice(idx, 1);
    else next[idx] = { ...next[idx], qty: Math.min(20, qty) };
    setCart(next);
  }

  if (cart.length === 0) {
    return (
      <div className="page">
        <h1>Your Cart</h1>
        <p className="empty">
          Your cart is empty. <a href="#/shop" style={{ color: 'var(--ocean)', fontWeight: 600 }}>Browse the collection →</a>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Your Cart</h1>
      <div className="card">
        {cart.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--foam)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong>{item.name}</strong>
              {item.dimension && (
                <div style={{ fontSize: 13, color: 'var(--slate)' }}>Size: {item.dimension}</div>
              )}
              {item.message && (
                <div style={{ fontSize: 13, color: 'var(--slate)' }}>💬 “{item.message}”</div>
              )}
            </div>
            <div className="qty-controls">
              <button onClick={() => setQty(idx, item.qty - 1)}>−</button>
              <span>{item.qty}</span>
              <button onClick={() => setQty(idx, item.qty + 1)}>+</button>
            </div>
            <strong style={{ minWidth: 90, textAlign: 'right' }}>{rupees(item.price_paise * item.qty)}</strong>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 18 }}>
          <strong>Total</strong>
          <strong style={{ color: 'var(--ocean)' }}>{rupees(total)}</strong>
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 18 }} onClick={() => go(session ? '/checkout' : '/auth')}>
          {session ? 'Proceed to checkout →' : 'Login to checkout →'}
        </button>
      </div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────

function UpiQr({ value }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: 200,
        margin: 2,
        color: { dark: '#123845', light: '#f7f5f0' },
      });
    }
  }, [value]);
  return <canvas ref={canvasRef} className="upi-qr" />;
}

const EMPTY_ADDRESS = { label: '', line1: '', line2: '', city: '', state: '', pincode: '', phone: '' };

const addressSummary = (a) =>
  [a.line1, a.city, a.pincode].filter(Boolean).join(', ');

function AddressForm({ address, setAddress }) {
  const set = (k) => (e) => setAddress({ ...address, [k]: e.target.value });
  return (
    <>
      <div className="field"><label>House Name / Door Number</label><input value={address.label || ''} onChange={set('label')} placeholder="e.g. Home, Office" /></div>
      <div className="field"><label>Address line 1 *</label><input value={address.line1} onChange={set('line1')} required /></div>
      <div className="field"><label>Address line 2</label><input value={address.line2} onChange={set('line2')} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label>City *</label><input value={address.city} onChange={set('city')} required /></div>
        <div className="field"><label>State</label><input value={address.state} onChange={set('state')} /></div>
        <div className="field"><label>PIN code *</label><input value={address.pincode} onChange={set('pincode')} required pattern="[0-9]{6}" title="6-digit PIN code" /></div>
        <div className="field"><label>Phone</label><input value={address.phone} onChange={set('phone')} /></div>
      </div>
    </>
  );
}

function Checkout({ cart, setCart }) {
  const [saved, setSaved] = useState([]);
  const [selected, setSelected] = useState(-1); // index into saved, or -1 for a new address
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [upiRef, setUpiRef] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayStr());
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const total = cart.reduce((sum, item) => sum + item.price_paise * item.qty, 0);
  const upiLink = buildUpiLink(total);

  useEffect(() => {
    fetchProfile()
      .then((profile) => {
        const list = profile?.addresses || [];
        setSaved(list);
        if (list.length > 0) {
          setSelected(0);
          setAddress({ ...EMPTY_ADDRESS, ...list[0] });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function pick(idx) {
    setSelected(idx);
    setAddress(idx >= 0 ? { ...EMPTY_ADDRESS, ...saved[idx] } : EMPTY_ADDRESS);
  }

  async function placeOrder(e) {
    e.preventDefault();
    setError('');
    setPlacing(true);
    const { ok, data } = await apiPlaceOrder({
      items: cart.map((i) => ({ productId: i.productId, qty: i.qty, message: i.message, dimension: i.dimension || null })),
      address,
      upi_ref: upiRef,
      transaction_date: transactionDate,
    });
    if (ok) {
      setCart([]);
      go('/orders');
    } else {
      setError(data.error || 'Could not place order');
    }
    setPlacing(false);
  }

  if (cart.length === 0) {
    return (
      <div className="page">
        <p className="empty">Nothing to check out. <a href="#/shop" style={{ color: 'var(--ocean)', fontWeight: 700 }}>Browse the shop →</a></p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1>Checkout</h1>
      <form onSubmit={placeOrder}>
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Order summary</h2>
          {cart.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
              <span>
                {item.name}{item.dimension && ` — Size: ${item.dimension}`} × {item.qty}
                {item.message && <em style={{ color: 'var(--slate)' }}> — “{item.message}”</em>}
              </span>
              <span>{rupees(item.price_paise * item.qty)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 17 }}>
            <strong>Total</strong>
            <strong style={{ color: 'var(--ocean)' }}>{rupees(total)}</strong>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Shipping address</h2>
          {!loaded ? (
            <Spinner inline small />
          ) : (
            <>
              {saved.length > 0 && (
                <div className="addr-picker">
                  {saved.map((a, i) => (
                    <label key={i} className={selected === i ? 'addr-option active' : 'addr-option'}>
                      <input type="radio" name="addr" checked={selected === i} onChange={() => pick(i)} />
                      <span>
                        <strong>{a.label || `Address ${i + 1}`}</strong>
                        <em>{addressSummary(a)}</em>
                      </span>
                    </label>
                  ))}
                  <label className={selected === -1 ? 'addr-option active' : 'addr-option'}>
                    <input type="radio" name="addr" checked={selected === -1} onChange={() => pick(-1)} />
                    <span><strong>New address</strong></span>
                  </label>
                </div>
              )}
              <AddressForm address={address} setAddress={setAddress} />
            </>
          )}
          <p style={{ fontSize: 12, color: 'var(--slate)' }}>
            Changes here apply to this order only. Manage saved addresses in your <a href="#/profile" style={{ color: 'var(--ocean)' }}>profile</a>.
          </p>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Pay via UPI</h2>
          <div className="upi-box">
            <p style={{ fontSize: 13, color: 'var(--slate)', marginBottom: 6 }}>
              Pay <strong>{rupees(total)}</strong> to:
            </p>
            <p className="upi-id">{UPI_ID}</p>
            <UpiQr value={upiLink} />
            <p style={{ fontSize: 12, color: 'var(--slate)' }}>
              Scan with any UPI app — GPay, PhonePe, Paytm — or tap below on your phone.
            </p>
            <a href={upiLink}>
              <button type="button" className="btn btn-sm" style={{ marginTop: 12 }}>
                Open UPI App
              </button>
            </a>
          </div>
          <div className="field">
            <label>UPI transaction reference (UTR) *</label>
            <input
              value={upiRef}
              onChange={(e) => setUpiRef(e.target.value)}
              required
              minLength={6}
              placeholder="e.g. 415223344556"
            />
            <span style={{ fontSize: 12, color: 'var(--slate)' }}>
              Complete the payment in your UPI app, then paste the transaction/UTR number here.
            </span>
          </div>
          <div className="field">
            <label>Payment date *</label>
            <input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} required />
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={placing}>
          {placing ? 'Placing order…' : `Place order — ${rupees(total)}`}
        </button>
      </form>
    </div>
  );
}

// ─── MY ORDERS ────────────────────────────────────────────────────────────────

function MyOrders() {
  const [orders, setOrders] = useState(null);
  const [products, setProducts] = useState([]);
  const [fixing, setFixing] = useState(null); // { orderId, upi_ref }
  const [fixError, setFixError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => fetchMyOrders().then(setOrders).catch(() => setOrders([]));
  useEffect(() => { load(); }, []);
  useEffect(() => { fetchProducts().then(setProducts).catch(() => {}); }, []);

  async function resubmit(e, order) {
    e.preventDefault();
    setBusy(true);
    const { ok, data } = await resubmitPayment(order.id, fixing.upi_ref, fixing.transaction_date);
    setBusy(false);
    if (ok) {
      setFixing(null);
      setFixError('');
      load();
    } else {
      setFixError(data.error || 'Could not update payment reference');
    }
  }

  const { page, setPage, pageCount, slice } = usePager(orders || [], 5);

  if (!orders) return <div className="page"><Spinner /></div>;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>My Orders</h1>
      {orders.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        <>
        {slice.map((o) => (
          <div key={o.id} className="card" style={{ marginBottom: 16 }}>
            <strong>{new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <dl className="order-details" style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="order-row">
                  <dt>Order ID:</dt>
                  <dd className="order-id">{o.order_no ? `#${o.order_no}` : o.id}</dd>
                </div>
                {o.items.map((item, i) => {
                  const product = products.find((p) => p.id === item.productId);
                  return (
                    <div key={i} className="order-row">
                      <dt>Product:</dt>
                      <dd>
                        {item.name} × {item.qty}
                        {item.dimension && (
                          <div><span className="order-sublabel">Size:</span> {item.dimension}</div>
                        )}
                        {product && (
                          <div><a href={`#/product/${item.productId}`} className="link-btn">View product</a></div>
                        )}
                        {item.message && (
                          <div><span className="order-sublabel">Message:</span> <em>“{item.message}”</em></div>
                        )}
                      </dd>
                    </div>
                  );
                })}
                {o.address && (
                  <div className="order-row">
                    <dt>Address:</dt>
                    <dd>
                      {[o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.pincode]
                        .filter(Boolean)
                        .map((line, i) => <div key={i}>{line}</div>)}
                      {o.address.phone && <div>Phone: {o.address.phone}</div>}
                    </dd>
                  </div>
                )}
                <div className="order-row">
                  <dt>Transaction:</dt>
                  <dd>{o.upi_ref}</dd>
                </div>
                {o.paid_at && (
                  <div className="order-row">
                    <dt>Payment date:</dt>
                    <dd>{new Date(o.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
                  </div>
                )}
                {(o.status === 'shipped' || o.status === 'fulfilled') && o.courier && (
                  <div className="order-row">
                    <dt>Shipping:</dt>
                    <dd>
                      {o.courier} · Tracking ID: <strong>{o.tracking_id}</strong>
                      {o.shipped_at && (
                        <div>Shipped on {new Date(o.shipped_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      )}
                    </dd>
                  </div>
                )}
                <div className="order-row">
                  <dt>Total:</dt>
                  <dd><strong style={{ color: 'var(--ocean)' }}>{rupees(o.total_paise)}</strong></dd>
                </div>
              </dl>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
                <span className={`badge badge-${o.status}`}>{o.status.replace('_', ' ')}</span>
                <OrderThumb item={o.items[0]} products={products} />
              </div>
            </div>
            {o.status === 'payment_issue' && (
              <div className="payment-issue-box">
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>Payment not received.</strong> Please check the transaction in your UPI app
                  and resubmit the correct transaction/UTR reference. If the payment didn't go through,
                  scan the QR below to pay again.
                </p>
                <div className="upi-box" style={{ background: 'white' }}>
                  <p style={{ fontSize: 13, color: 'var(--slate)', marginBottom: 6 }}>
                    Pay <strong>{rupees(o.total_paise)}</strong> to:
                  </p>
                  <p className="upi-id">{UPI_ID}</p>
                  <UpiQr value={buildUpiLink(o.total_paise)} />
                  <a href={buildUpiLink(o.total_paise)}>
                    <button type="button" className="btn btn-sm" style={{ marginTop: 10 }}>Open UPI App</button>
                  </a>
                </div>
                {fixing?.orderId === o.id ? (
                  <form onSubmit={(e) => resubmit(e, o)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
                      <label>UPI transaction reference (UTR)</label>
                      <input
                        value={fixing.upi_ref}
                        onChange={(e) => setFixing({ ...fixing, upi_ref: e.target.value })}
                        required
                        minLength={6}
                        placeholder="e.g. 415223344556"
                        autoFocus
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Payment date</label>
                      <input
                        type="date"
                        value={fixing.transaction_date}
                        onChange={(e) => setFixing({ ...fixing, transaction_date: e.target.value })}
                        required
                      />
                    </div>
                    <button className="btn btn-sm" disabled={busy}>{busy ? 'Submitting…' : 'Resubmit'}</button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setFixing(null); setFixError(''); }}>Cancel</button>
                    {fixError && <p className="error" style={{ width: '100%', margin: 0 }}>{fixError}</p>}
                  </form>
                ) : (
                  <button className="btn btn-sm" onClick={() => { setFixError(''); setFixing({ orderId: o.id, upi_ref: o.upi_ref, transaction_date: todayStr() }); }}>
                    Update transaction ID
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <Pager page={page} pageCount={pageCount} setPage={setPage} label={`${orders.length} orders`} />
        </>
      )}
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────

function Profile({ session }) {
  const [name, setName] = useState('');
  const [addresses, setAddresses] = useState([]);
  const [editing, setEditing] = useState(null); // { idx, address } — idx -1 for new
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '' });
  const [pwStatus, setPwStatus] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  async function changePw(e) {
    e.preventDefault();
    setPwStatus('');
    setPwBusy(true);
    const { ok, data } = await changePassword(pwForm.current, pwForm.next);
    setPwBusy(false);
    if (ok) {
      setPwForm({ current: '', next: '' });
      setPwStatus('saved');
    } else {
      setPwStatus(data.error || 'Could not change password');
    }
  }

  useEffect(() => {
    fetchProfile()
      .then((profile) => {
        if (profile) {
          setName(profile.name || '');
          setAddresses(profile.addresses || []);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function persist(nextName, nextAddresses) {
    setStatus('');
    setBusy(true);
    const { ok } = await saveProfile({ name: nextName, addresses: nextAddresses });
    setBusy(false);
    setStatus(ok ? 'saved' : 'error');
    return ok;
  }

  async function saveName(e) {
    e.preventDefault();
    await persist(name, addresses);
  }

  async function saveAddress(e) {
    e.preventDefault();
    const next = [...addresses];
    if (editing.idx === -1) next.push(editing.address);
    else next[editing.idx] = editing.address;
    if (await persist(name, next)) {
      setAddresses(next);
      setEditing(null);
    }
  }

  async function removeAddress(idx) {
    if (!window.confirm('Remove this address?')) return;
    const next = addresses.filter((_, i) => i !== idx);
    if (await persist(name, next)) setAddresses(next);
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1>My Profile</h1>
      {!loaded ? (
        <Spinner />
      ) : (
        <>
          <form onSubmit={saveName} className="card" style={{ marginBottom: 20 }}>
            <div className="field">
              <label>Email</label>
              <input value={session.email} disabled style={{ background: 'var(--foam)' }} />
            </div>
            <div className="field">
              <label>Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>

          <form onSubmit={changePw} className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>Change password</h2>
            <div className="field">
              <label>Current password *</label>
              <input
                type="password"
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>New password *</label>
              <input
                type="password"
                value={pwForm.next}
                onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                required
                minLength={6}
              />
            </div>
            <button className="btn" disabled={pwBusy}>{pwBusy ? 'Saving…' : 'Change password'}</button>
            {pwStatus === 'saved' && <p className="success">Password changed ✓</p>}
            {pwStatus && pwStatus !== 'saved' && <p className="error">{pwStatus}</p>}
          </form>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Saved addresses</h2>
            {addresses.length === 0 && !editing && (
              <p style={{ fontSize: 14, color: 'var(--slate)', marginBottom: 12 }}>No addresses saved yet.</p>
            )}
            {addresses.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--foam)' }}>
                <div style={{ flex: 1 }}>
                  <strong>{a.label || `Address ${i + 1}`}</strong>
                  <div style={{ fontSize: 13, color: 'var(--slate)' }}>
                    {[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).map((line, li) => <div key={li}>{line}</div>)}
                    {a.phone && <div>Phone: {a.phone}</div>}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ idx: i, address: { ...EMPTY_ADDRESS, ...a } })}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => removeAddress(i)}>Remove</button>
              </div>
            ))}

            {editing ? (
              <form onSubmit={saveAddress} style={{ marginTop: 16 }}>
                <h2 style={{ marginTop: 0, fontSize: 20 }}>{editing.idx === -1 ? 'New address' : 'Edit address'}</h2>
                <AddressForm address={editing.address} setAddress={(a) => setEditing({ ...editing, address: a })} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <button className="btn btn-sm btn-ghost" style={{ marginTop: 14 }} onClick={() => setEditing({ idx: -1, address: EMPTY_ADDRESS })}>
                + Add address
              </button>
            )}
            {status === 'saved' && <p className="success">Saved ✓</p>}
            {status === 'error' && <p className="error">Could not save</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ADMIN: PRODUCTS ──────────────────────────────────────────────────────────

const MAX_PRODUCT_PHOTOS = 3;

const EMPTY_DIMENSION = { label: '', price: '' };

const EMPTY_PRODUCT = {
  name: '', description: '', price: '', images: [], tags: '',
  customizable: false, custom_label: 'Your message', in_stock: true, featured: false,
  hasDimensions: false, dimensions: [],
};

const parseTags = (raw) =>
  [...new Set(String(raw).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);

// Every stored product photo is a pair: `thumb` (fixed 4:3 crop, fast-loading —
// shop cards, admin table) and `full` (the whole original, longest edge capped —
// product detail page / lightbox). Legacy products saved before this feature just
// have a single string per photo; toPhoto() normalizes either shape.
const PRODUCT_PHOTO_MAX_EDGE = 1600;
const CROP_OUT_W = 800, CROP_OUT_H = 600;
const CROP_VIEW_W = 320, CROP_VIEW_H = 240; // on-screen crop preview, always 4:3

const toPhoto = (img) => (typeof img === 'string' ? { thumb: img, full: img } : img);

function canvasToJpeg(draw, w, h, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'));
  return canvas.toDataURL('image/jpeg', quality);
}

// Drag-to-reposition cropper for one uploaded photo. Confirms with both a fixed-size
// crop (what the admin framed) and the full original (untouched, just downscaled).
const CROP_MAX_ZOOM = 3;

function ImageCropModal({ file, onConfirm, onCancel }) {
  const [img, setImg] = useState(null);
  const [url, setUrl] = useState('');
  const [baseScale, setBaseScale] = useState(1); // scale that exactly covers the crop frame
  const [zoom, setZoom] = useState(1); // >= 1, multiplies baseScale — zooming in frees up panning on both axes
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const dragRef = useRef(null);
  const scale = baseScale * zoom;

  useEffect(() => {
    let cancelled = false;
    setImg(null);
    setError('');
    setZoom(1);
    const objUrl = URL.createObjectURL(file);
    setUrl(objUrl);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const s = Math.max(CROP_VIEW_W / image.width, CROP_VIEW_H / image.height);
      setBaseScale(s);
      setOffset({
        x: Math.max(0, (image.width - CROP_VIEW_W / s) / 2),
        y: Math.max(0, (image.height - CROP_VIEW_H / s) / 2),
      });
      setImg(image);
    };
    image.onerror = () => { if (!cancelled) setError('Could not read that image'); };
    image.src = objUrl;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objUrl);
    };
  }, [file]);

  function clamp(o, s) {
    const maxX = Math.max(0, img.width - CROP_VIEW_W / s);
    const maxY = Math.max(0, img.height - CROP_VIEW_H / s);
    return { x: Math.min(Math.max(0, o.x), maxX), y: Math.min(Math.max(0, o.y), maxY) };
  }

  function onZoomChange(e) {
    const nextZoom = parseFloat(e.target.value);
    const nextScale = baseScale * nextZoom;
    setZoom(nextZoom);
    setOffset((o) => clamp(o, nextScale));
  }

  function onPointerDown(e) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current || !img) return;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    setOffset(clamp({ x: dragRef.current.offset.x - dx, y: dragRef.current.offset.y - dy }, scale));
  }
  function onPointerUp() { dragRef.current = null; }

  function confirm() {
    if (!img) return;
    const cropW = CROP_VIEW_W / scale, cropH = CROP_VIEW_H / scale;
    const thumb = canvasToJpeg(
      (ctx) => ctx.drawImage(img, offset.x, offset.y, cropW, cropH, 0, 0, CROP_OUT_W, CROP_OUT_H),
      CROP_OUT_W, CROP_OUT_H, 0.82
    );
    const fullScale = Math.min(1, PRODUCT_PHOTO_MAX_EDGE / Math.max(img.width, img.height));
    const fw = Math.round(img.width * fullScale), fh = Math.round(img.height * fullScale);
    const full = canvasToJpeg((ctx) => ctx.drawImage(img, 0, 0, fw, fh), fw, fh, 0.85);
    onConfirm({ thumb, full, cropped: true });
  }

  return (
    <Modal onClose={onCancel} maxWidth={400}>
      <h2 style={{ marginTop: 0 }}>Position photo</h2>
      <p style={{ fontSize: 13, color: 'var(--slate)', marginTop: -8 }}>
        Drag to choose what shows in the product card thumbnail. The full photo is kept too, for the product page.
      </p>
      {error && <p className="error">{error}</p>}
      {img ? (
        <>
          <div
            className="crop-viewport"
            style={{ width: CROP_VIEW_W, height: CROP_VIEW_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <img
              src={url}
              alt="Crop preview"
              draggable={false}
              style={{
                width: img.width * scale, height: img.height * scale,
                transform: `translate(${-offset.x * scale}px, ${-offset.y * scale}px)`,
              }}
            />
          </div>
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Zoom {zoom > 1 && '— drag to reposition sideways and up/down'}</label>
            <input type="range" min={1} max={CROP_MAX_ZOOM} step={0.01} value={zoom} onChange={onZoomChange} />
          </div>
        </>
      ) : !error && <Spinner />}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="button" className="btn btn-sm" disabled={!img} onClick={confirm}>Use this photo</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function Modal({ onClose, children, maxWidth = 560 }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const PRODUCT_SORT_DEFAULT_DIR = { rank: 'asc', name: 'asc', price_paise: 'desc', in_stock: 'desc', created_at: 'desc' };

function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });
  const [cropQueue, setCropQueue] = useState([]);

  const load = useCallback(() => {
    fetchProducts().then(setProducts);
  }, []);
  useEffect(load, [load]);

  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.includes(q))
    );
  });
  // "rank" is the shop's own display order (as fetched); every other column is a local view-only sort.
  const sorted = sort.key === 'rank' ? filtered : [...filtered].sort((a, b) => {
    const mul = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return a.name.localeCompare(b.name) * mul;
    if (sort.key === 'created_at') return ((a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)) * mul;
    if (sort.key === 'in_stock') return ((a.in_stock ? 1 : 0) - (b.in_stock ? 1 : 0)) * mul;
    return ((a[sort.key] || 0) - (b[sort.key] || 0)) * mul;
  });

  const productPage = usePager(sorted, 10);
  const canReorder = sort.key === 'rank' && !q;

  function exportCsv() {
    downloadFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, productsToCsv(sorted), 'text/csv');
  }

  // Reordering always operates on the full, unfiltered rank order (products), then
  // persists the whole new order in one call. Disabled while searching or view-sorted
  // by another column, since "up/down" wouldn't map onto a visible, contiguous list.
  async function persistOrder(nextProducts) {
    setProducts(nextProducts);
    await reorderProducts(nextProducts.map((p) => p.id));
  }
  function moveProduct(id, dir) {
    const idx = products.findIndex((p) => p.id === id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= products.length) return;
    const next = [...products];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    persistOrder(next);
  }

  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');

    let dimensions = [];
    let pricePaise;
    if (form.hasDimensions) {
      dimensions = form.dimensions.map((d) => ({
        label: d.label.trim(),
        price_paise: Math.round(parseFloat(d.price) * 100),
      }));
      if (dimensions.length === 0 || dimensions.some((d) => !d.label || !Number.isInteger(d.price_paise) || d.price_paise <= 0)) {
        setError('Give every size a name and a valid price');
        return;
      }
      const labels = new Set(dimensions.map((d) => d.label.toLowerCase()));
      if (labels.size !== dimensions.length) {
        setError('Size names must be unique');
        return;
      }
      pricePaise = Math.min(...dimensions.map((d) => d.price_paise));
    } else {
      pricePaise = Math.round(parseFloat(form.price) * 100);
      if (!Number.isInteger(pricePaise) || pricePaise <= 0) {
        setError('Enter a valid price in rupees');
        return;
      }
    }

    const body = {
      name: form.name,
      description: form.description,
      price_paise: pricePaise,
      images: form.images,
      image_url: form.images[0]?.thumb || '',
      thumb_url: form.images[0]?.cropped ? form.images[0].thumb : '',
      tags: parseTags(form.tags),
      customizable: form.customizable,
      custom_label: form.custom_label,
      in_stock: form.in_stock,
      featured: form.featured,
      dimensions,
    };
    setBusy(true);
    const { ok, data } = await saveProduct(body, editingId);
    setBusy(false);
    if (ok) {
      setForm(EMPTY_PRODUCT);
      setEditingId(null);
      setFormOpen(false);
      load();
    } else {
      setError(data.error || 'Save failed');
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setFormOpen(true);
    const dimensions = p.dimensions || [];
    const images = (p.images && p.images.length ? p.images : (p.image_url ? [p.image_url] : [])).map(toPhoto);
    // Re-mark the cover as "already cropped" only if it still matches the persisted
    // thumb_url — this is how a genuine crop survives round-tripping through the
    // backend (which strips the `cropped` flag before storing images).
    if (images[0] && p.thumb_url && images[0].thumb === p.thumb_url) {
      images[0] = { ...images[0], cropped: true };
    }
    setForm({
      name: p.name,
      description: p.description,
      price: String(p.price_paise / 100),
      images,
      tags: (p.tags || []).join(', '),
      customizable: p.customizable,
      custom_label: p.custom_label,
      in_stock: p.in_stock,
      featured: !!p.featured,
      hasDimensions: dimensions.length > 0,
      dimensions: dimensions.map((d) => ({ label: d.label, price: String(d.price_paise / 100) })),
    });
  }

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_PRODUCT);
    setError('');
    setFormOpen(true);
    setCropQueue([]);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_PRODUCT);
    setError('');
    setCropQueue([]);
  }

  async function remove(p) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    setBusy(true);
    await deleteProduct(p.id);
    setBusy(false);
    load();
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Admin · Products</h1>
        <button type="button" className="btn" onClick={openAddForm}>+ Add Product</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 18px' }}>
        <input
          type="search"
          className="shop-search"
          style={{ maxWidth: 420, flex: '1 1 320px' }}
          placeholder="Search by name, description or tag…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); productPage.setPage(0); }}
        />
        <button className="btn btn-sm btn-ghost" disabled={sorted.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
        <span style={{ fontSize: 13, color: 'var(--slate)' }}>{sorted.length} of {products.length} products</span>
      </div>
      {!canReorder && (
        <p style={{ fontSize: 12, color: 'var(--slate)', marginTop: -12, marginBottom: 18 }}>
          Clear the search and sort by Rank to reorder how products appear in the shop.
        </p>
      )}

      {formOpen && (
      <Modal onClose={closeForm}>
      <form onSubmit={save}>
        <h2 style={{ marginTop: 0 }}>{editingId ? 'Edit product' : 'Add product'}</h2>
        <div className="field"><label>Name *</label><input value={form.name} onChange={set('name')} required placeholder="e.g. Photo frame with custom name" /></div>
        <div className="field"><label>Description</label><textarea value={form.description} onChange={set('description')} rows={2} /></div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={form.hasDimensions}
            onChange={(e) => setForm((f) => ({
              ...f,
              hasDimensions: e.target.checked,
              dimensions: e.target.checked && f.dimensions.length === 0 ? [{ ...EMPTY_DIMENSION }] : f.dimensions,
            }))}
            id="hasDimensions"
            style={{ width: 'auto' }}
          />
          <label htmlFor="hasDimensions" style={{ cursor: 'pointer' }}>This product comes in multiple sizes, each with its own price</label>
        </div>
        {form.hasDimensions ? (
          <div className="field">
            <label>Sizes &amp; prices *</label>
            {form.dimensions.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="e.g. 8x10 inches"
                  value={d.label}
                  onChange={(e) => setForm((f) => {
                    const dimensions = [...f.dimensions];
                    dimensions[i] = { ...dimensions[i], label: e.target.value };
                    return { ...f, dimensions };
                  })}
                  style={{ flex: 2 }}
                />
                <input
                  type="number" step="0.01" min="0.01" placeholder="Price (₹)"
                  value={d.price}
                  onChange={(e) => setForm((f) => {
                    const dimensions = [...f.dimensions];
                    dimensions[i] = { ...dimensions[i], price: e.target.value };
                    return { ...f, dimensions };
                  })}
                  style={{ flex: 1 }}
                />
                <button
                  type="button" className="btn btn-sm btn-ghost"
                  onClick={() => setForm((f) => ({ ...f, dimensions: f.dimensions.filter((_, idx) => idx !== i) }))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button" className="btn btn-sm btn-ghost"
              onClick={() => setForm((f) => ({ ...f, dimensions: [...f.dimensions, { ...EMPTY_DIMENSION }] }))}
            >
              + Add another size
            </button>
          </div>
        ) : (
          <div className="field"><label>Price (₹) *</label><input type="number" step="0.01" min="0.01" value={form.price} onChange={set('price')} required /></div>
        )}
        <div className="field">
          <label>Tags (comma-separated)</label>
          <input value={form.tags} onChange={set('tags')} placeholder="e.g. birthday, anniversary, rakhi" />
          <span style={{ fontSize: 12, color: 'var(--slate)' }}>Customers can search and filter the shop by these</span>
        </div>
        <div className="field">
          <label>Product photos ({form.images.length}/{MAX_PRODUCT_PHOTOS})</label>
          {form.images.length > 0 && (
            <div className="photo-picker-grid">
              {form.images.map((img, i) => (
                <div key={i} className={i === 0 ? 'photo-thumb is-cover' : 'photo-thumb'}>
                  <img src={img.thumb} alt={`Photo ${i + 1}`} />
                  {i === 0 ? (
                    <span className="photo-cover-badge">Cover</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setForm((f) => {
                        const images = [...f.images];
                        const [chosen] = images.splice(i, 1);
                        images.unshift(chosen);
                        return { ...f, images };
                      })}
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setForm((f) => ({ ...f, images: f.images.filter((_, idx) => idx !== i) }))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {form.images.length < MAX_PRODUCT_PHOTOS && (
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []).slice(0, MAX_PRODUCT_PHOTOS - form.images.length);
                e.target.value = '';
                if (files.length === 0) return;
                setCropQueue((q) => [...q, ...files]);
              }}
            />
          )}
          <span style={{ fontSize: 12, color: 'var(--slate)' }}>
            Up to {MAX_PRODUCT_PHOTOS} photos. You'll position a crop for the card thumbnail; the full photo is kept too, for the product page. The first photo is the cover shown on product cards — use "Make cover" on any other photo to swap it.
          </span>
        </div>
        {cropQueue.length > 0 && (
          <ImageCropModal
            file={cropQueue[0]}
            onConfirm={(photo) => {
              setForm((f) => ({ ...f, images: [...f.images, photo].slice(0, MAX_PRODUCT_PHOTOS) }));
              setCropQueue((q) => q.slice(1));
            }}
            onCancel={() => setCropQueue((q) => q.slice(1))}
          />
        )}
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.customizable} onChange={set('customizable')} id="customizable" style={{ width: 'auto' }} />
          <label htmlFor="customizable" style={{ cursor: 'pointer' }}>Customer can add a personal message</label>
        </div>
        {form.customizable && (
          <div className="field"><label>Message prompt shown to customer</label><textarea rows={2} value={form.custom_label} onChange={set('custom_label')} placeholder="e.g. Name to engrave" /></div>
        )}
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.in_stock} onChange={set('in_stock')} id="in_stock" style={{ width: 'auto' }} />
          <label htmlFor="in_stock" style={{ cursor: 'pointer' }}>In stock</label>
        </div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.featured} onChange={set('featured')} id="featured" style={{ width: 'auto' }} />
          <label htmlFor="featured" style={{ cursor: 'pointer' }}>Show in Featured Keepsakes on home page</label>
        </div>
        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Update product' : 'Add product'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeForm}>
            Cancel
          </button>
        </div>
      </form>
      </Modal>
      )}

      <div className="table-wrap card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <SortTh label="Rank" sortKey="rank" sort={sort} setSort={setSort} sortDefaults={PRODUCT_SORT_DEFAULT_DIR} />
              <th>Image</th>
              <SortTh label="Name" sortKey="name" sort={sort} setSort={setSort} sortDefaults={PRODUCT_SORT_DEFAULT_DIR} />
              <SortTh label="Price" sortKey="price_paise" sort={sort} setSort={setSort} sortDefaults={PRODUCT_SORT_DEFAULT_DIR} />
              <th>Tags</th>
              <th>Custom</th>
              <SortTh label="Stock" sortKey="in_stock" sort={sort} setSort={setSort} sortDefaults={PRODUCT_SORT_DEFAULT_DIR} />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {productPage.slice.map((p) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" disabled={!canReorder} title="Move up" onClick={() => moveProduct(p.id, -1)}>▲</button>{' '}
                  <button className="btn btn-sm btn-ghost" disabled={!canReorder} title="Move down" onClick={() => moveProduct(p.id, 1)}>▼</button>
                </td>
                <td>
                  {p.thumb_url
                    ? <img src={p.thumb_url} alt="" style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 6 }} />
                    : '—'}
                </td>
                <td>{p.name}</td>
                <td>
                  {(p.dimensions || []).length > 0
                    ? <>{rupees(p.price_paise)}+ <span style={{ fontSize: 11, color: 'var(--slate)' }}>({p.dimensions.length} sizes)</span></>
                    : rupees(p.price_paise)}
                </td>
                <td>{(p.tags || []).join(', ') || '—'}</td>
                <td>{p.customizable ? `✓ (${p.custom_label})` : '—'}</td>
                <td>
                  <div>{p.in_stock ? <span className="badge badge-fulfilled">in stock</span> : <span className="badge badge-oos">out of stock</span>}</div>
                  {p.featured && <div style={{ marginTop: 4 }}><span className="badge badge-fulfilled">featured</span></div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => startEdit(p)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--slate)' }}>{products.length === 0 ? 'No products yet' : 'No products match your search'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={productPage.page} pageCount={productPage.pageCount} setPage={productPage.setPage} label={`${sorted.length} products`} />
    </div>
  );
}

// ─── ADMIN: ORDERS ────────────────────────────────────────────────────────────

const ORDER_CSV_COLUMNS = [
  'id', 'order_no', 'created_at', 'status', 'user_name', 'user_email', 'items_summary',
  'total_rupees', 'upi_ref', 'paid_at', 'courier', 'tracking_id', 'shipped_at', 'status_note', 'address',
];

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function addressToLines(a) {
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.state, a.pincode, a.phone && `Phone: ${a.phone}`]
    .filter(Boolean)
    .join('\n');
}

function ordersToCsv(orders) {
  const lines = [ORDER_CSV_COLUMNS.join(',')];
  for (const o of orders) {
    lines.push([
      o.id, o.order_no ?? '', o.created_at, o.status, o.user_name, o.user_email,
      o.items.map((i) => `${i.name}${i.dimension ? ` (Size: ${i.dimension})` : ''} x${i.qty}${i.message ? ` (${i.message})` : ''}`).join('; '),
      (o.total_paise / 100).toFixed(2), o.upi_ref, o.paid_at || '', o.courier || '', o.tracking_id || '', o.shipped_at || '', o.status_note || '',
      addressToLines(o.address),
    ].map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}

const PRODUCT_CSV_COLUMNS = [
  'id', 'name', 'description', 'price_rupees', 'sizes', 'tags',
  'customizable', 'custom_message_prompt', 'in_stock', 'featured', 'photo_count', 'created_at',
];

// Flat, spreadsheet-friendly export — no raw JSON or base64 image data, just readable text.
function productsToCsv(products) {
  const lines = [PRODUCT_CSV_COLUMNS.join(',')];
  for (const p of products) {
    const sizes = (p.dimensions || []).map((d) => `${d.label}: ${rupees(d.price_paise)}`).join('; ');
    const photoCount = (p.images && p.images.length) || (p.image_url ? 1 : 0);
    lines.push([
      p.id, p.name, p.description || '', (p.price_paise / 100).toFixed(2), sizes,
      (p.tags || []).join('; '),
      p.customizable ? 'Yes' : 'No', p.customizable ? (p.custom_label || '') : '',
      p.in_stock ? 'Yes' : 'No', p.featured ? 'Yes' : 'No', photoCount, p.created_at || '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}

function downloadFile(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function printAddress(o) {
  const win = window.open('', '_blank', 'width=420,height=560');
  if (!win) return;
  const lines = addressToLines(o.address).split('\n').filter(Boolean);
  win.document.write(`<!doctype html><html><head><title>Address — ${escapeHtml(o.order_no ? `#${o.order_no}` : o.id)}</title>
<style>
  body { font-family: sans-serif; padding: 32px; font-size: 16px; line-height: 1.5; color: #111; }
  .order-ref { font-size: 12px; color: #666; margin-bottom: 18px; }
  .name { font-weight: 700; font-size: 18px; margin-bottom: 8px; }
</style></head><body>
<div class="order-ref">Order ${escapeHtml(o.order_no ? `#${o.order_no}` : o.id)}</div>
<div class="name">${escapeHtml(o.user_name)}</div>
${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('\n')}
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    fetchAdminOrders(filter).then((list) => {
      setOrders(list);
      setSelected(new Set());
    });
  }, [filter]);
  useEffect(load, [load]);
  useEffect(() => { fetchProducts().then(setProducts).catch(() => {}); }, []);

  const { page, setPage, pageCount, slice } = usePager(orders, 10);
  useEffect(() => { setPage(0); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [shipping, setShipping] = useState(null); // { orderId, courier, tracking_id }
  const [shipError, setShipError] = useState('');
  const [busy, setBusy] = useState(false);

  async function setStatus(order, status, extra) {
    setBusy(true);
    const { ok, data } = await apiSetOrderStatus(order.id, status, extra);
    setBusy(false);
    if (!ok) {
      setShipError(data.error || 'Update failed');
      return;
    }
    setShipping(null);
    setShipError('');
    load();
  }

  function toggleSelected(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function exportCsv() {
    const label = filter === 'all' ? 'all' : filter;
    downloadFile(
      `orders-${label}-${new Date().toISOString().slice(0, 10)}.csv`,
      ordersToCsv(orders),
      'text/csv',
    );
  }

  async function removeOrders(ids) {
    if (ids.length === 0) return;
    const label = ids.length === 1 ? 'this order' : `${ids.length} orders`;
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone — export a CSV backup first if you need one.`)) return;
    setBusy(true);
    const { ok, data } = await deleteOrders(ids);
    setBusy(false);
    setNotice(ok
      ? `Deleted ${data.deleted} order(s).${data.skipped ? ` ${data.skipped} skipped (only fulfilled/cancelled orders can be deleted).` : ''}`
      : data.error || 'Delete failed');
    load();
  }

  // Only terminal-state orders (fulfilled/cancelled) can be deleted, so only they are selectable.
  const deletable = orders.filter((o) => TERMINAL_ORDER_STATUSES.includes(o.status));
  const allSelected = deletable.length > 0 && selected.size === deletable.length;

  return (
    <div className="page">
      <h1>Admin · Orders</h1>
      <div className="tabs" style={{ maxWidth: 900 }}>
        {[['pending', 'Pending'], ['payment_issue', 'Payment Issue'], ['shipped', 'Shipped'], ['fulfilled', 'Fulfilled'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([f, label]) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 18px' }}>
        <button className="btn btn-sm btn-ghost" disabled={busy || orders.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
        {deletable.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--slate)', cursor: 'pointer', marginLeft: 6 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(deletable.map((o) => o.id)))}
            />
            Select all deletable
          </label>
        )}
        {selected.size > 0 && (
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => removeOrders([...selected])}>
            Delete selected ({selected.size})
          </button>
        )}
      </div>
      {notice && <p className="success" style={{ marginTop: -8 }}>{notice}</p>}
      {orders.length === 0 ? (
        <p className="empty">No {filter === 'all' ? '' : filter} orders</p>
      ) : (
        <>
        {slice.map((o) => (
          <div key={o.id} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {TERMINAL_ORDER_STATUSES.includes(o.status) && (
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggleSelected(o.id)}
                  style={{ marginTop: 4 }}
                  aria-label="Select order for deletion"
                />
              )}
              <div>
                <strong>{o.user_name}</strong>{' '}
                <span style={{ color: 'var(--slate)', fontSize: 13 }}>({o.user_email})</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <dl className="order-details" style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="order-row">
                  <dt>Order ID:</dt>
                  <dd className="order-id">{o.order_no ? `#${o.order_no}` : o.id}</dd>
                </div>
                <div className="order-row">
                  <dt>Order date:</dt>
                  <dd>{new Date(o.created_at).toLocaleString('en-IN')}</dd>
                </div>
                {o.items.map((item, i) => {
                  const product = products.find((p) => p.id === item.productId);
                  return (
                    <div key={i} className="order-row">
                      <dt>Product:</dt>
                      <dd>
                        {item.name} × {item.qty}
                        {item.dimension && (
                          <div><span className="order-sublabel">Size:</span> {item.dimension}</div>
                        )}
                        {product && (
                          <div><a href={`#/product/${item.productId}`} className="link-btn">View product</a></div>
                        )}
                        {item.message && (
                          <div><span className="order-sublabel">Message:</span> <em style={{ color: 'var(--ocean)' }}>“{item.message}”</em></div>
                        )}
                      </dd>
                    </div>
                  );
                })}
                <div className="order-row">
                  <dt>Address:</dt>
                  <dd>
                    {[o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.pincode]
                      .filter(Boolean)
                      .map((line, i) => <div key={i}>{line}</div>)}
                    {o.address.phone && <div>Phone: {o.address.phone}</div>}
                  </dd>
                </div>
                <div className="order-row">
                  <dt>Transaction:</dt>
                  <dd><strong>{o.upi_ref}</strong></dd>
                </div>
                {o.paid_at && (
                  <div className="order-row">
                    <dt>Payment date:</dt>
                    <dd>{new Date(o.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
                  </div>
                )}
                {(o.status === 'shipped' || o.status === 'fulfilled') && o.courier && (
                  <div className="order-row">
                    <dt>Shipping:</dt>
                    <dd>
                      {o.courier} · Tracking ID: <strong>{o.tracking_id}</strong>
                      {o.shipped_at && (
                        <div>Shipped on {new Date(o.shipped_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      )}
                    </dd>
                  </div>
                )}
                {TERMINAL_ORDER_STATUSES.includes(o.status) && o.status_note && (
                  <div className="order-row">
                    <dt>Note:</dt>
                    <dd>{o.status_note}</dd>
                  </div>
                )}
                <div className="order-row">
                  <dt>Total:</dt>
                  <dd><strong style={{ color: 'var(--ocean)' }}>{rupees(o.total_paise)}</strong></dd>
                </div>
              </dl>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
                <span className={`badge badge-${o.status}`}>{o.status.replace('_', ' ')}</span>
                <OrderThumb item={o.items[0]} products={products} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(o.status === 'pending' || o.status === 'payment_issue') && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => printAddress(o)}>Print Address</button>
                )}
                {o.status === 'pending' && (
                  <>
                    <button className="btn btn-sm" disabled={busy} onClick={() => { setShipError(''); setShipping({ orderId: o.id, courier: 'Bluedart', tracking_id: '', shipped_date: todayStr() }); }}>
                      Mark shipped
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setStatus(o, 'payment_issue')}>
                      {busy ? 'Updating…' : 'Payment not received'}
                    </button>
                  </>
                )}
                {o.status === 'payment_issue' && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setStatus(o, 'pending')}>{busy ? 'Updating…' : 'Back to pending'}</button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => {
                      if (!window.confirm('Cancel this order?')) return;
                      setStatus(o, 'cancelled', { note: window.prompt('Reason for cancellation (optional):') || '' });
                    }}>
                      {busy ? 'Updating…' : 'Cancel order'}
                    </button>
                  </>
                )}
                {o.status === 'cancelled' && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setStatus(o, 'pending')}>{busy ? 'Updating…' : 'Back to pending'}</button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => removeOrders([o.id])}>
                      Delete
                    </button>
                  </>
                )}
                {o.status === 'shipped' && (
                  <>
                    <button className="btn btn-sm" disabled={busy} onClick={() => setStatus(o, 'fulfilled', { note: window.prompt('Add a note (optional):') || '' })}>{busy ? 'Updating…' : 'Mark fulfilled ✓'}</button>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setStatus(o, 'pending')}>{busy ? 'Updating…' : 'Back to pending'}</button>
                  </>
                )}
                {o.status === 'fulfilled' && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setStatus(o, 'shipped', { courier: o.courier || 'Bluedart', tracking_id: o.tracking_id || '-', shipped_date: o.shipped_at || todayStr() })}>
                      Back to shipped
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => removeOrders([o.id])}>
                      Delete
                    </button>
                  </>
                )}
              </span>
            </div>
            {shipping?.orderId === o.id && (
              <form
                className="ship-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStatus(o, 'shipped', { courier: shipping.courier, tracking_id: shipping.tracking_id, shipped_date: shipping.shipped_date });
                }}
              >
                <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                  <label>Courier</label>
                  <input value={shipping.courier} onChange={(e) => setShipping({ ...shipping, courier: e.target.value })} required placeholder="Bluedart" />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                  <label>Tracking ID</label>
                  <input value={shipping.tracking_id} onChange={(e) => setShipping({ ...shipping, tracking_id: e.target.value })} required placeholder="e.g. 69847712345" />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                  <label>Shipped date</label>
                  <input type="date" value={shipping.shipped_date} onChange={(e) => setShipping({ ...shipping, shipped_date: e.target.value })} required />
                </div>
                <button className="btn btn-sm" disabled={busy}>{busy ? 'Shipping…' : 'Ship'}</button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setShipping(null); setShipError(''); }}>Cancel</button>
                {shipError && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{shipError}</p>}
              </form>
            )}
          </div>
        ))}
        <Pager page={page} pageCount={pageCount} setPage={setPage} label={`${orders.length} orders`} />
        </>
      )}
    </div>
  );
}

// ─── ADMIN: REVIEWS ───────────────────────────────────────────────────────────

function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [filter, setFilter] = useState('pending');

  const load = useCallback(() => {
    fetchAdminReviews(filter).then(setReviews);
  }, [filter]);
  useEffect(load, [load]);

  const [busy, setBusy] = useState(false);

  const { page, setPage, pageCount, slice } = usePager(reviews, 10);
  useEffect(() => { setPage(0); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(review, changes) {
    setBusy(true);
    await updateReview(review.id, changes);
    setBusy(false);
    load();
  }

  async function remove(review) {
    if (!window.confirm(`Delete this review by ${review.user_name}?`)) return;
    setBusy(true);
    await deleteReview(review.id);
    setBusy(false);
    load();
  }

  return (
    <div className="page">
      <h1>Admin · Reviews</h1>
      <div className="tabs" style={{ maxWidth: 420 }}>
        {['pending', 'approved', 'all'].map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {reviews.length === 0 ? (
        <p className="empty">No {filter === 'all' ? '' : filter} reviews</p>
      ) : (
        <>
        {slice.map((r) => (
          <div key={r.id} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {r.product_id && (
                  r.product_image ? (
                    <img className="order-item-thumb" src={r.product_image} alt={r.product_name} />
                  ) : (
                    <div className="order-item-thumb img-placeholder">{BRAND_INITIALS}</div>
                  )
                )}
                <div>
                  <strong>{r.user_name}</strong>{' '}
                  <span style={{ color: 'var(--slate)', fontSize: 13 }}>
                    on {r.product_id ? <a href={`#/product/${r.product_id}`}>{r.product_name}</a> : r.product_name}
                  </span>
                  <div style={{ fontSize: 13, color: 'var(--slate)' }}>
                    Review date: {new Date(r.created_at).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Stars value={r.rating} />
                <span className={`badge badge-${r.status === 'approved' ? 'fulfilled' : 'pending'}`}>{r.status}</span>
                {r.featured && <span className="badge badge-featured">featured</span>}
              </div>
            </div>
            {r.text && <p style={{ margin: '10px 0', fontSize: 14, lineHeight: 1.55 }}>{r.text}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {r.status === 'pending' ? (
                <button className="btn btn-sm" disabled={busy} onClick={() => patch(r, { status: 'approved' })}>Approve</button>
              ) : (
                <>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => patch(r, { status: 'pending' })}>Unapprove</button>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => patch(r, { featured: !r.featured })}>
                    {r.featured ? 'Remove from home page' : 'Feature on home page ★'}
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove(r)}>Delete</button>
            </div>
          </div>
        ))}
        <Pager page={page} pageCount={pageCount} setPage={setPage} label={`${reviews.length} reviews`} />
        </>
      )}
    </div>
  );
}

// ─── ADMIN: USERS ─────────────────────────────────────────────────────────────

// While impersonating, the admin's own token is parked here so they can return.
const ADMIN_TOKEN_BACKUP_KEY = 'moment-kart-admin-token';

async function startImpersonation(email) {
  const token = await impersonateUser(email);
  if (!token) return false;
  localStorage.setItem(ADMIN_TOKEN_BACKUP_KEY, localStorage.getItem(AUTH_KEY) || '');
  localStorage.setItem(AUTH_KEY, token);
  window.location.hash = '#/shop';
  window.location.reload();
  return true;
}

function stopImpersonation() {
  const adminToken = localStorage.getItem(ADMIN_TOKEN_BACKUP_KEY);
  localStorage.removeItem(ADMIN_TOKEN_BACKUP_KEY);
  if (adminToken) localStorage.setItem(AUTH_KEY, adminToken);
  window.location.hash = '#/admin/users';
  window.location.reload();
}

// Numeric columns default to descending (highest first); text/date columns default to ascending.
const USER_SORT_DEFAULT_DIR = { name: 'asc', created_at: 'desc', order_count: 'desc', spent_paise: 'desc', last_login: 'desc' };

function SortTh({ label, sortKey, sort, setSort, sortDefaults = USER_SORT_DEFAULT_DIR }) {
  const active = sort.key === sortKey;
  return (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => setSort(active
        ? { key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key: sortKey, dir: sortDefaults[sortKey] || 'asc' })}
    >
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function AdminUsers({ session }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [impersonating, setImpersonating] = useState(null); // email currently being impersonated

  useEffect(() => {
    fetchAdminUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const sortedUsers = [...(users || [])].sort((a, b) => {
    const mul = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return a.name.localeCompare(b.name) * mul;
    if (sort.key === 'created_at' || sort.key === 'last_login') {
      const av = a[sort.key] ? new Date(a[sort.key]).getTime() : 0;
      const bv = b[sort.key] ? new Date(b[sort.key]).getTime() : 0;
      return (av - bv) * mul;
    }
    return ((a[sort.key] || 0) - (b[sort.key] || 0)) * mul;
  });

  const { page, setPage, pageCount, slice } = usePager(sortedUsers, 10);

  async function impersonate(u) {
    setError('');
    setImpersonating(u.email);
    if (!(await startImpersonation(u.email))) {
      setError(`Could not impersonate ${u.email}`);
      setImpersonating(null);
    }
  }

  return (
    <div className="page">
      <h1>Admin · Users</h1>
      {error && <p className="error">{error}</p>}
      {users === null ? (
        <Spinner />
      ) : users.length === 0 ? (
        <p className="empty">No registered users yet.</p>
      ) : (
        <>
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <SortTh label="Name" sortKey="name" sort={sort} setSort={setSort} />
                <th>Email</th>
                <th>Verified</th>
                <SortTh label="Joined" sortKey="created_at" sort={sort} setSort={setSort} />
                <SortTh label="Last login" sortKey="last_login" sort={sort} setSort={setSort} />
                <SortTh label="Orders" sortKey="order_count" sort={sort} setSort={setSort} />
                <SortTh label="Total spent" sortKey="spent_paise" sort={sort} setSort={setSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((u) => (
                <tr key={u.email}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.verified ? <span className="badge badge-fulfilled">verified</span> : <span className="badge badge-pending">pending</span>}</td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td>{u.order_count}</td>
                  <td>{u.spent_paise > 0 ? rupees(u.spent_paise) : '—'}</td>
                  <td>
                    {u.email !== session?.email && (
                      <button className="btn btn-sm btn-ghost" disabled={!!impersonating} onClick={() => impersonate(u)}>
                        {impersonating === u.email ? 'Switching…' : 'Impersonate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageCount={pageCount} setPage={setPage} label={`${users.length} users`} />
        </>
      )}
    </div>
  );
}

// ─── ADMIN: MARKETING ─────────────────────────────────────────────────────────

function AdminMarketing() {
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState(() => new Set());
  const [selectedProducts, setSelectedProducts] = useState(() => new Set());
  const [productQuery, setProductQuery] = useState('');
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });

  useEffect(() => {
    fetchAdminUsers().then(setUsers).catch(() => setUsers([]));
    fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const q = userQuery.trim().toLowerCase();
  const filteredUsers = users
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .sort((a, b) => {
      const mul = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'name') return a.name.localeCompare(b.name) * mul;
      if (sort.key === 'created_at' || sort.key === 'last_login') {
        const av = a[sort.key] ? new Date(a[sort.key]).getTime() : 0;
        const bv = b[sort.key] ? new Date(b[sort.key]).getTime() : 0;
        return (av - bv) * mul;
      }
      return ((a[sort.key] || 0) - (b[sort.key] || 0)) * mul;
    });

  const { page: userPage, setPage: setUserPage, pageCount: userPageCount, slice: userSlice } = usePager(filteredUsers, 10);

  function toggleUser(email) {
    const next = new Set(selectedUsers);
    if (next.has(email)) next.delete(email); else next.add(email);
    setSelectedUsers(next);
  }

  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedUsers.has(u.email));

  function toggleSelectAllFiltered() {
    const next = new Set(selectedUsers);
    if (allFilteredSelected) filteredUsers.forEach((u) => next.delete(u.email));
    else filteredUsers.forEach((u) => next.add(u.email));
    setSelectedUsers(next);
  }

  async function send(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (selectedUsers.size === 0) { setError('Select at least one recipient'); return; }
    if (!subject.trim() || !message.trim()) { setError('Subject and message are required'); return; }
    if (!window.confirm(`Send this email to ${selectedUsers.size} customer(s)?`)) return;
    setBusy(true);
    const { ok, data } = await sendMarketingEmail({
      userEmails: [...selectedUsers],
      productIds: [...selectedProducts],
      subject: subject.trim(),
      message: message.trim(),
    });
    setBusy(false);
    if (ok) {
      setNotice(`Sent to ${data.sent} of ${data.total} recipient(s).${data.failed ? ` ${data.failed} failed.` : ''}`);
    } else {
      setError(data.error || 'Could not send campaign');
    }
  }

  return (
    <div className="page">
      <h1>Admin · Marketing</h1>
      <p style={{ color: 'var(--slate)', marginTop: -18, marginBottom: 24 }}>
        Send a festival or event offer email to selected customers, featuring selected products.
      </p>

      <form onSubmit={send}>
        <h2 style={{ marginTop: 0 }}>1. Recipients</h2>
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input
              type="search"
              className="shop-search"
              style={{ maxWidth: 280 }}
              placeholder="Search by name or email…"
              value={userQuery}
              onChange={(e) => { setUserQuery(e.target.value); setUserPage(0); }}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={toggleSelectAllFiltered}>
              {allFilteredSelected ? 'Unselect all' : 'Select all'}{userQuery ? ' (filtered)' : ''}
            </button>
            <span style={{ fontSize: 13, color: 'var(--slate)' }}>{selectedUsers.size} selected</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <SortTh label="Name" sortKey="name" sort={sort} setSort={setSort} />
                  <th>Email</th>
                  <SortTh label="Last login" sortKey="last_login" sort={sort} setSort={setSort} />
                  <SortTh label="Orders" sortKey="order_count" sort={sort} setSort={setSort} />
                  <SortTh label="Total spent" sortKey="spent_paise" sort={sort} setSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {userSlice.map((u) => (
                  <tr key={u.email}>
                    <td><input type="checkbox" checked={selectedUsers.has(u.email)} onChange={() => toggleUser(u.email)} /></td>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.last_login ? new Date(u.last_login).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>{u.order_count}</td>
                    <td>{u.spent_paise > 0 ? rupees(u.spent_paise) : '—'}</td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--slate)' }}>No users match</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={userPage} pageCount={userPageCount} setPage={setUserPage} label={`${filteredUsers.length} users`} />
        </div>

        <h2>2. Products to feature</h2>
        <div className="card" style={{ marginBottom: 24 }}>
          {products.length === 0 ? <p className="empty">No products yet</p> : (
            <div className="field" style={{ marginBottom: 0, position: 'relative' }}>
              <label>Products ({selectedProducts.size} selected)</label>
              <input
                type="text"
                placeholder="Search and add a product…"
                value={productQuery}
                onChange={(e) => { setProductQuery(e.target.value); setProductDropdownOpen(true); }}
                onFocus={() => setProductDropdownOpen(true)}
                onBlur={() => setTimeout(() => setProductDropdownOpen(false), 150)}
              />
              {productDropdownOpen && (() => {
                const q = productQuery.trim().toLowerCase();
                const options = products
                  .filter((p) => !selectedProducts.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
                  .slice(0, 30);
                return (
                  <div className="dropdown-panel">
                    {options.length === 0 ? (
                      <div className="dropdown-empty">No matching products</div>
                    ) : options.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="dropdown-option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedProducts((s) => new Set(s).add(p.id));
                          setProductQuery('');
                        }}
                      >
                        {p.name} — {rupees(p.price_paise)}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {selectedProducts.size > 0 && (
                <div className="size-chips" style={{ marginTop: 10 }}>
                  {products.filter((p) => selectedProducts.has(p.id)).map((p) => (
                    <span key={p.id} className="size-chip" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      <button
                        type="button"
                        onClick={() => setSelectedProducts((s) => { const next = new Set(s); next.delete(p.id); return next; })}
                        aria-label={`Remove ${p.name}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <h2>3. Message</h2>
        <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="field">
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Diwali Dhamaka — 20% off this week!" maxLength={150} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Message</label>
            <textarea
              className="review-input"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
              placeholder="Write your festive offer message here…"
            />
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {notice && <p className="success">{notice}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Sending…' : `Send to ${selectedUsers.size} customer(s)`}</button>
      </form>
    </div>
  );
}

// ─── USER MENU ────────────────────────────────────────────────────────────────

function UserMenu({ session, onLogout, route }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="user-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={open || route === '/profile' ? 'user-menu-btn open' : 'user-menu-btn'}
        onClick={() => setOpen(!open)}
      >
        {session.name || 'Account'} <span className="chevron">▾</span>
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <a href="#/profile" onClick={() => setOpen(false)}>My Profile</a>
          {!session.admin && <a href="#/orders" onClick={() => setOpen(false)}>My Orders</a>}
          <button type="button" onClick={() => { setOpen(false); onLogout(); }}>Logout</button>
        </div>
      )}
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(getSession);
  const [cart, setCartState] = useState(loadCart);
  const [products, setProducts] = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  useEffect(() => {
    document.title = `${APP_NAME} — Souvenirs that flow with your memories`;
  }, []);

  // Reload the catalog on navigation so admin edits show up in the shop right away.
  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => {}).finally(() => setProductsLoaded(true));
  }, [route]);

  const setCart = (next) => {
    setCartState(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
  };

  function addToCart(product, message, dimension) {
    const price_paise = dimension ? dimension.price_paise : product.price_paise;
    const dimLabel = dimension ? dimension.label : null;
    const existing = cart.findIndex(
      (i) => i.productId === product.id && (i.message || '') === (message || '') && (i.dimension || null) === dimLabel
    );
    if (existing >= 0) {
      const next = [...cart];
      next[existing] = { ...next[existing], qty: Math.min(20, next[existing].qty + 1) };
      setCart(next);
    } else {
      setCart([
        ...cart,
        { productId: product.id, name: product.name, price_paise, dimension: dimLabel, qty: 1, message: message || '' },
      ]);
    }
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(ADMIN_TOKEN_BACKUP_KEY);
    setSession(null);
    go('/');
  }

  const impersonating = !!session && !session.admin && !!localStorage.getItem(ADMIN_TOKEN_BACKUP_KEY);

  const cartCount = cart.reduce((n, i) => n + i.qty, 0);
  const needsAuth = ['/checkout', '/orders', '/profile'].includes(route) || route.startsWith('/admin');

  let content;
  if (route === '/auth' || (needsAuth && !session)) {
    content = <AuthPage onLogin={() => { setSession(getSession()); go('/shop'); }} />;
  } else if (route === '/shop') {
    // The admin manages the shop but doesn't buy from it — no cart. Use
    // "Impersonate" on Admin · Users to act on a customer's behalf.
    content = <Shop products={products} loading={!productsLoaded} onAdd={session?.admin ? undefined : addToCart} />;
  } else if (route.startsWith('/product/')) {
    content = (
      <ProductDetails
        id={route.slice('/product/'.length)}
        products={products}
        onAdd={session?.admin ? undefined : addToCart}
        session={session}
      />
    );
  } else if (route === '/cart' && !session?.admin) {
    content = <Cart cart={cart} setCart={setCart} session={session} />;
  } else if (route === '/checkout' && !session?.admin) {
    content = <Checkout cart={cart} setCart={setCart} />;
  } else if (route === '/orders') {
    content = <MyOrders />;
  } else if (route === '/profile') {
    content = <Profile session={session} />;
  } else if (route === '/admin/products' && session?.admin) {
    content = <AdminProducts />;
  } else if (route === '/admin/orders' && session?.admin) {
    content = <AdminOrders />;
  } else if (route === '/admin/reviews' && session?.admin) {
    content = <AdminReviews />;
  } else if (route === '/admin/users' && session?.admin) {
    content = <AdminUsers session={session} />;
  } else if (route === '/admin/marketing' && session?.admin) {
    content = <AdminMarketing />;
  } else {
    content = <Landing products={products} loading={!productsLoaded} />;
  }

  const link = (path, label) => (
    <a href={'#' + path} className={route === path ? 'active' : ''}>{label}</a>
  );

  return (
    <>
      {impersonating && (
        <div className="impersonation-bar">
          👁 Viewing as <strong>{session.name} ({session.email})</strong>
          <button type="button" onClick={stopImpersonation}>Stop Impersonation</button>
        </div>
      )}
      <nav className="nav">
        <a href="#/" className="brand">{BRAND_FIRST}{BRAND_REST && <> <em>{BRAND_REST}</em></>}</a>
        {link('/shop', 'Shop')}
        {!session?.admin && (
          <a href="#/cart" className={route === '/cart' ? 'active' : ''}>
            Cart{cartCount > 0 && <span className="cart-count">{cartCount}</span>}
          </a>
        )}
        {session?.admin && <span className="nav-sep" />}
        {session?.admin && link('/admin/products', 'Products')}
        {session?.admin && link('/admin/orders', 'Orders')}
        {session?.admin && link('/admin/reviews', 'Reviews')}
        {session?.admin && link('/admin/users', 'Users')}
        {session?.admin && link('/admin/marketing', 'Marketing')}
        <span className="nav-sep" />
        {session ? (
          <UserMenu session={session} onLogout={logout} route={route} />
        ) : (
          link('/auth', 'Login')
        )}
      </nav>
      {content}
    </>
  );
}
