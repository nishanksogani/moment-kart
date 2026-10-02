# Release changes — 3 October 2026

The requested fixes are implemented locally. The production site has not been deployed or modified. The initial project review remains in `RELEASE_READINESS.md` as a historical snapshot.

## Implemented

- Durable, atomic email-scoped authentication limits: three submissions in a fixed ten-minute window by default. Separate login, OTP checking and OTP sending buckets. Configure `AUTH_MAX_ATTEMPTS` and `AUTH_WINDOW_MINUTES`; invalid values use defaults. Successful submissions also count. New codes do not replenish checking attempts. Exhaustion returns HTTP 429 and `Retry-After`.
- OTPs are keyed hashes, purpose-bound to verification or reset, expire in ten minutes and are consumed atomically once. Production logs do not contain codes. Production signing requires `AUTH_SECRET`.
- Checkout obtains current catalog/size prices and availability before generating a payment QR. The signed quote pins items, amount, user and recipient for thirty minutes. Missing payee, failed pricing or unavailable stock blocks payment. Tampered/expired quotes are rejected. Quote-based order retries reuse one order; a profile-save failure cannot undo order success. Payment reconciliation remains manual.
- Working shipping, returns, privacy and terms routes. Dispatch is 10–15 days after payment confirmation and receipt of details; shipping is included. Existing 2–5 day delivery estimate and seven-day damaged/defective reporting policy are retained. `SUPPORT_EMAIL` and `SUPPORT_WHATSAPP` use the existing values when absent.
- HTTP/read failures appear as visible errors, catalog failures have retry controls, and a React error boundary handles rendering failures. Inline form errors are announced as alerts.
- Updated Nodemailer, Vite and the React plugin and refreshed transitive dependencies. Connected registry audit reports zero vulnerabilities; Node 22.12+ is required.
- Keyboard-accessible ratings/gallery, named quantity and form controls, modal focus trapping/restoration and Escape handling, skip link/main landmark, visible focus styles, improved muted-text contrast and mobile toast clearance.
- Public catalog listing excludes embedded full images. Detail and listing responses reference separately cached binary image endpoints; full images load when needed. Public product media remains crawlable. Storage remains in Postgres; object storage migration is still an operational improvement.
- History API routes such as `/shop` and `/product/1`, with legacy `#/...` links converted in place. Vercel serves direct routes and `/sitemap.xml`; sitemap/robots use `SITE_URL` and the current deployed host by default. Added canonical links, product structured data, private-route noindex and a real SVG favicon. Login preserves checkout intent.

## Configuration and rollout

Use `.env.example` and the README environment table. Configure a strong `AUTH_SECRET`, Neon `DATABASE_URL`, the real `ADMIN_UPI_ID`, admin credentials and Gmail SMTP credentials. Public contact/domain/brand changes require a rebuild. Set `SITE_URL` consistently for build and runtime; adding a custom domain also requires its Vercel/DNS setup.

The existing `ensureSchema()` mechanism adds `verification_codes.purpose`, the `auth_attempts` table, `orders.checkout_key` with a unique index, and `products.updated_at`. Back up the database and validate these additive changes on staging before rollout. Old pending plaintext OTPs will not validate after deployment; users must request new codes. Existing orders remain readable. An old checkout tab must reload to obtain a signed quote.

Support defaults are preserved as requested, including the existing placeholder WhatsApp number. Set real support details before public launch. Review the policy content against actual operations and add the business identity/contact details required for the shop.

## Verification

- `npm test`: 16 passing Node regression tests covering limits/configuration, endpoint exhaustion, OTP purpose/reuse, prices/variants/stock/cart bounds, quote tampering/expiry/ownership, retry-safe order creation, catalog/media delivery, legacy routing and signing-secret requirements.
- `npm run build`: production build passes on Node 24 / Vite 8.3.2; JavaScript about 278 kB, 84 kB gzip, excluding catalog media.
- Connected dependency install/audit: zero vulnerabilities.
- Local browser checks: all four policy links and page titles, 390px mobile layout without horizontal overflow, legacy-link conversion, fourth-login lockout, direct product refresh, keyboard gallery opening, Tab trap, Escape and focus restoration. A synthetic cart cached at ₹200 was re-priced to ₹500 before creating its UPI URI; out-of-stock pricing showed an error and disabled checkout. No payment, real account, production database or email was used for these checks.
- Backend tests use SQL adapters. Production Neon migrations/concurrency, Gmail delivery and deployed rewrite behavior need staging verification.

## Remaining gates before public orders

1. Verify real payee, contacts, SMTP, canonical domain and production environment. Exercise signup/verify/reset, quote checkout, duplicate retry, payment reconciliation and shipping notification against a staging database.
2. Resolve the initial review's admin-identity/recovery overlap and session revocation after password/privilege changes. The requested attempt limiting reduces guessing but does not resolve these separate account-lifecycle concerns.
3. Strengthen shipping/address/date validation, define duplicate-UTR review and order transition/refund rules, and verify cross-user authorization end to end.
4. Establish database/media backup restoration, versioned migrations, alerts and rollback. Verify SMTP failure reporting and marketing consent/unsubscribe before using campaigns.
5. Add CI with these checks and authenticated browser tests. For social previews and crawlers that do not execute JavaScript, add server-rendered or prerendered per-product metadata; clean URLs alone do not provide that rendering.

These remaining gates are from the broader project review and have not been represented as completed by this change.
