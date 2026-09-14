/**
 * Server routes for rwp-page-builder, served at /api/plugins/rwp-page-builder/<route> by
 * server.mjs (self-hosted) and api/plugins.ts (Vercel). Registered in server/plugins.mjs.
 *
 * The browser sends only field values. builder_submit_form() validates them against the form
 * saved in the published page and stores the entry; this route then emails a notification.
 * The recipient is read from builder_form_settings with the service key, so it never passes
 * through, or is revealed to, the visitor's browser.
 */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const base = (ctx) => ctx.supabase.url.replace(/\/$/, '');

async function rest(ctx, path, { method = 'GET', body, auth = 'anon', prefer } = {}) {
  const key = auth === 'service' ? ctx.supabase.secretKey : ctx.supabase.publishableKey;
  const token = auth === 'user' ? ctx.bearerToken : key;
  const response = await fetch(`${base(ctx)}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.message || (typeof payload === 'string' && payload) || `HTTP ${response.status}`;
    if (payload?.code === 'PGRST202') {
      throw new HttpError(500, 'The page builder database functions are missing. Run supabase/migrations/20260918_page_builder.sql in the Supabase SQL Editor.');
    }
    throw new HttpError(response.status >= 500 ? 502 : 400, `Supabase ${method} ${path.split('?')[0]} failed: ${message}`);
  }
  return payload;
}

// Rate limiting ------------------------------------------------------------------------------
// In-memory, so it is per process: enough to blunt a single noisy client. The SQL function
// also caps submissions per form, which holds across processes and serverless instances.

const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (!times.some((time) => now - time < WINDOW_MS)) hits.delete(key);
  }
  return recent.length > MAX_PER_WINDOW;
}

// X-Forwarded-For is only trustworthy behind a proxy that sets it; a client talking to the Node
// server directly can vary it to dodge this limit, but not the per-form limit in SQL.
const clientIp = (headers) => String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';

// Email ------------------------------------------------------------------------------------------

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

let transporter;
async function sendMail(message) {
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
  return transporter.sendMail({ from: process.env.SMTP_FROM, ...message });
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const emailPattern = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

async function notify(ctx, submissionId) {
  if (!smtpConfigured()) return 'skipped: SMTP is not configured on the server (SMTP_HOST and SMTP_FROM)';
  if (!ctx.supabase.secretKey) return 'skipped: SUPABASE_SECRET_KEY is not set, so the private recipient could not be read';

  const [submission] = await rest(ctx, `form_submissions?id=eq.${encodeURIComponent(submissionId)}&select=id,form_id,form_name,page_id,fields_data,created_at,pages(title,slug)`, { auth: 'service' });
  if (!submission) return 'skipped: the submission was not found';
  const [settings] = await rest(ctx, `builder_form_settings?page_id=eq.${submission.page_id}&form_id=eq.${encodeURIComponent(submission.form_id)}&select=email_to,email_subject`, { auth: 'service' });

  let recipients = String(settings?.email_to || '').split(/[,;]/).map((item) => item.trim()).filter((item) => emailPattern.test(item));
  if (!recipients.length) {
    const [admin] = await rest(ctx, 'options?option_name=eq.admin_email&select=option_value');
    if (admin?.option_value && emailPattern.test(admin.option_value.trim())) recipients = [admin.option_value.trim()];
  }
  if (!recipients.length) return 'skipped: no recipient (set one on the form, or the admin_email option)';

  const fields = Array.isArray(submission.fields_data) ? submission.fields_data : [];
  const replyTo = fields.find((field) => field.type === 'email' && emailPattern.test(field.value))?.value;
  const formName = submission.form_name || 'Form';
  const pageTitle = submission.pages?.title || 'a page';
  const pageUrl = submission.pages?.slug ? `${ctx.origin}/${submission.pages.slug}` : ctx.origin;
  // Subjects are single-line headers; strip line breaks from the stored value.
  const subject = String(settings?.email_subject || `New submission: ${formName}`).replace(/[\r\n]+/g, ' ').slice(0, 200);

  const rows = fields.map((field) => `<tr><th style="text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #eee;width:30%">${escapeHtml(field.label)}</th><td style="padding:8px;border-bottom:1px solid #eee;white-space:pre-wrap">${escapeHtml(field.value)}</td></tr>`).join('');
  await sendMail({
    to: recipients.join(', '),
    replyTo,
    subject,
    text: `${formName} on ${pageTitle} (${pageUrl})\n\n${fields.map((field) => `${field.label}: ${field.value}`).join('\n')}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#333;max-width:640px"><h2 style="margin:0 0 6px">${escapeHtml(formName)}</h2><p style="margin:0 0 16px;color:#666">Sent from <a href="${escapeHtml(pageUrl)}">${escapeHtml(pageTitle)}</a> on ${new Date(submission.created_at).toUTCString()}</p><table style="width:100%;border-collapse:collapse">${rows}</table></div>`,
  });
  return `sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`;
}

async function recordEmailStatus(ctx, submissionId, status) {
  if (!ctx.supabase.secretKey) return;
  await rest(ctx, `form_submissions?id=eq.${encodeURIComponent(submissionId)}`, {
    method: 'PATCH', auth: 'service', body: { email_status: String(status).slice(0, 300) }, prefer: 'return=minimal',
  }).catch((error) => console.error('[rwp-page-builder] Could not record email status:', error.message));
}

export default {
  id: 'rwp-page-builder',
  routes: {
    'POST forms/submit': async (ctx) => {
      const body = ctx.json();
      const pageId = Number(body.page_id);
      const formId = String(body.form_id || '');
      if (!Number.isInteger(pageId) || pageId <= 0 || !formId) {
        return { status: 400, body: { ok: false, error: 'page_id and form_id are required.' } };
      }
      // Bots fill in every field, including the one people cannot see. Pretend it worked.
      if (body.hp) return { status: 200, body: { ok: true, message: 'Thanks! Your submission has been received.' } };
      if (rateLimited(clientIp(ctx.headers))) {
        return { status: 429, body: { ok: false, error: 'Too many submissions from your connection. Please wait a minute and try again.' } };
      }
      const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};

      const result = await rest(ctx, 'rpc/builder_submit_form', { method: 'POST', body: { p_page_id: pageId, p_form_id: formId, p_fields: fields } });
      if (!result?.ok) return { status: 200, body: result || { ok: false, error: 'The form could not be submitted.' } };

      if (result.send_email && result.id) {
        // A failed email must not fail the submission: the entry is already stored.
        let status;
        try {
          status = await notify(ctx, result.id);
        } catch (error) {
          status = `failed: ${error instanceof Error ? error.message : 'unknown error'}`;
          console.error(`[rwp-page-builder] Form ${formId} email failed:`, error);
        }
        await recordEmailStatus(ctx, result.id, status);
      }
      return { status: 200, body: { ok: true, message: result.message, redirect_url: result.redirect_url || null } };
    },

    'GET status': async (ctx) => {
      if (!ctx.bearerToken) return { status: 401, body: { error: 'Sign in to view the page builder status.' } };
      const allowed = await rest(ctx, 'rpc/user_has_cap', { method: 'POST', body: { capability: 'edit_pages' }, auth: 'user' }).catch(() => false);
      if (allowed !== true) return { status: 403, body: { error: 'Viewing server status needs the edit_pages capability (Editor or above).' } };
      return { status: 200, body: { smtp: smtpConfigured(), secretKey: Boolean(ctx.supabase.secretKey) } };
    },
  },
};
