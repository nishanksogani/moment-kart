# Lagom.Dezign release readiness

This is the initial review snapshot. Subsequent implementation resolves several findings below, including attempt limits, signed checkout quotes, policy pages, API errors, dependencies, image delivery and routing. See [RELEASE_CHANGES.md](RELEASE_CHANGES.md) for the current state and remaining launch gates.

Reviewed 3 October 2026. Scope: all application and API modules, styles, configuration, documentation, dependency lockfile, and read-only inspection of https://lagom-dezign.vercel.app/#/. Recommendation: finish the blockers below before accepting public orders.

## Current state

This is a React 18 / Vite SPA with hash routing, Vercel serverless endpoints, Neon Postgres, Gmail SMTP through Nodemailer, and QR-code generation for manual UPI payments. Most UI lives in `src/App.jsx`; `src/api.js` switches between production APIs and a separate localStorage simulation in development.

The customer experience includes a landing page, image carousel, featured products and reviews, a searchable/tag-filtered catalog, product sizes, personalisation, gallery/lightbox, cart, account signup/verification/login/password recovery, saved addresses, checkout, and order tracking/payment resubmission. The live shop displayed 22 products during inspection.

Admin features include catalog editing, photo cropping, variants, featured flags, ordering, order status updates, shipping emails, address printing, CSV exports, review moderation, customer activity, impersonation, and marketing emails. These exist in code; authenticated production workflows were not exercised.

Useful existing safeguards: passwords use salted scrypt, tokens have HMAC signatures, SQL values are parameterized, protected endpoints check roles/ownership, and order prices are recomputed from the catalog on the server. Reviews require approval. Customer-supplied UTRs leave orders pending rather than proving payment.

## Changes completed in this review

- Breadcrumbs now share the shop's 1080px content width and the product page's 1140px width and use the existing pastel theme. Added a home icon, chevrons, a subtle divider, a tinted current-page pill, keyboard focus indication, and wrapping for long product names.
- Removed the redundant Home-only breadcrumb above the landing hero.
- Breadcrumb structured-data links now point to the actual hash routes instead of erroneous double-slash path URLs. This corrects the local inconsistency but does not solve hash routing's search limitations.
- Fixed product detail hook ordering: metadata hooks now run on every render, including the catalog-loading render. A fresh product-page reload on the deployed site reproduced React error #310; local reloads with the fix rendered normally.
- Missing products now use the explicit catalog-loading state instead of spinning forever when the loaded catalog is empty.

These changes are local and have not been deployed.

## Must resolve before accepting public orders

| Priority | Finding and evidence | Required outcome |
| --- | --- | --- |
| P0 | `api/_auth.js` falls back to a publicly known signing secret when `AUTH_SECRET` is absent. README incorrectly implies the variable is automatically supplied. Deployment values were not inspected. | Fail closed outside development unless a strong secret is present; verify production configuration. Add a test showing an absent secret cannot produce/accept a token. |
| P0 | `api/auth.js` has no application-level login/OTP attempt limit or resend cooldown. Codes are plaintext in the database and logged alongside emails. Signup verification and password resets share the same code record without a purpose. | Add durable rate limits across serverless instances, bounded attempts and resend cooldowns; hash codes, bind them to a purpose, consume them atomically, and remove production OTP logging. Verify any platform-level protections separately. |
| P0 | Admin role is derived solely from email. Public signup/reset/verify and normal database-password login can operate on the admin email, alongside `ADMIN_PASSWORD`. Existing tokens survive password changes/resets for up to 90 days. | Reserve the admin identity and define one controlled login/recovery mechanism; reconcile database and environment passwords; revoke sessions on password reset/change and privilege changes. Shorten sensitive admin sessions. |
| P0 | Checkout requests a UPI payment using cached cart prices, but `api/orders.js` recomputes potentially different current prices only after payment. The payee silently defaults to `momentkart@upi`. | Obtain a server-priced order/quote before payment, pin the amount and cart, handle price/stock changes before asking for money, and disable checkout if the real payee is unconfigured. Confirm the deployed QR/payee and reconciliation procedure. |
| P0 | Order creation has no idempotency key or UTR-reuse checks. Order insertion and profile-address saving are separate writes; a later failure can return 500 after creating the order, inviting a duplicate retry. | Make creation retry-safe, preserve order success if ancillary profile saving fails, and define duplicate-payment review rules. Keep manual verification unless a verified payment integration is deliberately added. |
| P1 | WhatsApp is hard-coded as `919000000000`, including structured data. Email/Instagram ownership was not verified. Shipping/returns footer links both lead to the shop. | Set verified support contacts; provide working shipping, return/refund, privacy, and terms pages with real business details and operational policies. Confirm lead times, shipping charges, delivery coverage, cancellations, and refund handling with the business owner. |
| P1 | Address validation checks only truthy line1/city/pincode on the server. Recipient name is inferred from account name; phone/state are optional. Quantities are silently clamped and total size is unbounded. | Validate and normalize shipping/contact data, IDs, item counts, quantity, date, and string lengths server-side. Collect the courier-required recipient details and reject invalid values explicitly. |
| P1 | List reads often turn API failures into empty lists; `fetchProducts()` does not check HTTP status or response shape. Catalog failure can look like an empty shop or cause array-operation crashes. There is no React error boundary. | Distinguish loading/empty/error states, validate responses, offer retries, and add an error boundary. Handle expiry and network failures without losing cart intent. |
| P1 | Build/development and production use different data/auth/email paths. No test or lint scripts, test suite, or CI workflow is present. | Add production-API integration tests with an isolated database and SMTP test transport, browser tests of critical flows, React hook linting, and CI build/security checks. A development UI success does not validate the backend. |
| P1 | Registry audit reports seven vulnerable packages: five high, two moderate, including runtime Nodemailer and development/build Vite, esbuild, PostCSS, nanoid, Browserslist, and baseline-browser-mapping. | Upgrade affected dependencies in a reviewed change, rerun the connected registry audit, build, and API/email tests. Audit severity alone does not establish exploitability in this deployment. |
| P1 | Images are stored as base64 content in product fields; the public catalog returns all full images and thumbnails, even though only 12 cards are displayed. `ensureSchema()` runs many DDL statements per cold instance and drops legacy columns. | Measure real catalog payloads and DB usage, move media to object storage/CDN, return lightweight listing data, and move schema changes into versioned deployment migrations. Establish full database/media backups and test restoration. |

## Complete for a polished public launch

| Area | Remaining work |
| --- | --- |
| Search and sharing | Replace hash routes with crawlable paths for shop/products; serve product-specific metadata through rendering/prerendering as needed. `api/sitemap.js` defaults to the old `moment-kart.vercel.app` host and its comment says `/sitemap.xml` without a matching rewrite. `robots.txt` also uses the old host. Correct both, remove auth from public sitemap, add canonical/social metadata and Product structured data, and replace the schema image `/favicon.ico` that does not exist in this repo. Google recommends History API routes rather than fragment-based content: [Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics). |
| Purchase continuity | After login the app always redirects to `/shop`; return checkout users to their intended destination. Shop cards can add customizable products with an empty message; route those products through personalisation if required. Reset product message state when navigating between products. Add order receipts/acknowledgements and clear payment-pending wording. |
| Accessibility | Associate form labels with inputs; make star rating controls and gallery openers keyboard accessible; give quantity controls names. Implement modal focus trapping/restoration, dialog semantics, menu state announcements, a main landmark, and a skip link. Verify contrast and mobile toast/sticky-action overlap. |
| Order operations | API status updates accept any allowed destination without enforcing a transition graph or checking affected rows. The UI reopens terminal orders, despite comments describing them as terminal. Define allowed reversals, audit actor/history, payment confirmation, refunds, and customer notification expectations. |
| Email | Verify sender credentials and actual delivery in staging; add retries/queueing and visibility into failures. Shipped-order code logs success even when `sendShippedEmail()` returns `{sent:false}`. Marketing sends synchronously, with no opt-in/unsubscribe model or suppression list. Define permission/preferences before activating campaigns. |
| Reviews and customer activity | Add abuse controls/deduplication for reviews and decide whether purchase verification is needed. Spend calculations include cancelled and unpaid orders; define revenue separately from placed-order totals. Record impersonation provenance on subsequent actions, rather than only the initial token issuance. |
| Recovery and exports | CSV exports are reports, not restorable backups: product photos and password/account data are excluded and no import path exists despite README mentioning import. Escape spreadsheet formula-leading values before exporting untrusted customer text. Document retention and recovery before deleting orders. |
| Brand and media | Email styling still uses the older ocean palette; favicon is a wave emoji. Review photography, crop coverage, product copy, care instructions, prices, and actual personalisation options. Carousel filenames use `sku_` and do not meet its product-link matching convention. |
| Maintainability and operations | Split the large application module into routes/components/services; centralize site/contact config and API error handling. Add environment validation, an example env file, runtime/version expectations, deployment smoke checks, error alerts, uptime monitoring, and rollback instructions. `vercel.json` has no application-specific security headers; review a suitable policy alongside media/email changes. |

## Verification and limits

- Clean dependency installation completed with `npm ci --ignore-scripts`; lockfile was not changed.
- `npm run build` passed after permitting Vite's esbuild subprocess. Output JS was approximately 259kB / 79kB gzip; this excludes dynamically returned product image data.
- Connected `npm audit --json` returned seven vulnerable packages (five high, two moderate). An offline audit returned an empty advisory result and was not accepted as evidence of safety.
- Visually checked local breadcrumbs at desktop width and at a 390px mobile viewport: Home/Shop links work, the active item is not a link, long product names wrap, structured-data URLs match navigation, and breadcrumb content does not overflow. Local data used a temporary synthetic product.
- Verified home has no redundant breadcrumb, a missing-product route reaches the unavailable message, and product refreshes produce no local console errors.
- Live inspection covered home, catalog, product navigation, and a product refresh that reproduced the hook crash. No production accounts, orders, payments, emails, admin actions, environment secrets, database contents, backups, or platform settings were changed or validated.

## Release acceptance checklist

1. Resolve P0 security and payment integrity findings; deploy the product-loading fix.
2. Validate required production configuration without exposing secrets; review dependency fixes and run CI.
3. Confirm the real payee, support channels, policies, pricing, shipping, and fulfilment capacity.
4. In staging, complete signup/verify/login/reset, personalisation and variant checkout, price-change and duplicate retry scenarios, address saving, manual payment confirmation, shipping email, tracking, refunds/cancellation, and review moderation.
5. Verify users cannot read or edit another user's profile/orders or access admin APIs; verify expired/revoked tokens and OTP exhaustion.
6. Test cold product links, empty/failed catalog, phone widths, keyboard-only operation, and browser navigation.
7. Demonstrate backup restoration, alerts, and rollback; publish the reviewed build and run a read-only production smoke check before opening orders.
