import { HttpError, readOptions } from './supabase.mjs';

export const smtpConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

let transporter;
const getTransport = async () => {
  if (!smtpConfigured()) {
    throw new HttpError(501, 'Email is not configured: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM on the server and restart it.');
  }
  if (!transporter) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return transporter;
};

const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'IRR', 'IRT', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export const money = (amount, currency, settings) => {
  const decimals = Number.isFinite(Number(settings?.decimals)) ? Number(settings.decimals) : (zeroDecimal.has(currency) ? 0 : 2);
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(amount || 0));
  } catch {
    return `${Number(amount || 0).toFixed(decimals)} ${currency}`;
  }
};

const addressHtml = (address = {}) => [
  [address.first_name, address.last_name].filter(Boolean).join(' '),
  address.company, address.address_1, address.address_2,
  [address.city, address.state, address.postcode].filter(Boolean).join(', '),
  address.country, address.phone, address.email,
].filter(Boolean).map(escape).join('<br>');

function orderTable(order, settings) {
  const withTax = order.prices_include_tax;
  const rows = (order.items || []).map((item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escape(item.name)} × ${item.quantity}${item.sku ? `<br><small style="color:#888">SKU: ${escape(item.sku)}</small>` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(Number(item.subtotal) + (withTax ? Number(item.subtotal_tax) : 0), order.currency, settings)}</td>
    </tr>`).join('');
  const totals = [
    ['Subtotal', money(Number(order.subtotal) + (withTax ? Number(order.subtotal_tax) : 0), order.currency, settings)],
    ...(Number(order.discount_total) > 0 ? [['Discount', `-${money(Number(order.discount_total) + (withTax ? Number(order.discount_tax) : 0), order.currency, settings)}`]] : []),
    ...(order.shipping_lines || []).map((line) => ['Shipping', `${money(line.total, order.currency, settings)} via ${escape(line.title)}`]),
    ...(!withTax ? (order.tax_lines || []).map((line) => [escape(line.label), money(Number(line.tax_total) + Number(line.shipping_tax_total), order.currency, settings)]) : []),
    ['Payment method', escape(order.payment_method_title)],
    ['Total', `<strong>${money(order.total, order.currency, settings)}</strong>`],
    ...(Number(order.refunded_total) > 0 ? [['Refunded', `-${money(order.refunded_total, order.currency, settings)}`]] : []),
  ].map(([label, value]) => `<tr><th style="padding:8px;text-align:left">${label}</th><td style="padding:8px;text-align:right">${value}</td></tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #eee">${rows}${totals}</table>`;
}

function layout({ heading, intro, order, settings, siteTitle, origin, extra = '' }) {
  const color = settings?.emails?.base_color || '#7f54b3';
  const footer = settings?.emails?.footer_text || siteTitle;
  const link = `${origin}/checkout/order-received/${order.id}?key=${encodeURIComponent(order.order_key)}`;
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;color:#333">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:${escape(color)};color:#fff;padding:24px;border-radius:6px 6px 0 0"><h1 style="margin:0;font-size:22px">${escape(heading)}</h1></div>
    <div style="background:#fff;padding:24px;border-radius:0 0 6px 6px">
      <p>${intro}</p>
      ${extra}
      <h2 style="font-size:16px;color:${escape(color)}">Order #${order.id} (${new Date(order.created_at).toLocaleDateString('en')})</h2>
      ${orderTable(order, settings)}
      ${order.customer_note ? `<p><strong>Note:</strong> ${escape(order.customer_note)}</p>` : ''}
      <table style="width:100%;margin-top:20px"><tr>
        <td style="vertical-align:top;padding-right:10px"><h3 style="font-size:14px">Billing address</h3><p>${addressHtml(order.billing)}</p></td>
        ${(order.shipping_lines || []).length ? `<td style="vertical-align:top"><h3 style="font-size:14px">Shipping address</h3><p>${addressHtml(order.shipping)}</p></td>` : ''}
      </tr></table>
      <p><a href="${escape(link)}" style="color:${escape(color)}">View your order online</a></p>
    </div>
    <p style="text-align:center;color:#999;font-size:12px">${escape(footer)}</p>
  </div></body></html>`;
}

const bankDetails = (order) => {
  if (order.payment_method !== 'bacs' || !(order.bank_accounts || []).length) return '';
  return `<h2 style="font-size:16px">Our bank details</h2>${order.bank_accounts.map((account) => `<p>${[
    account.bank_name && `Bank: ${escape(account.bank_name)}`,
    account.account_name && `Account name: ${escape(account.account_name)}`,
    account.account_number && `Account number: ${escape(account.account_number)}`,
    account.sort_code && `Sort code: ${escape(account.sort_code)}`,
    account.iban && `IBAN: ${escape(account.iban)}`,
    account.bic && `BIC: ${escape(account.bic)}`,
    `Reference: ${order.id}`,
  ].filter(Boolean).join('<br>')}</p>`).join('')}`;
};

/** Builds { to, subject, html } for an email type, or null when it does not apply. */
export async function buildEmail(ctx, type, order, settings, extra = {}) {
  const options = await readOptions(ctx, ['site_title', 'admin_email']);
  const siteTitle = options.site_title || 'Shop';
  const adminRecipients = (settings?.emails?.admin_recipient || options.admin_email || '').split(',').map((item) => item.trim()).filter(Boolean);
  const stockRecipients = (settings?.stock_email_recipient || '').split(',').map((item) => item.trim()).filter(Boolean);
  const customer = order.billing?.email;
  const name = order.billing?.first_name || 'there';
  const instructions = order.payment_instructions ? `<p>${escape(order.payment_instructions)}</p>` : '';
  const base = { order, settings, siteTitle, origin: ctx.origin };

  switch (type) {
    case 'new_order':
      return adminRecipients.length && {
        to: adminRecipients, subject: `[${siteTitle}]: New order #${order.id}`,
        html: layout({ ...base, heading: `New order: #${order.id}`, intro: `You have received an order from ${escape([order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' '))}.` }),
      };
    case 'cancelled_order':
      return adminRecipients.length && {
        to: adminRecipients, subject: `[${siteTitle}]: Order #${order.id} has been cancelled`,
        html: layout({ ...base, heading: 'Order cancelled', intro: `Order #${order.id} belonging to ${escape(order.billing?.email)} has been cancelled.` }),
      };
    case 'failed_order':
      return adminRecipients.length && {
        to: adminRecipients, subject: `[${siteTitle}]: Order #${order.id} has failed`,
        html: layout({ ...base, heading: 'Order failed', intro: `Payment for order #${order.id} from ${escape(order.billing?.email)} has failed.` }),
      };
    case 'customer_on_hold':
      return customer && {
        to: [customer], subject: `Your ${siteTitle} order has been received!`,
        html: layout({ ...base, heading: 'Thank you for your order', intro: `Hi ${escape(name)}, we have received your order. It is on hold until we confirm that payment has been received.`, extra: instructions + bankDetails(order) }),
      };
    case 'customer_processing':
      return customer && {
        to: [customer], subject: `Your ${siteTitle} order has been received!`,
        html: layout({ ...base, heading: 'Thank you for your order', intro: `Hi ${escape(name)}, just to let you know — we've received your order #${order.id}, and it is now being processed.`, extra: instructions }),
      };
    case 'customer_completed':
      return customer && {
        to: [customer], subject: `Your ${siteTitle} order is now complete`,
        html: layout({ ...base, heading: 'Thanks for shopping with us', intro: `Hi ${escape(name)}, we have finished processing your order.` }),
      };
    case 'customer_refunded':
      return customer && {
        to: [customer], subject: `Your ${siteTitle} order #${order.id} has been refunded`,
        html: layout({ ...base, heading: 'Order refunded', intro: `Hi ${escape(name)}, your order has been ${Number(order.refunded_total) >= Number(order.total) ? 'fully' : 'partially'} refunded${extra.amount ? ` (${money(extra.amount, order.currency, settings)})` : ''}. There are more details below for your reference.` }),
      };
    case 'customer_note':
      return customer && {
        to: [customer], subject: `Note added to your ${siteTitle} order`,
        html: layout({ ...base, heading: 'A note has been added to your order', intro: `Hi ${escape(name)}, the following note has been added to your order:`, extra: `<blockquote style="border-left:4px solid #ddd;margin:0 0 16px;padding:8px 12px">${escape(extra.note)}</blockquote>` }),
      };
    case 'customer_invoice':
      return customer && {
        to: [customer], subject: `Details for order #${order.id} on ${siteTitle}`,
        html: layout({ ...base, heading: `Details for order #${order.id}`, intro: `Hi ${escape(name)}, here are the details of your order placed on ${new Date(order.created_at).toLocaleDateString('en')}.`, extra: instructions + bankDetails(order) }),
      };
    case 'low_stock': {
      const recipients = stockRecipients.length ? stockRecipients : adminRecipients;
      return recipients.length && extra.products?.length && {
        to: recipients, subject: `[${siteTitle}] Product stock is running low`,
        html: `<p>The following products are low or out of stock after order #${order.id}:</p><ul>${extra.products.map((product) => `<li>${escape(product.name)}: ${product.stock_quantity} left</li>`).join('')}</ul>`,
      };
    }
    default:
      return null;
  }
}

/** A short branded email for offers and price alerts: { subject, html }. Everything interpolated is escaped. */
export function commerceEmail({ settings, siteTitle, heading, intro, code = null, note = '', link, linkLabel }) {
  const color = settings?.emails?.base_color || '#7f54b3';
  const footer = settings?.emails?.footer_text || siteTitle;
  return {
    subject: `[${siteTitle}] ${heading}`,
    html: `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;color:#333">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:${escape(color)};color:#fff;padding:24px;border-radius:6px 6px 0 0"><h1 style="margin:0;font-size:22px">${escape(heading)}</h1></div>
    <div style="background:#fff;padding:24px;border-radius:0 0 6px 6px">
      <p>${escape(intro)}</p>
      ${code ? `<p style="font-size:20px;font-weight:bold;letter-spacing:1px;font-family:monospace">${escape(String(code).toUpperCase())}</p>` : ''}
      ${note ? `<blockquote style="border-left:4px solid #ddd;margin:0 0 16px;padding:8px 12px">${escape(note)}</blockquote>` : ''}
      <p><a href="${escape(link)}" style="color:${escape(color)}">${escape(linkLabel)}</a></p>
    </div>
    <p style="text-align:center;color:#999;font-size:12px">${escape(footer)}</p>
  </div></body></html>`,
  };
}

export async function send(email) {
  const transport = await getTransport();
  const fromName = email.fromName ? `"${String(email.fromName).replace(/"/g, '')}" ` : '';
  await transport.sendMail({
    from: `${fromName}<${process.env.SMTP_FROM}>`,
    to: email.to.join(', '),
    subject: email.subject,
    html: email.html,
    text: email.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|h\d|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim(),
  });
}
