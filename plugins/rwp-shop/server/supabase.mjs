/**
 * Minimal PostgREST calls for the shop server routes, in three trust levels:
 *  - "anon": the publishable key, as any visitor. Order access still needs the order key.
 *  - "user": the caller's own access token, so row level security applies to them.
 *  - "service": SUPABASE_SECRET_KEY, used only for the functions granted to service_role
 *    (marking an order paid, recording sent emails, storing gateway references).
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const headersFor = (ctx, auth) => {
  const { publishableKey, secretKey } = ctx.supabase;
  if (auth === 'service') {
    if (!secretKey) {
      throw new HttpError(501, 'SUPABASE_SECRET_KEY is not set on the server. The shop needs it to confirm online payments and send order emails. Add it to .env.local (or your host\'s environment variables) and restart the server.');
    }
    return { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
  }
  if (auth === 'user') {
    if (!ctx.bearerToken) throw new HttpError(401, 'Sign in required.');
    return { apikey: publishableKey, Authorization: `Bearer ${ctx.bearerToken}` };
  }
  return { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` };
};

export async function rpc(ctx, name, args = {}, auth = 'anon') {
  const response = await fetch(`${ctx.supabase.url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...headersFor(ctx, auth), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.message || (typeof payload === 'string' ? payload : '') || `HTTP ${response.status}`;
    if (response.status === 404 || payload?.code === 'PGRST202') {
      throw new HttpError(500, `The database function ${name} is missing. Run supabase/migrations/20260917_shop_plugin.sql in the Supabase SQL Editor.`);
    }
    if (auth === 'service' && (response.status === 401 || response.status === 403)) {
      throw new HttpError(500, `Supabase rejected SUPABASE_SECRET_KEY when calling ${name} (${message}). Check that the key belongs to this project.`);
    }
    throw new HttpError(response.status === 401 ? 401 : 400, message);
  }
  return payload;
}

export async function select(ctx, path, auth = 'anon') {
  const response = await fetch(`${ctx.supabase.url.replace(/\/$/, '')}/rest/v1/${path}`, { headers: headersFor(ctx, auth) });
  if (!response.ok) throw new HttpError(500, `Supabase read of ${path.split('?')[0]} failed (HTTP ${response.status}).`);
  return response.json();
}

/** PATCH rows matching `filter` (PostgREST query string). Returns the updated rows, so an RLS refusal shows as []. */
export async function update(ctx, table, filter, values, auth = 'user') {
  const response = await fetch(`${ctx.supabase.url.replace(/\/$/, '')}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...headersFor(ctx, auth), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new HttpError(500, `Supabase update of ${table} failed (HTTP ${response.status}): ${await response.text()}`);
  return response.json();
}

export async function readOptions(ctx, names) {
  const rows = await select(ctx, `options?option_name=in.(${names.join(',')})&select=option_name,option_value`);
  return Object.fromEntries(rows.map((row) => [row.option_name, row.option_value]));
}

export async function requireShopManager(ctx) {
  if (!ctx.bearerToken) throw new HttpError(401, 'Sign in as a shop manager to do this.');
  const allowed = await rpc(ctx, 'user_has_cap', { capability: 'manage_shop' }, 'user').catch(() => false);
  if (allowed !== true) throw new HttpError(403, 'Your role cannot manage the shop. It needs the manage_shop capability (Shop Manager or Administrator).');
}

export async function isShopManager(ctx) {
  if (!ctx.bearerToken) return false;
  return (await rpc(ctx, 'user_has_cap', { capability: 'manage_shop' }, 'user').catch(() => false)) === true;
}

export async function loadOrder(ctx, orderId, orderKey, auth = 'anon') {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'A valid order_id is required.');
  const order = await rpc(ctx, 'shop_get_order', { p_order_id: id, p_order_key: String(orderKey || '') }, auth);
  if (!order) throw new HttpError(404, `Order ${id} was not found, or the order key does not match.`);
  return order;
}

export async function loadSettings(ctx) {
  return rpc(ctx, 'shop_settings');
}
