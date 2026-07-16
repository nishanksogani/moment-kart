// Emails are sent via Gmail SMTP using nodemailer.
// Set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel. Without them (local dev), nothing is sent.
// GMAIL_APP_PASSWORD is a 16-character App Password from
// https://myaccount.google.com/apppasswords (requires 2-Step Verification enabled).

import nodemailer from 'nodemailer';

const APP_NAME = process.env.APP_NAME || 'Moment Kart';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, html, attachments }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { sent: false };

  await getTransporter().sendMail({
    from: `${APP_NAME} <${user}>`,
    to,
    subject,
    html,
    attachments,
  });
  return { sent: true };
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── Shared "deep-water" email chrome, matching the site's color theme ───
const COLOR = {
  abyss: '#0b2530',
  deep: '#123845',
  ocean: '#1d5566',
  tide: '#3e7d8f',
  seaglass: '#a8c5cc',
  foam: '#e8eef0',
  ivory: '#f7f5f0',
  gold: '#b99a5f',
  ink: '#1d2b30',
  slate: '#5c6f75',
};
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function layout({ heading, preheader, body }) {
  return `
    <div style="background:${COLOR.ivory};padding:32px 16px;font-family:${SANS}">
      ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;border-collapse:collapse">
        <tr>
          <td style="background:linear-gradient(135deg,${COLOR.abyss},${COLOR.deep} 55%,${COLOR.ocean});border-radius:8px 8px 0 0;padding:32px 28px;text-align:center">
            <div style="font-family:${SERIF};font-size:26px;font-weight:600;letter-spacing:0.03em;color:${COLOR.ivory}">
              🌊 ${escapeHtml(APP_NAME)}
            </div>
            ${heading ? `<div style="margin-top:6px;font-family:${SERIF};font-size:15px;font-style:italic;color:rgba(247,245,240,0.8)">${heading}</div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e5e1d8;border-top:none;padding:32px 28px">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background:${COLOR.ivory};border:1px solid #e5e1d8;border-top:none;border-radius:0 0 8px 8px;padding:18px 28px;text-align:center">
            <div style="font-size:12px;color:${COLOR.slate}">Thank you for shopping with ${escapeHtml(APP_NAME)}.</div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export async function sendVerificationEmail(email, code) {
  const body = `
    <p style="margin:0 0 18px;color:${COLOR.ink};font-size:15px;line-height:1.6">Your verification code is:</p>
    <div style="text-align:center;margin:0 0 20px">
      <span style="display:inline-block;font-family:${SERIF};font-size:38px;font-weight:600;letter-spacing:10px;color:${COLOR.deep};background:${COLOR.foam};border:1px solid ${COLOR.seaglass};border-radius:4px;padding:14px 18px">
        ${escapeHtml(code)}
      </span>
    </div>
    <p style="margin:0;color:${COLOR.slate};font-size:13px;line-height:1.5">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
  `;
  return sendEmail({
    to: email,
    subject: `${code} is your ${APP_NAME} verification code`,
    html: layout({ heading: 'Verify your email', body }),
  });
}

// Turns a "data:image/jpeg;base64,...." product image into a CID attachment
// so it renders inline even in clients (Gmail included) that strip data: URIs.
function imageAttachment(dataUri, cid) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUri || '');
  if (!match) return null;
  const [, contentType, base64] = match;
  return { cid, contentType, content: Buffer.from(base64, 'base64') };
}

export async function sendShippedEmail(email, { order_no, name, items, courier, tracking_id, address }) {
  const attachments = [];
  const itemRows = (items || [])
    .map((i, idx) => {
      const cid = `item-${idx}@momentkart`;
      const thumb = imageAttachment(i.image_url, cid);
      if (thumb) attachments.push(thumb);
      const img = thumb
        ? `<img src="cid:${cid}" width="56" height="56" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:4px;border:1px solid ${COLOR.seaglass};display:block" />`
        : `<div style="width:56px;height:56px;border-radius:4px;background:${COLOR.foam};border:1px solid ${COLOR.seaglass};text-align:center;line-height:56px;font-size:22px">🌊</div>`;
      return `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid ${COLOR.foam}" width="56">${img}</td>
          <td style="padding:8px 0 8px 14px;border-bottom:1px solid ${COLOR.foam};color:${COLOR.ink};font-size:14px">
            ${escapeHtml(i.name)}${i.dimension ? ` <span style="color:${COLOR.slate}">(Size: ${escapeHtml(i.dimension)})</span>` : ''}<br/>
            <span style="color:${COLOR.slate};font-size:12px">Qty: ${Number(i.qty) || 1}</span>
          </td>
        </tr>
      `;
    })
    .join('');
  const dest = address
    ? escapeHtml([address.line1, address.city, address.pincode].filter(Boolean).join(', '))
    : '';

  const body = `
    <p style="margin:0 0 20px;color:${COLOR.ink};font-size:15px;line-height:1.6">Hi ${escapeHtml(name || 'there')}, your order has been shipped and is on its way! 📦</p>
    ${order_no ? `<p style="margin:0 0 18px;color:${COLOR.slate};font-size:12px;letter-spacing:0.06em;text-transform:uppercase">Order <strong style="color:${COLOR.deep}">#${escapeHtml(order_no)}</strong></p>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
      ${itemRows}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.ivory};border:1px solid ${COLOR.seaglass};border-radius:4px;border-collapse:collapse">
      <tr>
        <td style="padding:14px 16px;font-size:13px;color:${COLOR.ink}">
          <div style="color:${COLOR.slate};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px">Courier</div>
          ${escapeHtml(courier || '')}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 14px;font-size:13px;color:${COLOR.ink}">
          <div style="color:${COLOR.slate};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px">Tracking ID</div>
          ${escapeHtml(tracking_id || '')}
        </td>
      </tr>
    </table>
    ${dest ? `<p style="margin:18px 0 0;color:${COLOR.slate};font-size:12px">Delivering to: ${dest}</p>` : ''}
  `;

  return sendEmail({
    to: email,
    subject: `Your ${APP_NAME} order is on its way 📦`,
    html: layout({ heading: 'Order shipped', body }),
    attachments,
  });
}

const nl2br = (s) => escapeHtml(s).replace(/\n/g, '<br/>');

// Festival/event marketing blast — a custom message plus a showcase of featured products.
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export async function sendMarketingEmail(email, { name, subject, message, products }) {
  const attachments = [];
  const cells = (products || []).map((p, idx) => {
    const cid = `promo-${idx}@momentkart`;
    const thumb = imageAttachment(p.image_url, cid);
    if (thumb) attachments.push(thumb);
    const img = thumb
      ? `<img src="cid:${cid}" width="140" height="110" alt="" style="width:100%;max-width:140px;height:110px;object-fit:cover;border-radius:4px;border:1px solid ${COLOR.seaglass};display:block;margin:0 auto" />`
      : `<div style="width:140px;height:110px;margin:0 auto;border-radius:4px;background:${COLOR.foam};border:1px solid ${COLOR.seaglass};text-align:center;line-height:110px;font-size:28px">🌊</div>`;
    return `
      <td style="padding:10px;text-align:center;vertical-align:top;width:${Math.floor(100 / 3)}%">
        ${img}
        <div style="margin-top:8px;font-size:13px;color:${COLOR.deep};font-weight:600">${escapeHtml(p.name)}</div>
        <div style="font-size:13px;color:${COLOR.gold};font-weight:600">${rupees(p.price_paise)}</div>
      </td>
    `;
  });

  // Three products per row keeps thumbnails a readable size across email clients.
  let productRows = '';
  for (let i = 0; i < cells.length; i += 3) {
    productRows += `<tr>${cells.slice(i, i + 3).join('')}</tr>`;
  }

  const body = `
    <p style="margin:0 0 18px;color:${COLOR.ink};font-size:15px;line-height:1.6">Hi ${escapeHtml(name || 'there')},</p>
    <p style="margin:0 0 22px;color:${COLOR.ink};font-size:14px;line-height:1.65">${nl2br(message)}</p>
    ${cells.length > 0 ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${productRows}
      </table>
    ` : ''}
  `;

  return sendEmail({
    to: email,
    subject,
    html: layout({ heading: 'A little something for you', body }),
    attachments,
  });
}
