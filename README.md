# 🌊 Lagom.Dezign

A water-themed souvenir shop: customers personalise keepsakes, pay via UPI, and track orders. A single admin manages the catalog, orders, and reviews. Vite + React SPA with Vercel serverless functions and Neon Postgres.

## Environment variables

Same names in `.env.local` (dev) and the Vercel dashboard (production):

| Variable | Purpose |
| --- | --- |
| `APP_NAME` | Shop display name (defaults to `Lagom.Dezign`) |
| `SITE_URL` | Canonical HTTPS domain, including scheme; defaults to `https://lagom-dezign.vercel.app` |
| `SUPPORT_EMAIL` | Public support email; defaults to `hello@lagomdezign.com` |
| `SUPPORT_WHATSAPP` | Full WhatsApp link; defaults to `https://wa.me/919000000000` |
| `ADMIN_EMAIL` | Admin login email — also the sender of all outgoing email |
| `ADMIN_PASSWORD` | Admin login password |
| `ADMIN_UPI_ID` | Actual payment recipient, read by the server when quoting checkout; payments are disabled when missing |
| `DATABASE_URL` | Set automatically by Vercel when the Neon database is attached |
| `AUTH_SECRET` | Required strong random signing secret, configured explicitly; missing values fail outside development |
| `AUTH_MAX_ATTEMPTS` | Submissions per email and action bucket; default `3` |
| `AUTH_WINDOW_MINUTES` | Fixed attempt window; default `10` minutes |
| `GMAIL_USER` | Gmail address that sends verification and shipping emails |
| `GMAIL_APP_PASSWORD` | 16-character [Google App Password](https://myaccount.google.com/apppasswords) for `GMAIL_USER` |

Copy `.env.example` to `.env.local` for development, or set these variables in Vercel. Public brand/contact/domain values are compiled into the frontend: rebuild after changing them. Set `SITE_URL` in both build and runtime configuration so canonical links, robots and the sitemap agree. Use a full `https://wa.me/...` link for WhatsApp.

## Run locally

Use Node 22.12 or newer. This release was tested on Node 24.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Dev mode stores everything in localStorage — no database needed. With `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `.env.local`, verification and shipping emails are sent for real.

## Email (Gmail SMTP)

Emails are sent from a regular Gmail account via SMTP, so no domain purchase or DNS setup is needed.

1. Enable 2-Step Verification on the Google account that will send email
2. Generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Set `GMAIL_USER` to that Gmail address and `GMAIL_APP_PASSWORD` to the generated app password

Regular Gmail accounts are capped at roughly 500 sends/day, and outgoing mail shows `GMAIL_USER` as the sender — fine for low-volume/personal use, but consider a transactional email provider (e.g. Resend, SendGrid) with a verified domain if volume grows.

Verification codes are never shown in the UI:

- Local: the `npm run dev` terminal and `app.log` (rolls over at 5 MB, keeps 3 old files)
- Production: only delivery metadata is logged. Codes are stored as keyed hashes, expire in 10 minutes, are purpose-bound and consumed once.

Login, OTP verification/reset, and OTP sending each have independent email-scoped limits. Signup/resend/forgot share the sending bucket; verification/reset share the checking bucket. Every submitted attempt counts, including a successful one; sending a new code does not reset checking attempts. Production uses an atomic Postgres upsert across serverless instances and responds with HTTP 429 and `Retry-After`. Dev mode mirrors the limit in localStorage.

## Checkout and launch verification

Before showing a QR, checkout requests current catalog/variant prices and stock from the server. A signed quote fixes the items, recipient and total for 30 minutes. Order submission validates that quote and reuses its unique checkout key on retries. Orders remain payment-pending until manually reconciled with the UPI transaction.

Run `npm test`, `npm run build` and a connected `npm audit` before release. The Node tests use SQL adapters; they do not replace a staging Neon/SMTP test. See [release changes and deployment checks](docs/RELEASE_CHANGES.md) for schema changes and remaining launch work.

## Home page carousel

Drop images into `src/assets/carousel/` — they are shown in the "Signature Pieces" carousel in numeric filename order.

## Features

1. review product, with approval from admin
2. hight review on home page where customer review sticks on home page.
3. export import to csv for order. you have 50 MB free db, you can clean up and take backup.
4. user impersonation to see what their page looks like
5. user login attempt tracking when they logged in.
6. user spend - how much they spent to target for emails and marketing.
7. email sent on dispatched
8. payment not received flow.
9. tag based sku, with search on tag event like "anniversary" "rakhi"
10. mobile friendly site
11. marketing mail sender
