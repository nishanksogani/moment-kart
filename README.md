# 🌊 Lagom.Dezign

A water-themed souvenir shop: customers personalise keepsakes, pay via UPI, and track orders. A single admin manages the catalog, orders, and reviews. Vite + React SPA with Vercel serverless functions and Neon Postgres.

## Environment variables

Same names in `.env.local` (dev) and the Vercel dashboard (production):

| Variable | Purpose |
| --- | --- |
| `APP_NAME` | Shop display name (defaults to `Lagom.Dezign`) |
| `ADMIN_EMAIL` | Admin login email — also the sender of all outgoing email |
| `ADMIN_PASSWORD` | Admin login password |
| `ADMIN_UPI_ID` | UPI id shown at checkout (embedded at build time) |
| `DATABASE_URL` | Set automatically by Vercel when the Neon database is attached |
| `AUTH_SECRET` | Set automatically by Vercel |
| `GMAIL_USER` | Gmail address that sends verification and shipping emails |
| `GMAIL_APP_PASSWORD` | 16-character [Google App Password](https://myaccount.google.com/apppasswords) for `GMAIL_USER` |

## Run locally

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

Verification codes (OTPs) are always recoverable from logs, never shown in the UI:

- Local: the `npm run dev` terminal and `app.log` (rolls over at 5 MB, keeps 3 old files)
- Production: Vercel function logs (`verification_code_issued`)

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
