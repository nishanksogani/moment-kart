import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Everything the dev server does (emails, OTP codes, errors) is appended here.
// Rolls over at 5 MB: app.log → app.log.1 → app.log.2 → app.log.3 (oldest dropped).
const DEV_LOG = 'app.log';
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATED = 3;

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(DEV_LOG) || fs.statSync(DEV_LOG).size < MAX_LOG_BYTES) return;
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      if (fs.existsSync(`${DEV_LOG}.${i}`)) fs.renameSync(`${DEV_LOG}.${i}`, `${DEV_LOG}.${i + 1}`);
    }
    fs.renameSync(DEV_LOG, `${DEV_LOG}.1`);
  } catch { /* rotation must not break logging */ }
}

// Dev-only /api/dev-email endpoint on the Vite dev server: sends real emails via
// Gmail SMTP (GMAIL_USER/GMAIL_APP_PASSWORD from .env.local) and prints OTP codes
// to this terminal and app.log — codes never appear in the browser.
function devEmailApi() {
  return {
    name: 'dev-email-api',
    apply: 'serve',
    configureServer(server) {
      const record = (line, isError = false) => {
        const stamped = `[${new Date().toISOString()}] ${line}`;
        if (isError) server.config.logger.error(`  ${stamped}`);
        else server.config.logger.info(`\x1b[1;36m  ${stamped}\x1b[0m`);
        try {
          rotateLogIfNeeded();
          fs.appendFileSync(DEV_LOG, stamped + '\n');
        } catch { /* logging must not break dev */ }
      };

      server.middlewares.use('/api/dev-email', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const { kind, to, code, order } = JSON.parse(body || '{}');
            if (kind === 'verification') record(`verification code for ${to}: ${code}`);
            const email = await import(pathToFileURL(path.resolve('api/_email.js')).href);
            const result = kind === 'shipped'
              ? await email.sendShippedEmail(to, order || {})
              : await email.sendVerificationEmail(to, code);
            record(`${kind} email to ${to}: ${result.sent ? 'sent via Gmail' : 'NOT sent (no GMAIL_USER/GMAIL_APP_PASSWORD in .env.local)'}`);
            res.end(JSON.stringify(result));
          } catch (err) {
            record(`email send failed: ${err.message}`, true);
            res.statusCode = 500;
            res.end(JSON.stringify({ sent: false, error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // Same env var names in local dev (.env.local) and production (Vercel dashboard).
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const isDev = command === 'serve';
  // api/_email.js reads these from process.env — make .env.local values visible to it in dev.
  for (const key of ['APP_NAME', 'ADMIN_EMAIL', 'GMAIL_USER', 'GMAIL_APP_PASSWORD']) {
    if (env[key]) process.env[key] = env[key];
  }
  return {
    plugins: [react(), devEmailApi(), {
      name: 'site-robots',
      generateBundle() {
        const site = (env.SITE_URL || 'https://lagom-dezign.vercel.app').replace(/\/$/, '');
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/products\nDisallow: /admin/\nDisallow: /auth\nDisallow: /checkout\nDisallow: /orders\nDisallow: /profile\nSitemap: ${site}/sitemap.xml\n` });
      },
    }],
    define: {
      // Shop display name — set APP_NAME in .env.local / Vercel to rebrand.
      __APP_NAME__: JSON.stringify(env.APP_NAME || ''),
      // UPI id is public by nature (customers pay to it) — embedded in all builds.
      __UPI_ID__: JSON.stringify(env.ADMIN_UPI_ID || ''),
      __SUPPORT_EMAIL__: JSON.stringify(env.SUPPORT_EMAIL || ''),
      __SUPPORT_WHATSAPP__: JSON.stringify(env.SUPPORT_WHATSAPP || ''),
      __SITE_URL__: JSON.stringify(env.SITE_URL || ''),
      __AUTH_MAX_ATTEMPTS__: JSON.stringify(Number(env.AUTH_MAX_ATTEMPTS) > 0 ? Number(env.AUTH_MAX_ATTEMPTS) : 3),
      __AUTH_WINDOW_MINUTES__: JSON.stringify(Number(env.AUTH_WINDOW_MINUTES) > 0 ? Number(env.AUTH_WINDOW_MINUTES) : 10),
      // Admin credentials are injected in `npm run dev` ONLY —
      // they must never end up in a production bundle.
      __DEV_ADMIN_EMAIL__: JSON.stringify(isDev ? env.ADMIN_EMAIL || '' : ''),
      __DEV_ADMIN_PASSWORD__: JSON.stringify(isDev ? env.ADMIN_PASSWORD || '' : ''),
    },
  };
});
